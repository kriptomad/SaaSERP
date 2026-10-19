// apps/api/src/modules/platform-admin/platform-admin.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 13 (Painel de Administração Global)
// + Capítulo 15 (Status do Sistema, Feature Flags, Helpdesk, API/Webhooks).
// GAP DE AUDITORIA ENCONTRADO E CORRIGIDO: `PlatformAdminUser`, `AuditLog`,
// `SystemParameter`, `FeatureFlag`, `SupportTicket`/`SupportTicketMessage`,
// `TenantApiKey`, `TenantWebhookEndpoint`/`WebhookDelivery` existem no schema
// desde o início, e `platform-admin-auth.routes.ts`/`.middleware.ts` já
// implementavam login + 2FA do painel, mas NENHUMA rota operacional do painel
// em si existia — apenas autenticação, nenhum controle de tenant de fato.
// ESCOPO DESTA 1ª IMPLEMENTAÇÃO (honestamente delimitado):
//   - Controle de tenants: listar, ver detalhe, suspender/reativar (SUPER_ADMIN).
//   - `AuditLog`: toda ação sensível deste módulo grava uma linha (somente
//     INSERT, nunca UPDATE/DELETE, igual ao comentário do schema).
//   - `SystemParameter`: listar/editar.
//   - `FeatureFlag`: CRUD completo.
//   - `SupportTicket`: listar/detalhe/atribuir/mudar status/responder.
//   - Oversight de `TenantApiKey` (revogar) e `TenantWebhookEndpoint`
//     (listar entregas + replay manual).
// ATUALIZAÇÃO (rodadas posteriores de auditoria): dashboard de saúde do sistema
// em tempo real foi implementado em `system-status.routes.ts` (SSE + snapshot
// Postgres/Redis/filas); impersonation (`ImpersonationSession`) implementada
// abaixo; CRUD de `Plan`/`Module` implementado (antes só existia via seed).
// PENDENTE: retry automático com backoff exponencial de `WebhookDelivery`
// (Capítulo 15.4 — aqui só o replay manual está implementado).
import { Router, Request, Response } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import { prismaUnscoped as prisma } from "@filitech/db";
import { requirePlatformAdminAuth, requireSuperAdmin } from "./platform-admin-auth.middleware";
import { invalidateTenantModuleCache } from "../../middlewares/gatekeeper.middleware";
import { signSessionToken } from "../auth/jwt.service";
import { webhookDeliveryQueue } from "../../lib/queue";
import type { WebhookDeliveryJobData } from "../../lib/webhook-dispatch";

export const platformAdminRouter = Router();

async function writeAuditLog(req: Request, action: string, targetType: string, targetId: string | null, metadata: Record<string, unknown>) {
  await prisma.auditLog.create({
    data: {
      platformAdminUserId: req.platformAdminSession!.platformAdminUserId,
      action,
      targetType,
      targetId,
      metadata: metadata as any,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────
// TENANTS (Capítulo 13.2)
// ─────────────────────────────────────────────────────────────────────────

const listTenantsQuerySchema = z.object({
  status: z.string().optional(),
  // GAP DE AUDITORIA FECHADO (Rodada 11): sem limite de tamanho, um admin
  // (ou sessão comprometida) podia submeter strings de busca arbitrariamente
  // grandes repetidamente, gerando varreduras `contains` caras no Postgres.
  search: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

platformAdminRouter.get("/platform-admin/tenants", requirePlatformAdminAuth, async (req: Request, res: Response) => {
  const parsed = listTenantsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const { status, search, page, pageSize } = parsed.data;
  const where: import("@filitech/db").Prisma.TenantWhereInput = {
    ...(status ? { status: status as any } : {}),
    ...(search ? { OR: [{ legalName: { contains: search, mode: "insensitive" as const } }, { tradeName: { contains: search, mode: "insensitive" as const } }, { slug: { contains: search, mode: "insensitive" as const } }] } : {}),
  };
  // GAP DE AUDITORIA FECHADO (Rodada 11): `take: 100` sem paginação truncava
  // silenciosamente a plataforma inteira no primeiro lote — acima de 100 tenants,
  // o operador simplesmente não via (nem conseguia buscar/filtrar) o restante.
  // Agora pagina de verdade e devolve `total` para a UI calcular páginas.
  const [tenants, total] = await Promise.all([
    prisma.tenant.findMany({
      where,
      orderBy: { tradeName: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.tenant.count({ where }),
  ]);
  return res.json({ success: true, data: { items: tenants, total, page, pageSize }, error: null });
});

platformAdminRouter.get("/platform-admin/tenants/:id", requirePlatformAdminAuth, async (req: Request, res: Response) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } });
  if (!tenant) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Tenant não encontrado." } });
  }
  return res.json({ success: true, data: tenant, error: null });
});

const updateTenantStatusSchema = z.object({
  status: z.enum(["TRIAL", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELLED"]),
  reason: z.string().min(1),
});

// Suspender/reativar é a ação mais sensível do painel — restrita a SUPER_ADMIN,
// nunca SUPPORT_AGENT/FINANCE_ANALYST — e sempre audita o motivo informado.
platformAdminRouter.patch("/platform-admin/tenants/:id/status", requirePlatformAdminAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  const parsed = updateTenantStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } });
  if (!tenant) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Tenant não encontrado." } });
  }
  const updated = await prisma.$transaction(async (tx) => {
    const tenant_ = await tx.tenant.update({ where: { id: tenant.id }, data: { status: parsed.data.status } });
    // GAP DE AUDITORIA FECHADO (Rodada 11): `tenant.update()` e `writeAuditLog()`
    // eram duas escritas separadas e não-atômicas — se a segunda falhasse
    // (conexão derrubada, etc.), o tenant ficava suspenso/reativado SEM nenhum
    // registro de motivo/trilha de auditoria, e a resposta de erro ao operador
    // podia levar a um retry duplicado. Agora as duas escritas sobem ou caem juntas.
    await tx.auditLog.create({
      data: {
        platformAdminUserId: req.platformAdminSession!.platformAdminUserId,
        action: "TENANT_STATUS_CHANGED",
        targetType: "Tenant",
        targetId: tenant.id,
        metadata: { from: tenant.status, to: parsed.data.status, reason: parsed.data.reason } as any,
      },
    });
    return tenant_;
  });
  return res.json({ success: true, data: updated, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// IMPERSONATION (Capítulo 13.1) — entrar como o próprio lojista para dar suporte
// ou preview comercial, sem conhecer/alterar sua senha. Sempre exige justificativa,
// sempre audita, sempre expira sozinha (curta, 30min) mesmo se o admin esquecer de
// encerrar, e o próprio tenant pode encerrá-la a qualquer momento
// (POST /auth/impersonation/end) — nenhum dos dois lados fica refém do outro.
// ─────────────────────────────────────────────────────────────────────────

const startImpersonationSchema = z.object({ reason: z.string().min(5) });
const IMPERSONATION_SESSION_TTL_MINUTES = 30;

platformAdminRouter.post("/platform-admin/tenants/:tenantId/impersonate", requirePlatformAdminAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  const parsed = startImpersonationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: "Informe uma justificativa (mínimo 5 caracteres)." } });
  }
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.tenantId } });
  if (!tenant) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Tenant não encontrado." } });
  }
  // Impersona sempre o OWNER ativo — nunca um papel mais restrito, para o suporte
  // enxergar a tela exatamente como o dono vê, incluindo áreas gated por role.
  const owner = await prisma.user.findFirst({ where: { tenantId: tenant.id, role: "OWNER", active: true }, orderBy: { createdAt: "asc" } });
  if (!owner) {
    return res.status(409).json({ success: false, data: null, error: { code: "NO_OWNER_USER", message: "Este tenant não possui um usuário OWNER ativo para impersonar." } });
  }

  const expiresAt = new Date(Date.now() + IMPERSONATION_SESSION_TTL_MINUTES * 60_000);
  const session = await prisma.impersonationSession.create({
    data: { platformAdminUserId: req.platformAdminSession!.platformAdminUserId, tenantId: tenant.id, reason: parsed.data.reason, expiresAt },
  });

  const token = signSessionToken(
    { userId: owner.id, tenantId: tenant.id, role: owner.role as any, impersonation: { platformAdminUserId: req.platformAdminSession!.platformAdminUserId, sessionId: session.id } },
    `${IMPERSONATION_SESSION_TTL_MINUTES}m`,
  );
  await writeAuditLog(req, "IMPERSONATION_STARTED", "Tenant", tenant.id, { impersonationSessionId: session.id, reason: parsed.data.reason, impersonatedUserId: owner.id });

  // Formato compatível com `AuthResponse` do frontend tenant (mesmo shape do login
  // normal) — o painel de plataforma usa isso para montar a URL `?sso=` consumida
  // por `consumeSsoFromQuery()` em apps/web/src/api/client.ts, exatamente o mesmo
  // mecanismo já usado pelo shell desktop para SSO.
  return res.json({
    success: true,
    data: {
      impersonationSessionId: session.id,
      expiresAt,
      token,
      tenant: { id: tenant.id, slug: tenant.slug, tradeName: tenant.tradeName, status: tenant.status, tenantType: tenant.tenantType, cnpj: tenant.cnpj },
      user: { id: owner.id, name: owner.name, email: owner.email, role: owner.role },
    },
    error: null,
  });
});

platformAdminRouter.get("/platform-admin/impersonation-sessions", requirePlatformAdminAuth, async (req: Request, res: Response) => {
  const { tenantId } = req.query as { tenantId?: string };
  const sessions = await prisma.impersonationSession.findMany({
    where: { ...(tenantId ? { tenantId } : {}) },
    include: { tenant: { select: { tradeName: true, slug: true } }, platformAdminUser: { select: { name: true, email: true } } },
    orderBy: { startedAt: "desc" },
    take: 100,
  });
  return res.json({ success: true, data: sessions, error: null });
});

// Encerramento forçado pelo lado do painel (ex.: o admin terminou o atendimento
// antes do tenant fechar a aba) — complementar ao POST /auth/impersonation/end que
// o PRÓPRIO tenant pode chamar a qualquer momento.
platformAdminRouter.post("/platform-admin/impersonation-sessions/:id/end", requirePlatformAdminAuth, async (req: Request, res: Response) => {
  const session = await prisma.impersonationSession.findUnique({ where: { id: req.params.id } });
  if (!session) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Sessão de impersonation não encontrada." } });
  }
  const updated = await prisma.impersonationSession.update({ where: { id: session.id }, data: { endedAt: new Date() } });
  await writeAuditLog(req, "IMPERSONATION_ENDED", "Tenant", session.tenantId, { impersonationSessionId: session.id });
  return res.json({ success: true, data: updated, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// DASHBOARD DE RECEITA (MRR) — Capítulo 13.3. Calcula sempre a partir das
// assinaturas reais (`Subscription`/`Plan`/`TenantModule`), nunca de um número
// hardcoded ou estimado: MRR é a soma do `basePrice` do plano + MRR de módulos
// add-on ativos de cada assinatura ACTIVE (TRIAL/PAST_DUE/SUSPENDED/CANCELLED não
// contam como receita recorrente confirmada — mesmo critério usado por qualquer
// ferramenta de billing real). Inclui também LTV por plano e projeção linear de
// MRR para 3 meses, ambos calculados a partir de dados reais (ver comentários
// inline abaixo) — adicionados após auditoria apontar a ausência desses dois.
// ─────────────────────────────────────────────────────────────────────────

platformAdminRouter.get("/platform-admin/revenue-dashboard", requirePlatformAdminAuth, async (_req: Request, res: Response) => {
  const subscriptions = await prisma.subscription.findMany({
    include: { plan: { select: { id: true, code: true, label: true, basePrice: true, audience: true } } },
  });

  const mrrByPlan = new Map<string, { planCode: string; planLabel: string; activeCount: number; mrr: number }>();
  let totalMrr = 0;
  const countByStatus: Record<string, number> = { TRIAL: 0, ACTIVE: 0, PAST_DUE: 0, SUSPENDED: 0, CANCELLED: 0 };
  const activeTenantIds: string[] = [];

  for (const sub of subscriptions) {
    countByStatus[sub.status] = (countByStatus[sub.status] ?? 0) + 1;
    if (sub.status !== "ACTIVE") continue;
    activeTenantIds.push(sub.tenantId);
    const planPrice = Number(sub.plan.basePrice);
    totalMrr += planPrice;
    const bucket = mrrByPlan.get(sub.plan.id) ?? { planCode: sub.plan.code, planLabel: sub.plan.label, activeCount: 0, mrr: 0 };
    bucket.activeCount += 1;
    bucket.mrr += planPrice;
    mrrByPlan.set(sub.plan.id, bucket);
  }

  // CORREÇÃO DE AUDITORIA (admin-panel audit round): o dashboard só somava o
  // `basePrice` do plano, ignorando por completo a receita de módulos add-on
  // contratados à la carte (Capítulo 2.9/13.3) — subestimava o MRR real sempre
  // que um tenant tinha módulos pagos ativos além do plano. Soma agora o MRR de
  // cada módulo ativo (`TenantModule.active = true`) para tenants com assinatura
  // ACTIVE, agrupado por módulo.
  const activeModuleGrants = activeTenantIds.length
    ? await prisma.tenantModule.findMany({
        where: { tenantId: { in: activeTenantIds }, active: true },
        include: { module: { select: { code: true, label: true, monthlyPrice: true } } },
      })
    : [];
  const mrrByModule = new Map<string, { moduleCode: string; moduleLabel: string; activeTenantCount: number; mrr: number }>();
  let totalModuleMrr = 0;
  for (const grant of activeModuleGrants) {
    const price = Number(grant.module.monthlyPrice);
    totalModuleMrr += price;
    const bucket = mrrByModule.get(grant.module.code) ?? { moduleCode: grant.module.code, moduleLabel: grant.module.label, activeTenantCount: 0, mrr: 0 };
    bucket.activeTenantCount += 1;
    bucket.mrr += price;
    mrrByModule.set(grant.module.code, bucket);
  }
  totalMrr += totalModuleMrr;

  // Churn do mês corrente: assinaturas canceladas cujo `cancelRequestedAt` caiu
  // dentro do mês atual — aproximação real (não estimada) de churn mensal.
  const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const churnedThisMonth = subscriptions.filter((s) => s.status === "CANCELLED" && s.cancelRequestedAt && s.cancelRequestedAt >= startOfMonth).length;

  // CORREÇÃO DE AUDITORIA: LTV e projeção de 3 meses eram pedidos no round de
  // auditoria do painel admin e não existiam. Nunca hardcoded — calculados a
  // partir de dados reais:
  //   - LTV (por plano) = ARPU do plano ÷ taxa de churn mensal da BASE INTEIRA de
  //     assinantes ACTIVE (não há granularidade de churn por plano suficiente —
  //     amostra pequena por plano tornaria a taxa estatisticamente instável; usar
  //     a taxa agregada é a prática padrão quando o volume por segmento é baixo).
  //     Fórmula clássica de SaaS: LTV = ARPU / churn rate mensal.
  //   - Projeção de 3 meses = MRR atual + 3 × média de MRR líquido novo adicionado
  //     nos últimos 3 meses (assinaturas hoje ACTIVE cujo primeiro pagamento
  //     — `firstChargedAt` — caiu nos últimos 90 dias), uma extrapolação linear
  //     simples e auditável, nunca um número de marketing.
  const activeCountTotal = activeTenantIds.length;
  const monthlyChurnRate = activeCountTotal > 0 ? churnedThisMonth / (activeCountTotal + churnedThisMonth) : 0;
  const ltvByPlan = Array.from(mrrByPlan.values()).map((bucket) => {
    const arpu = bucket.activeCount > 0 ? bucket.mrr / bucket.activeCount : 0;
    const ltv = monthlyChurnRate > 0 ? arpu / monthlyChurnRate : null; // null = sem churn observado ainda, LTV indefinido (não infinito fictício)
    return { planCode: bucket.planCode, planLabel: bucket.planLabel, arpu, ltv };
  });

  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const newlyChargedSubs = subscriptions.filter((s) => s.status === "ACTIVE" && s.firstChargedAt && s.firstChargedAt >= ninetyDaysAgo);
  const netNewMrrLast3Months = newlyChargedSubs.reduce((sum, s) => sum + Number(s.plan.basePrice), 0);
  const avgMonthlyNetNewMrr = netNewMrrLast3Months / 3;
  const projectedMrrIn3Months = totalMrr + avgMonthlyNetNewMrr * 3;

  return res.json({
    success: true,
    data: {
      totalMrr,
      arr: totalMrr * 12,
      countByStatus,
      byPlan: Array.from(mrrByPlan.values()),
      byModule: Array.from(mrrByModule.values()),
      totalModuleMrr,
      ltvByPlan,
      projectedMrrIn3Months,
      avgMonthlyNetNewMrr,
      churnedThisMonth,
      totalSubscriptions: subscriptions.length,
    },
    error: null,
  });
});

// ─────────────────────────────────────────────────────────────────────────
// AUDIT LOG (somente leitura — tabela append-only, Capítulo 13.4)
// ─────────────────────────────────────────────────────────────────────────

// CORREÇÃO DE AUDITORIA (mega-audit round de 100%, criticidade MEDIA): a tela só
// filtrava por `targetType` — apontado no round de auditoria do painel admin como
// faltando filtro por admin responsável, ação e janela de tempo (campos que o
// modelo `AuditLog` já tinha desde sempre, só nunca expostos como filtro de
// consulta). `requestId`/`level` NÃO existem no modelo `AuditLog` (esse log é
// append-only de ações administrativas sensíveis, não um log estruturado de
// aplicação com nível de severidade) — não adicionados por não existir dado real
// para filtrar, nunca um filtro decorativo sem efeito.
platformAdminRouter.get("/platform-admin/audit-logs", requirePlatformAdminAuth, async (req: Request, res: Response) => {
  const { targetType, targetId, action, platformAdminUserId, from, to } = req.query as {
    targetType?: string;
    targetId?: string;
    action?: string;
    platformAdminUserId?: string;
    from?: string;
    to?: string;
  };
  const fromDate = from ? new Date(from) : undefined;
  const toDate = to ? new Date(to) : undefined;
  const logs = await prisma.auditLog.findMany({
    where: {
      ...(targetType ? { targetType } : {}),
      ...(targetId ? { targetId } : {}),
      ...(action ? { action: { contains: action, mode: "insensitive" } } : {}),
      ...(platformAdminUserId ? { platformAdminUserId } : {}),
      ...(fromDate || toDate
        ? { createdAt: { ...(fromDate && !Number.isNaN(fromDate.getTime()) ? { gte: fromDate } : {}), ...(toDate && !Number.isNaN(toDate.getTime()) ? { lte: toDate } : {}) } }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { platformAdminUser: { select: { id: true, name: true, email: true } } },
  });
  return res.json({ success: true, data: logs, error: null });
});

// Lista enxuta de admins da plataforma, usada só para popular o filtro "admin
// responsável" do audit log — nunca expõe hash de senha/segredo TOTP.
platformAdminRouter.get("/platform-admin/admin-users", requirePlatformAdminAuth, async (_req: Request, res: Response) => {
  const admins = await prisma.platformAdminUser.findMany({
    select: { id: true, name: true, email: true, role: true, active: true },
    orderBy: { name: "asc" },
    // GAP DE AUDITORIA FECHADO (Rodada 12): teto de segurança — lista de admins
    // da própria plataforma (nunca cresce por ação de tenant), mas sem nenhum
    // limite o endpoint ficava sem contrato de resposta limitada.
    take: 500,
  });
  return res.json({ success: true, data: admins, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// CENTRAL DE INTEGRAÇÕES (Capítulo 20.10) — visão agregada por provedor, nunca por
// tenant isolado: quantos tenants têm a credencial ativa e a taxa de sucesso dos
// últimos 100 IntegrationHealthCheckLog por provedor, para detectar em massa (ex.)
// uma mudança de layout da SEFAZ ou expiração em lote de tokens antes que o lojista
// perceba no caixa. Reaproveita 100% os dados já gravados por runIntegrationTest
// (Capítulo 20.1) — nenhuma chamada de rede nova é feita aqui.
platformAdminRouter.get("/platform-admin/integrations/summary", requirePlatformAdminAuth, async (_req: Request, res: Response) => {
  const credentials = await prisma.integrationCredential.findMany({
    select: { id: true, tenantId: true, provider: true, active: true, lastTestedAt: true, lastTestSuccess: true },
    // GAP DE AUDITORIA FECHADO (Rodada 12): sem teto, crescimento da base de
    // tenants/credenciais fazia este dashboard carregar a tabela inteira em
    // memória a cada acesso. O loop abaixo é por PROVEDOR (conjunto pequeno e
    // fixo, ex. ~15 integrações suportadas) — não é N+1 por tenant/credencial.
    take: 20_000,
  });

  const byProvider = new Map<string, { credentialIds: string[]; activeTenantCount: number }>();
  for (const credential of credentials) {
    const bucket = byProvider.get(credential.provider) ?? { credentialIds: [], activeTenantCount: 0 };
    bucket.credentialIds.push(credential.id);
    if (credential.active && credential.tenantId) bucket.activeTenantCount += 1;
    byProvider.set(credential.provider, bucket);
  }

  const summary = await Promise.all(
    Array.from(byProvider.entries()).map(async ([provider, bucket]) => {
      const recentLogs = await prisma.integrationHealthCheckLog.findMany({
        where: { credentialId: { in: bucket.credentialIds } },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: { success: true },
      });
      const successRate = recentLogs.length > 0 ? recentLogs.filter((l) => l.success).length / recentLogs.length : null;
      return {
        provider,
        activeTenantCount: bucket.activeTenantCount,
        totalCredentialCount: bucket.credentialIds.length,
        last100SuccessRate: successRate,
        sampledChecks: recentLogs.length,
      };
    }),
  );

  return res.json({ success: true, data: summary, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// SYSTEM PARAMETERS (Capítulo 13.4)
// ─────────────────────────────────────────────────────────────────────────

platformAdminRouter.get("/platform-admin/system-parameters", requirePlatformAdminAuth, async (_req: Request, res: Response) => {
  const parameters = await prisma.systemParameter.findMany({ orderBy: { key: "asc" }, take: 1000 });
  return res.json({ success: true, data: parameters, error: null });
});

const updateSystemParameterSchema = z.object({ value: z.string() });

platformAdminRouter.put("/platform-admin/system-parameters/:key", requirePlatformAdminAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  const parsed = updateSystemParameterSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const existing = await prisma.systemParameter.findUnique({ where: { key: req.params.key } });
  if (!existing) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Parâmetro não encontrado." } });
  }
  // GAP DE AUDITORIA FECHADO (Rodada 12): update + auditLog eram duas escritas
  // separadas — uma falha na segunda deixava um parâmetro de sistema (que pode
  // mudar comportamento em produção) alterado sem nenhuma trilha de auditoria.
  const updated = await prisma.$transaction(async (tx) => {
    const param = await tx.systemParameter.update({
      where: { key: existing.key },
      data: { value: parsed.data.value, updatedByPlatformAdminUserId: req.platformAdminSession!.platformAdminUserId },
    });
    await tx.auditLog.create({
      data: {
        platformAdminUserId: req.platformAdminSession!.platformAdminUserId,
        action: "PARAMETER_UPDATED",
        targetType: "SystemParameter",
        targetId: existing.key,
        metadata: { from: existing.value, to: parsed.data.value } as any,
      },
    });
    return param;
  });
  return res.json({ success: true, data: updated, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// FEATURE FLAGS (Capítulo 15.2)
// ─────────────────────────────────────────────────────────────────────────

platformAdminRouter.get("/platform-admin/feature-flags", requirePlatformAdminAuth, async (_req: Request, res: Response) => {
  const flags = await prisma.featureFlag.findMany({ orderBy: { key: "asc" }, take: 1000 });
  return res.json({ success: true, data: flags, error: null });
});

const createFeatureFlagSchema = z.object({
  key: z.string().min(1),
  description: z.string().min(1),
  rolloutPercent: z.number().int().min(0).max(100).default(0),
  enabledForTenantIds: z.array(z.string().uuid()).default([]),
  active: z.boolean().default(true),
});

platformAdminRouter.post("/platform-admin/feature-flags", requirePlatformAdminAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  const parsed = createFeatureFlagSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const flag = await prisma.featureFlag.create({ data: parsed.data });
  await writeAuditLog(req, "FEATURE_FLAG_CREATED", "FeatureFlag", flag.id, { key: flag.key });
  return res.status(201).json({ success: true, data: flag, error: null });
});

const patchFeatureFlagSchema = createFeatureFlagSchema.partial().omit({ key: true });

platformAdminRouter.patch("/platform-admin/feature-flags/:id", requirePlatformAdminAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  const parsed = patchFeatureFlagSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const existing = await prisma.featureFlag.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Feature flag não encontrada." } });
  }
  const updated = await prisma.featureFlag.update({ where: { id: existing.id }, data: parsed.data });
  await writeAuditLog(req, "MODULE_TOGGLED", "FeatureFlag", existing.id, { changes: parsed.data });
  return res.json({ success: true, data: updated, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// SUPPORT TICKETS / HELPDESK (Capítulo 15.3)
// ─────────────────────────────────────────────────────────────────────────

platformAdminRouter.get("/platform-admin/support-tickets", requirePlatformAdminAuth, async (req: Request, res: Response) => {
  const { status, assignedToMe } = req.query as { status?: string; assignedToMe?: string };
  const tickets = await prisma.supportTicket.findMany({
    where: {
      ...(status ? { status: status as any } : {}),
      ...(assignedToMe === "true" ? { assignedToPlatformAdminUserId: req.platformAdminSession!.platformAdminUserId } : {}),
    },
    orderBy: { createdAt: "desc" },
    // GAP DE AUDITORIA FECHADO (Rodada 12): sem teto, a fila de chamados crescia
    // sem limite de resposta — justamente o endpoint mais crítico durante um
    // incidente, quando o volume de chamados costuma picar. Ordenado por mais
    // recente primeiro, então o teto nunca esconde o que é mais urgente agora;
    // chamados antigos resolvidos continuam filtráveis por status.
    take: 300,
  });
  return res.json({ success: true, data: tickets, error: null });
});

platformAdminRouter.get("/platform-admin/support-tickets/:id", requirePlatformAdminAuth, async (req: Request, res: Response) => {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: req.params.id },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!ticket) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Chamado não encontrado." } });
  }
  return res.json({ success: true, data: ticket, error: null });
});

const patchTicketSchema = z.object({
  assignedToPlatformAdminUserId: z.string().uuid().nullable().optional(),
  status: z.enum(["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER", "RESOLVED", "CLOSED"]).optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
});

platformAdminRouter.patch("/platform-admin/support-tickets/:id", requirePlatformAdminAuth, async (req: Request, res: Response) => {
  const parsed = patchTicketSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const existing = await prisma.supportTicket.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Chamado não encontrado." } });
  }
  const updated = await prisma.supportTicket.update({
    where: { id: existing.id },
    data: {
      ...parsed.data,
      resolvedAt: parsed.data.status === "RESOLVED" ? new Date() : existing.resolvedAt,
    },
  });
  // GAP DE AUDITORIA FECHADO (Rodada 12): reatribuição/mudança de status e
  // prioridade de chamado não deixava NENHUM rastro no audit log da plataforma,
  // diferente de feature flags, parâmetros, revogação de chave, etc. — uma
  // mudança de status/responsável que afete um litígio ou incidente de cliente
  // precisa de trilha imutável igual a qualquer outra ação sensível do painel.
  await writeAuditLog(req, "SUPPORT_TICKET_UPDATED", "SupportTicket", existing.id, { changes: parsed.data });
  return res.json({ success: true, data: updated, error: null });
});

const addTicketMessageSchema = z.object({ body: z.string().min(1), attachmentUrls: z.array(z.string()).default([]) });

platformAdminRouter.post("/platform-admin/support-tickets/:id/messages", requirePlatformAdminAuth, async (req: Request, res: Response) => {
  const parsed = addTicketMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const ticket = await prisma.supportTicket.findUnique({ where: { id: req.params.id } });
  if (!ticket) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Chamado não encontrado." } });
  }
  const message = await prisma.supportTicketMessage.create({
    data: {
      ticketId: ticket.id,
      authorType: "PLATFORM_ADMIN",
      authorId: req.platformAdminSession!.platformAdminUserId,
      body: parsed.data.body,
      attachmentUrls: parsed.data.attachmentUrls,
    },
  });
  // GAP DE AUDITORIA FECHADO (Rodada 12): resposta de admin a um chamado (pode
  // conter decisão de reembolso, compromisso de prazo, etc.) não era auditada.
  await writeAuditLog(req, "SUPPORT_TICKET_MESSAGE_SENT", "SupportTicket", ticket.id, { messageId: message.id });
  return res.status(201).json({ success: true, data: message, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// OVERSIGHT DE API KEYS E WEBHOOKS DOS TENANTS (Capítulo 15.4)
// ─────────────────────────────────────────────────────────────────────────

platformAdminRouter.get("/platform-admin/tenants/:tenantId/api-keys", requirePlatformAdminAuth, async (req: Request, res: Response) => {
  const keys = await prisma.tenantApiKey.findMany({ where: { tenantId: req.params.tenantId }, orderBy: { createdAt: "desc" }, take: 500 });
  return res.json({ success: true, data: keys, error: null });
});

platformAdminRouter.post("/platform-admin/tenant-api-keys/:id/revoke", requirePlatformAdminAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  const key = await prisma.tenantApiKey.findUnique({ where: { id: req.params.id } });
  if (!key) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Chave de API não encontrada." } });
  }
  const updated = await prisma.tenantApiKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } });
  await writeAuditLog(req, "API_KEY_REVOKED", "TenantApiKey", key.id, { tenantId: key.tenantId, label: key.label });
  return res.json({ success: true, data: updated, error: null });
});

platformAdminRouter.get("/platform-admin/tenants/:tenantId/webhook-endpoints", requirePlatformAdminAuth, async (req: Request, res: Response) => {
  const endpoints = await prisma.tenantWebhookEndpoint.findMany({ where: { tenantId: req.params.tenantId }, orderBy: { createdAt: "desc" }, take: 200 });
  return res.json({ success: true, data: endpoints, error: null });
});

platformAdminRouter.get("/platform-admin/webhook-endpoints/:id/deliveries", requirePlatformAdminAuth, async (req: Request, res: Response) => {
  const deliveries = await prisma.webhookDelivery.findMany({
    where: { endpointId: req.params.id },
    orderBy: { deliveredAt: "desc" },
    take: 100,
  });
  return res.json({ success: true, data: deliveries, error: null });
});

// Reenvio manual de uma entrega falha — enfileira um novo job na MESMA fila
// BullMQ (webhook-delivery) consumida por webhook-delivery.worker.ts, que faz o
// disparo HTTP real com assinatura HMAC-SHA256 e grava uma nova linha em
// WebhookDelivery com o resultado. Nunca duplica a lógica de entrega aqui.
platformAdminRouter.post("/platform-admin/webhook-deliveries/:id/replay", requirePlatformAdminAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  const delivery = await prisma.webhookDelivery.findUnique({ where: { id: req.params.id }, include: { endpoint: true } });
  if (!delivery) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Entrega de webhook não encontrada." } });
  }
  if (!delivery.endpoint.active) {
    return res.status(409).json({ success: false, data: null, error: { code: "ENDPOINT_INACTIVE", message: "O endpoint de destino está inativo." } });
  }
  // GAP DE AUDITORIA FECHADO (mega-audit rodada 10): nada impedia reenviar uma
  // entrega que já teve SUCESSO — um operador clicando no item errado da lista
  // (ou um script malicioso) reenviaria um evento sensível (ex.: dados de venda)
  // uma segunda vez ao endpoint do tenant sem necessidade nenhuma. Reenvio manual
  // só faz sentido para corrigir uma falha; restringido à ação de super-admin
  // (mesmo nível de `requireSuperAdmin` já exigido para revogar API keys).
  if (delivery.success) {
    return res.status(409).json({ success: false, data: null, error: { code: "DELIVERY_ALREADY_SUCCEEDED", message: "Esta entrega já foi bem-sucedida — reenvio manual é reservado para entregas que falharam." } });
  }
  await webhookDeliveryQueue.add(
    "deliver",
    { endpointId: delivery.endpointId, eventType: delivery.eventType, payload: delivery.payload as Record<string, unknown> } satisfies WebhookDeliveryJobData,
    { attempts: 6, backoff: { type: "exponential", delay: 5_000 } },
  );
  await writeAuditLog(req, "WEBHOOK_REPLAY_REQUESTED", "WebhookDelivery", delivery.id, { endpointId: delivery.endpointId, eventType: delivery.eventType, originalDeliveryId: delivery.id });
  return res.status(202).json({ success: true, data: { id: delivery.id, replayQueued: true }, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// PLANOS E CATÁLOGO DE MÓDULOS (Capítulo 2.9/13.3) — GAP DE AUDITORIA FECHADO:
// `Plan`/`Module` só podiam ser criados/editados via seed script (prisma/seed.ts),
// nunca por tela de admin — o dono do SaaS dependia de acesso direto ao banco
// para lançar um novo plano ou ajustar preço de módulo à la carte. Agora CRUD
// completo, restrito a SUPER_ADMIN para mutação, com invalidação do cache Redis
// de módulos ativos quando um módulo é desativado (nenhum tenant deve continuar
// usando um módulo removido do catálogo global por engano de cache).
// ─────────────────────────────────────────────────────────────────────────

platformAdminRouter.get("/platform-admin/plans", requirePlatformAdminAuth, async (_req: Request, res: Response) => {
  const plans = await prisma.plan.findMany({ orderBy: { basePrice: "asc" } });
  return res.json({ success: true, data: plans, error: null });
});

const planSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  basePrice: z.number().min(0),
  includedModules: z.array(z.string()).default([]),
  active: z.boolean().default(true),
  audience: z.enum(["BUSINESS", "PERSONAL", "BOTH"]).default("BUSINESS"),
  maxConnectedAccounts: z.number().int().min(0).nullable().optional(),
  includedUserSeats: z.number().int().min(0).nullable().optional(),
  extraUserSeatPrice: z.number().min(0).nullable().optional(),
});

platformAdminRouter.post("/platform-admin/plans", requirePlatformAdminAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  const parsed = planSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const existing = await prisma.plan.findUnique({ where: { code: parsed.data.code } });
  if (existing) {
    return res.status(409).json({ success: false, data: null, error: { code: "DUPLICATE_CODE", message: "Já existe um plano com este código." } });
  }
  // GAP DE AUDITORIA FECHADO (Rodada 13): criação do plano e o registro de
  // auditoria eram duas escritas separadas — uma falha entre as duas deixava
  // um Plan criado sem nenhum rastro de quem o criou.
  const plan = await prisma.$transaction(async (tx) => {
    const created = await tx.plan.create({ data: parsed.data });
    await tx.auditLog.create({
      data: {
        platformAdminUserId: req.platformAdminSession!.platformAdminUserId,
        action: "PLAN_CREATED",
        targetType: "Plan",
        targetId: created.id,
        metadata: { code: created.code, basePrice: created.basePrice.toString() } as any,
      },
    });
    return created;
  });
  return res.status(201).json({ success: true, data: plan, error: null });
});

const patchPlanSchema = planSchema.partial().omit({ code: true });

platformAdminRouter.patch("/platform-admin/plans/:id", requirePlatformAdminAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  const parsed = patchPlanSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const existing = await prisma.plan.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Plano não encontrado." } });
  }
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.plan.update({ where: { id: existing.id }, data: parsed.data });
    await tx.auditLog.create({
      data: {
        platformAdminUserId: req.platformAdminSession!.platformAdminUserId,
        action: "PLAN_UPDATED",
        targetType: "Plan",
        targetId: existing.id,
        metadata: { changes: parsed.data } as any,
      },
    });
    return result;
  });
  return res.json({ success: true, data: updated, error: null });
});

platformAdminRouter.get("/platform-admin/modules", requirePlatformAdminAuth, async (_req: Request, res: Response) => {
  const modules = await prisma.module.findMany({ orderBy: { monthlyPrice: "asc" } });
  return res.json({ success: true, data: modules, error: null });
});

const moduleSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  monthlyPrice: z.number().min(0),
  description: z.string().min(1),
  active: z.boolean().default(true),
});

platformAdminRouter.post("/platform-admin/modules", requirePlatformAdminAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  const parsed = moduleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const existing = await prisma.module.findUnique({ where: { code: parsed.data.code } });
  if (existing) {
    return res.status(409).json({ success: false, data: null, error: { code: "DUPLICATE_CODE", message: "Já existe um módulo com este código." } });
  }
  const created = await prisma.$transaction(async (tx) => {
    const result = await tx.module.create({ data: parsed.data });
    await tx.auditLog.create({
      data: {
        platformAdminUserId: req.platformAdminSession!.platformAdminUserId,
        action: "MODULE_CREATED",
        targetType: "Module",
        targetId: result.id,
        metadata: { code: result.code, monthlyPrice: result.monthlyPrice.toString() } as any,
      },
    });
    return result;
  });
  return res.status(201).json({ success: true, data: created, error: null });
});

const patchModuleSchema = moduleSchema.partial().omit({ code: true });

platformAdminRouter.patch("/platform-admin/modules/:id", requirePlatformAdminAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  const parsed = patchModuleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const existing = await prisma.module.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Módulo não encontrado." } });
  }
  // GAP DE AUDITORIA FECHADO (Rodada 13): update + audit log eram escritas
  // separadas (mesmo problema de Plan acima), e a invalidação de cache Redis
  // rodava ENTRE o update e o audit log — uma falha no audit log deixava o
  // módulo já invisível para os tenants (cache invalidado) mas sem nenhum
  // registro de quem/quando desativou. Agora: update + audit log atômicos
  // primeiro, invalidação de cache (efeito colateral externo ao Postgres,
  // não pode entrar no `$transaction`) só depois que a transação confirma.
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.module.update({ where: { id: existing.id }, data: parsed.data });
    await tx.auditLog.create({
      data: {
        platformAdminUserId: req.platformAdminSession!.platformAdminUserId,
        action: "MODULE_CATALOG_UPDATED",
        targetType: "Module",
        targetId: existing.id,
        metadata: { changes: parsed.data } as any,
      },
    });
    return result;
  });

  // Se o módulo foi desativado no catálogo global, nenhum tenant que já tinha o
  // cache Redis populado (TTL de 60s, ver gatekeeper.middleware.ts) deve continuar
  // com acesso liberado até o cache expirar sozinho — invalidamos proativamente
  // para TODOS os tenants que o contratam (consistência imediata > esperar TTL).
  if (parsed.data.active === false && existing.active === true) {
    const tenantModules = await prisma.tenantModule.findMany({ where: { moduleCode: existing.code, active: true }, select: { tenantId: true } });
    await Promise.all(tenantModules.map((tm) => invalidateTenantModuleCache(tm.tenantId)));
  }
  return res.json({ success: true, data: updated, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// Utilitário exportado para o módulo tenant-facing de API keys (hash simétrico)
// ─────────────────────────────────────────────────────────────────────────

export function hashApiKey(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

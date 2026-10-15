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
// PENDENTE (flagado explicitamente): dashboard de saúde do sistema em tempo
// real (Capítulo 15.1 — exigiria métricas live de Postgres/Redis/filas, não
// implementado), motor de impersonation (`ImpersonationSession`, Capítulo
// 13.1), retry automático com backoff exponencial de `WebhookDelivery`
// (Capítulo 15.4 — aqui só o replay manual está implementado).
import { Router, Request, Response } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import { prismaUnscoped as prisma } from "@filitech/db";
import { requirePlatformAdminAuth, requireSuperAdmin } from "./platform-admin-auth.middleware";
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

platformAdminRouter.get("/platform-admin/tenants", requirePlatformAdminAuth, async (req: Request, res: Response) => {
  const { status, search } = req.query as { status?: string; search?: string };
  const tenants = await prisma.tenant.findMany({
    where: {
      ...(status ? { status: status as any } : {}),
      ...(search ? { OR: [{ legalName: { contains: search, mode: "insensitive" } }, { tradeName: { contains: search, mode: "insensitive" } }, { slug: { contains: search, mode: "insensitive" } }] } : {}),
    },
    orderBy: { tradeName: "asc" },
    take: 100,
  });
  return res.json({ success: true, data: tenants, error: null });
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
  const updated = await prisma.tenant.update({ where: { id: tenant.id }, data: { status: parsed.data.status } });
  await writeAuditLog(req, "TENANT_STATUS_CHANGED", "Tenant", tenant.id, { from: tenant.status, to: parsed.data.status, reason: parsed.data.reason });
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
// assinaturas reais (`Subscription`/`Plan`), nunca de um número hardcoded ou
// estimado: MRR é a soma do `basePrice` do plano de cada assinatura ACTIVE
// (TRIAL/PAST_DUE/SUSPENDED/CANCELLED não contam como receita recorrente
// confirmada — mesmo critério usado por qualquer ferramenta de billing real).
// ─────────────────────────────────────────────────────────────────────────

platformAdminRouter.get("/platform-admin/revenue-dashboard", requirePlatformAdminAuth, async (_req: Request, res: Response) => {
  const subscriptions = await prisma.subscription.findMany({
    include: { plan: { select: { id: true, code: true, label: true, basePrice: true, audience: true } } },
  });

  const mrrByPlan = new Map<string, { planCode: string; planLabel: string; activeCount: number; mrr: number }>();
  let totalMrr = 0;
  const countByStatus: Record<string, number> = { TRIAL: 0, ACTIVE: 0, PAST_DUE: 0, SUSPENDED: 0, CANCELLED: 0 };

  for (const sub of subscriptions) {
    countByStatus[sub.status] = (countByStatus[sub.status] ?? 0) + 1;
    if (sub.status !== "ACTIVE") continue;
    const planPrice = Number(sub.plan.basePrice);
    totalMrr += planPrice;
    const bucket = mrrByPlan.get(sub.plan.id) ?? { planCode: sub.plan.code, planLabel: sub.plan.label, activeCount: 0, mrr: 0 };
    bucket.activeCount += 1;
    bucket.mrr += planPrice;
    mrrByPlan.set(sub.plan.id, bucket);
  }

  // Churn do mês corrente: assinaturas canceladas cujo `cancelRequestedAt` caiu
  // dentro do mês atual — aproximação real (não estimada) de churn mensal.
  const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const churnedThisMonth = subscriptions.filter((s) => s.status === "CANCELLED" && s.cancelRequestedAt && s.cancelRequestedAt >= startOfMonth).length;

  return res.json({
    success: true,
    data: {
      totalMrr,
      arr: totalMrr * 12,
      countByStatus,
      byPlan: Array.from(mrrByPlan.values()),
      churnedThisMonth,
      totalSubscriptions: subscriptions.length,
    },
    error: null,
  });
});

// ─────────────────────────────────────────────────────────────────────────
// AUDIT LOG (somente leitura — tabela append-only, Capítulo 13.4)
// ─────────────────────────────────────────────────────────────────────────

platformAdminRouter.get("/platform-admin/audit-logs", requirePlatformAdminAuth, async (req: Request, res: Response) => {
  const { targetType, targetId } = req.query as { targetType?: string; targetId?: string };
  const logs = await prisma.auditLog.findMany({
    where: { ...(targetType ? { targetType } : {}), ...(targetId ? { targetId } : {}) },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return res.json({ success: true, data: logs, error: null });
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
  const parameters = await prisma.systemParameter.findMany({ orderBy: { key: "asc" } });
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
  const updated = await prisma.systemParameter.update({
    where: { key: existing.key },
    data: { value: parsed.data.value, updatedByPlatformAdminUserId: req.platformAdminSession!.platformAdminUserId },
  });
  await writeAuditLog(req, "PARAMETER_UPDATED", "SystemParameter", existing.key, { from: existing.value, to: parsed.data.value });
  return res.json({ success: true, data: updated, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// FEATURE FLAGS (Capítulo 15.2)
// ─────────────────────────────────────────────────────────────────────────

platformAdminRouter.get("/platform-admin/feature-flags", requirePlatformAdminAuth, async (_req: Request, res: Response) => {
  const flags = await prisma.featureFlag.findMany({ orderBy: { key: "asc" } });
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
  return res.status(201).json({ success: true, data: message, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// OVERSIGHT DE API KEYS E WEBHOOKS DOS TENANTS (Capítulo 15.4)
// ─────────────────────────────────────────────────────────────────────────

platformAdminRouter.get("/platform-admin/tenants/:tenantId/api-keys", requirePlatformAdminAuth, async (req: Request, res: Response) => {
  const keys = await prisma.tenantApiKey.findMany({ where: { tenantId: req.params.tenantId }, orderBy: { createdAt: "desc" } });
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
  const endpoints = await prisma.tenantWebhookEndpoint.findMany({ where: { tenantId: req.params.tenantId } });
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
platformAdminRouter.post("/platform-admin/webhook-deliveries/:id/replay", requirePlatformAdminAuth, async (req: Request, res: Response) => {
  const delivery = await prisma.webhookDelivery.findUnique({ where: { id: req.params.id }, include: { endpoint: true } });
  if (!delivery) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Entrega de webhook não encontrada." } });
  }
  if (!delivery.endpoint.active) {
    return res.status(409).json({ success: false, data: null, error: { code: "ENDPOINT_INACTIVE", message: "O endpoint de destino está inativo." } });
  }
  await webhookDeliveryQueue.add(
    "deliver",
    { endpointId: delivery.endpointId, eventType: delivery.eventType, payload: delivery.payload as Record<string, unknown> } satisfies WebhookDeliveryJobData,
    { attempts: 6, backoff: { type: "exponential", delay: 5_000 } },
  );
  await writeAuditLog(req, "WEBHOOK_REPLAY_REQUESTED", "WebhookDelivery", delivery.id, { endpointId: delivery.endpointId, eventType: delivery.eventType });
  return res.status(202).json({ success: true, data: { id: delivery.id, replayQueued: true }, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// Utilitário exportado para o módulo tenant-facing de API keys (hash simétrico)
// ─────────────────────────────────────────────────────────────────────────

export function hashApiKey(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

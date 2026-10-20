// apps/api/src/modules/accounting-office/accounting-office.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 21.18 (Módulo de Escritório de
// Contabilidade dentro do SaaS — marketplace de contadores, procuração
// eletrônica interna, tarefas recorrentes e documentos oficiais).
// GAP DE AUDITORIA ENCONTRADO E CORRIGIDO: `AccountingEngagement`,
// `AccountingEngagementAuditEvent`, `AccountingTask`, `OfficialTaxDocument` e
// `AccountingFirmProfile` existem no schema desde o início, e o Capítulo
// 21.18.3 já descrevia `assertAccountingAccess()`/o ciclo de vida do vínculo
// em pseudocódigo, mas NENHUM desses arquivos existia de fato — zero rota
// REST, zero `assertAccountingAccess()` real.
// ESCOPO DESTA 1ª IMPLEMENTAÇÃO (honestamente delimitado, sem mock):
//   - Ciclo de vida completo do vínculo (conceder/aceitar/revogar) com trilha
//     de auditoria real.
//   - CRUD de leitura/atualização de `AccountingTask`, com GERAÇÃO AUTOMÁTICA
//     mensal real via cron (Capítulo 21.18.4 — GAP FECHADO na Rodada 4, ver
//     `workers/accounting-recurring-tasks.worker.ts`: gera DAS/DARF/folha/
//     EFD-Reinf/DCTFWeb todo mês e ECD/ECF/DEFIS/IRPF em janeiro, a partir do
//     `taxRegime` real de cada tenant-cliente com vínculo ACTIVE).
//   - Geração real de ECD (SPED Contábil, blocos 0/I/J/9) e DEFIS (receita
//     bruta mensal real) — `sped-ecd.service.ts`. ECF/EFD-Reinf/DCTFWeb/
//     Informe de Rendimentos do Sócio permanecem PENDENTES (Capítulo
//     21.18.5/21.18.10/21.18.11/21.18.12) — exigem dado-fonte de folha/
//     eSocial/sócios que este schema não modela; ver justificativa completa
//     no cabeçalho de `sped-ecd.service.ts`.
//   - CRUD de `AccountingFirmProfile` (perfil público do escritório no
//     marketplace — Capítulo 21.18.6, sem busca/listagem pública ainda).
// PENDENTE (flagado explicitamente, não escondido): geração real de
// ECF/EFD-Reinf/DCTFWeb/Informe de Rendimentos do Sócio
// (21.18.5/21.18.10/21.18.11/21.18.12 — dado-fonte inexistente no schema),
// marketplace de busca pública + reviews (21.18.6/21.18.9), espelhamento
// automático de honorário em AP/AR (21.18.8), módulo sócios/pró-labore/IRPF
// (21.18.12).
import { Router, Request, Response } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";
import { requireModule } from "../../middlewares/gatekeeper.middleware";
import { readEnumQuery } from "../../lib/query-enum";
import {
  grantAccountingEngagement,
  acceptAccountingEngagement,
  revokeAccountingEngagement,
  assertAccountingAccess,
  assertAccountingAccessBatch,
  EngagementNotAcceptableError,
  EngagementAcceptanceExpiredError,
  NoActiveEngagementError,
  DuplicateActiveEngagementError,
  EngagementNotRevocableError,
} from "../../services/accounting-office/engagement.service";
import { presignObjectDownload } from "../../lib/object-storage";
import { hasPermission } from "../../lib/permission-cache";
import { accountingDocumentGenerationQueue } from "../../lib/queue";
import type { AccountingDocumentGenerationJobData } from "../../workers/accounting-document-generation.worker";

export const accountingOfficeRouter = Router();

// CORREÇÃO DE AUDITORIA (fa-perf-permission-check-no-cache): `hasPermission()` local
// (2 `findUnique` por chamada, em TODA rota deste módulo) foi substituída pela versão
// compartilhada com cache Redis de 60s (`lib/permission-cache.ts`).

async function requireManage(req: Request, res: Response): Promise<boolean> {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(tenantId, role, userId, "accounting-office:engagement:manage"))) {
    res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite gerenciar vínculos contábeis." } });
    return false;
  }
  return true;
}

async function requireTaskRead(req: Request, res: Response): Promise<boolean> {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(tenantId, role, userId, "accounting-office:task:read"))) {
    res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite consultar tarefas contábeis." } });
    return false;
  }
  return true;
}

async function requireTaskWrite(req: Request, res: Response): Promise<boolean> {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(tenantId, role, userId, "accounting-office:task:write"))) {
    res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite atualizar tarefas contábeis." } });
    return false;
  }
  return true;
}

async function requireDocumentRead(req: Request, res: Response): Promise<boolean> {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(tenantId, role, userId, "accounting-office:document:read"))) {
    res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite consultar documentos oficiais." } });
    return false;
  }
  return true;
}

async function requireDocumentWrite(req: Request, res: Response): Promise<boolean> {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(tenantId, role, userId, "accounting-office:document:write"))) {
    res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite gerar documentos oficiais." } });
    return false;
  }
  return true;
}

async function requirePartnerRead(req: Request, res: Response): Promise<boolean> {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(tenantId, role, userId, "accounting-office:partner:read"))) {
    res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite consultar sócios/pró-labore." } });
    return false;
  }
  return true;
}

async function requirePartnerManage(req: Request, res: Response): Promise<boolean> {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(tenantId, role, userId, "accounting-office:partner:manage"))) {
    res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite cadastrar sócios/lançar pró-labore." } });
    return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────
// PERFIL DO ESCRITÓRIO (Capítulo 21.18.1/21.18.6)
// ─────────────────────────────────────────────────────────────────────────

accountingOfficeRouter.get("/accounting-firm-profile", requireAuth, requireModule("ACCOUNTING_OFFICE"), async (req: Request, res: Response) => {
  const { tenantId } = req.session!;
  const profile = await prisma.accountingFirmProfile.findUnique({ where: { tenantId } });
  return res.json({ success: true, data: profile, error: null });
});

const upsertFirmProfileSchema = z.object({
  crcNumber: z.string().min(1),
  responsibleAccountantName: z.string().min(1),
  responsibleAccountantCrc: z.string().min(1),
  bio: z.string().optional(),
  servicesOffered: z.array(z.string()).default([]),
  baseMonthlyFee: z.number().optional(),
  isListedInMarketplace: z.boolean().default(false),
});

accountingOfficeRouter.put("/accounting-firm-profile", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireManage(req, res))) return;
  const parsed = upsertFirmProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const { tenantId } = req.session!;
  const data = { ...parsed.data, servicesOffered: parsed.data.servicesOffered as any };
  const profile = await prisma.accountingFirmProfile.upsert({
    where: { tenantId },
    create: { tenantId, ...data },
    update: data,
  });
  return res.json({ success: true, data: profile, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// VÍNCULO (PROCURAÇÃO ELETRÔNICA INTERNA) — Capítulo 21.18.2/21.18.3
// ─────────────────────────────────────────────────────────────────────────

accountingOfficeRouter.get("/accounting-engagements", requireAuth, requireModule("ACCOUNTING_OFFICE"), async (req: Request, res: Response) => {
  if (!(await requireManage(req, res))) return;
  const { tenantId } = req.session!;
  // CORREÇÃO DE AUDITORIA (fa-w6-api-unbounded-lists-batch): upgrade do teto
  // simples `take:200` (correção de rodada anterior) para paginação completa
  // page/pageSize+meta, mesmo padrão de `suppliers.routes.ts`.
  const page = Math.max(1, Number.parseInt(String(req.query.page ?? "1"), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(req.query.pageSize ?? "50"), 10) || 50));
  const where = { OR: [{ clientTenantId: tenantId }, { accountingFirmTenantId: tenantId }] };
  const [engagements, total] = await Promise.all([
    prisma.accountingEngagement.findMany({ where, orderBy: { grantedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.accountingEngagement.count({ where }),
  ]);
  return res.json({ success: true, data: engagements, error: null, meta: { page, pageSize, total } });
});

const grantEngagementSchema = z.object({
  accountingFirmTenantId: z.string().uuid(),
  // Enum fechado (AccountingEngagementScope): string livre faria o Prisma lançar 500 em valor inválido.
  scopes: z.array(z.enum(["FULL_BOOKKEEPING", "TAX_FILING", "PAYROLL_ESOCIAL", "PERSONAL_INCOME_TAX", "DOCUMENT_EXPORT_ONLY"])).min(1),
});

// Concedida pelo tenant-cliente (lojista/residência): "contratar/autorizar meu contador".
accountingOfficeRouter.post("/accounting-engagements", requireAuth, requireModule("ACCOUNTING_OFFICE"), async (req: Request, res: Response) => {
  if (!(await requireManage(req, res))) return;
  const parsed = grantEngagementSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const { tenantId, userId } = req.session!;

  const firmTenant = await prisma.tenant.findUnique({ where: { id: parsed.data.accountingFirmTenantId } });
  if (!firmTenant || firmTenant.tenantType !== "ACCOUNTING_OFFICE") {
    return res.status(400).json({ success: false, data: null, error: { code: "INVALID_FIRM_TENANT", message: "O tenant informado não é um escritório de contabilidade válido." } });
  }

  const engagement = await grantAccountingEngagement({
    clientTenantId: tenantId,
    accountingFirmTenantId: parsed.data.accountingFirmTenantId,
    scopes: parsed.data.scopes,
    grantedByUserId: userId,
  }).catch((err) => {
    // P2002 cobre a corrida residual entre a checagem em memória de
    // grantAccountingEngagement() e o índice único parcial do banco (ver migration
    // 20261112103000) — duas requisições simultâneas podem ambas passar pela
    // checagem antes de qualquer uma commitar; o índice garante que só uma vence.
    if (err instanceof DuplicateActiveEngagementError) return null;
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return null;
    throw err;
  });
  if (!engagement) {
    return res.status(409).json({ success: false, data: null, error: { code: "DUPLICATE_ENGAGEMENT", message: "Já existe um vínculo ativo ou pendente de aceite com este escritório." } });
  }
  return res.status(201).json({ success: true, data: engagement, error: null });
});

// Aceita pelo tenant-escritório, dentro da janela de 30 dias.
accountingOfficeRouter.post("/accounting-engagements/:id/accept", requireAuth, requireModule("ACCOUNTING_OFFICE"), async (req: Request, res: Response) => {
  if (!(await requireManage(req, res))) return;
  const { tenantId, userId } = req.session!;
  const engagement = await prisma.accountingEngagement.findUnique({ where: { id: req.params.id } });
  if (!engagement) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Vínculo não encontrado." } });
  }
  if (engagement.accountingFirmTenantId !== tenantId) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Somente o escritório destinatário pode aceitar este vínculo." } });
  }
  try {
    const updated = await acceptAccountingEngagement(engagement.id, userId);
    return res.json({ success: true, data: updated, error: null });
  } catch (err) {
    if (err instanceof EngagementNotAcceptableError) {
      return res.status(409).json({ success: false, data: null, error: { code: "ENGAGEMENT_NOT_ACCEPTABLE", message: err.message } });
    }
    if (err instanceof EngagementAcceptanceExpiredError) {
      return res.status(410).json({ success: false, data: null, error: { code: "ENGAGEMENT_ACCEPTANCE_EXPIRED", message: err.message } });
    }
    throw err;
  }
});

const revokeEngagementSchema = z.object({ reason: z.string().optional() });

// Revogada por qualquer um dos dois lados (Capítulo 21.18.3 — simetria com o e-CAC real).
accountingOfficeRouter.post("/accounting-engagements/:id/revoke", requireAuth, requireModule("ACCOUNTING_OFFICE"), async (req: Request, res: Response) => {
  if (!(await requireManage(req, res))) return;
  const { tenantId, userId } = req.session!;
  const engagement = await prisma.accountingEngagement.findUnique({ where: { id: req.params.id } });
  if (!engagement) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Vínculo não encontrado." } });
  }
  let side: "CLIENT" | "ACCOUNTANT";
  if (engagement.clientTenantId === tenantId) side = "CLIENT";
  else if (engagement.accountingFirmTenantId === tenantId) side = "ACCOUNTANT";
  else {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Este tenant não participa deste vínculo." } });
  }
  if (engagement.status !== "ACTIVE" && engagement.status !== "PENDING_ACCOUNTANT_ACCEPTANCE") {
    return res.status(409).json({ success: false, data: null, error: { code: "ENGAGEMENT_NOT_REVOCABLE", message: `Vínculo em status "${engagement.status}" não pode ser revogado.` } });
  }
  const parsed = revokeEngagementSchema.safeParse(req.body ?? {});
  try {
    const updated = await revokeAccountingEngagement(engagement.id, userId, side, parsed.success ? parsed.data.reason : undefined);
    return res.json({ success: true, data: updated, error: null });
  } catch (err) {
    // Defesa em profundidade: a mesma regra já é checada acima (early-return mais
    // rápido, sem round-trip extra no caso comum), mas o serviço revalida contra o
    // estado mais recente do banco — cobre a corrida de duas revogações concorrentes.
    if (err instanceof EngagementNotRevocableError) {
      return res.status(409).json({ success: false, data: null, error: { code: "ENGAGEMENT_NOT_REVOCABLE", message: err.message } });
    }
    throw err;
  }
});

// ─────────────────────────────────────────────────────────────────────────
// CARTEIRA DE CLIENTES DO ESCRITÓRIO (Capítulo 21.18.6) — GAP DE AUDITORIA
// FECHADO: a Bible exige que o próprio tenant ACCOUNTING_OFFICE tenha uma
// visão agregada de todos os clientes vinculados + fila de tarefas
// consolidada, em vez de depender da mesma tela genérica do lado cliente.
// ─────────────────────────────────────────────────────────────────────────

accountingOfficeRouter.get("/accounting-firm-portfolio", requireAuth, requireModule("ACCOUNTING_OFFICE"), async (req: Request, res: Response) => {
  if (!(await requireTaskRead(req, res))) return;
  const { tenantId } = req.session!;

  // CORREÇÃO DE AUDITORIA (fa-w6-api-unbounded-lists-batch): upgrade do teto
  // simples `take:200` para paginação completa page/pageSize+meta (lado
  // clientes da carteira). A fila de tarefas abaixo (`pendingTasksQueue`) usa
  // parâmetros próprios `taskPage`/`taskPageSize` + `meta.tasks`, já que são
  // duas listagens independentes na mesma resposta.
  const page = Math.max(1, Number.parseInt(String(req.query.page ?? "1"), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(req.query.pageSize ?? "50"), 10) || 50));
  const engagementsWhere = { accountingFirmTenantId: tenantId, status: "ACTIVE" as const };
  const [engagements, engagementsTotal] = await Promise.all([
    prisma.accountingEngagement.findMany({
      where: engagementsWhere,
      include: { clientTenant: { select: { id: true, tradeName: true, slug: true, cnpj: true } } },
      orderBy: { grantedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.accountingEngagement.count({ where: engagementsWhere }),
  ]);

  // CORREÇÃO DE AUDITORIA: o filtro `status: "ACTIVE"` acima já restringe a query,
  // mas nenhum acesso cross-tenant real passava por `assertAccountingAccess()` —
  // a única porta oficial de acesso cross-tenant do módulo (Capítulo 7.4), que
  // também grava a trilha de auditoria (`CROSS_TENANT_ACCESS`). Revalida em uma
  // única query em lote (fa-perf-accounting-access-n-plus-1 — antes era um
  // `findFirst` + `create` de auditoria POR engagement dentro de um `Promise.all`,
  // até ~2 queries extras por item/~400 para 200 engagements) e descarta
  // silenciosamente qualquer um que tenha sido revogado entre a query acima e esta
  // checagem (corrida improvável, mas não impossível), em vez de devolver dado de
  // um vínculo não mais ativo.
  const authorizedClientTenantIds = await assertAccountingAccessBatch(
    tenantId,
    engagements.map((e) => e.clientTenantId),
  );
  const authorizedEngagements = engagements.filter((e) => authorizedClientTenantIds.has(e.clientTenantId));

  const clientTenantIds = authorizedEngagements.map((e) => e.clientTenantId);
  const taskCounts = await prisma.accountingTask.groupBy({
    by: ["clientTenantId", "status"],
    where: { accountingFirmTenantId: tenantId, clientTenantId: { in: clientTenantIds } },
    _count: { _all: true },
  });

  const countsByClient = new Map<string, { pending: number; late: number; done: number }>();
  for (const row of taskCounts) {
    const entry = countsByClient.get(row.clientTenantId) ?? { pending: 0, late: 0, done: 0 };
    if (row.status === "PENDING" || row.status === "IN_PROGRESS" || row.status === "BLOCKED") entry.pending += row._count._all;
    if (row.status === "LATE") entry.late += row._count._all;
    if (row.status === "DONE") entry.done += row._count._all;
    countsByClient.set(row.clientTenantId, entry);
  }

  const portfolio = authorizedEngagements.map((e) => ({
    engagementId: e.id,
    clientTenantId: e.clientTenantId,
    clientTradeName: e.clientTenant.tradeName,
    clientSlug: e.clientTenant.slug,
    clientCnpj: e.clientTenant.cnpj,
    scopes: e.scopes,
    grantedAt: e.grantedAt,
    tasks: countsByClient.get(e.clientTenantId) ?? { pending: 0, late: 0, done: 0 },
  }));

  const taskPage = Math.max(1, Number.parseInt(String(req.query.taskPage ?? "1"), 10) || 1);
  const taskPageSize = Math.min(100, Math.max(1, Number.parseInt(String(req.query.taskPageSize ?? "50"), 10) || 50));
  const pendingTasksWhere: Prisma.AccountingTaskWhereInput = { accountingFirmTenantId: tenantId, clientTenantId: { in: clientTenantIds }, status: { in: ["PENDING", "IN_PROGRESS", "LATE", "BLOCKED"] } };
  const [pendingTasksQueue, pendingTasksTotal] = await Promise.all([
    prisma.accountingTask.findMany({
      where: pendingTasksWhere,
      include: { clientTenant: { select: { tradeName: true, slug: true } } },
      orderBy: { dueDate: "asc" },
      skip: (taskPage - 1) * taskPageSize,
      take: taskPageSize,
    }),
    prisma.accountingTask.count({ where: pendingTasksWhere }),
  ]);

  return res.json({
    success: true,
    data: {
      clients: portfolio,
      taskQueue: pendingTasksQueue.map((t) => ({
        id: t.id,
        clientTradeName: t.clientTenant.tradeName,
        clientSlug: t.clientTenant.slug,
        taskType: t.taskType,
        competencia: t.competencia,
        dueDate: t.dueDate,
        status: t.status,
      })),
    },
    error: null,
    meta: { page, pageSize, total: engagementsTotal, tasks: { page: taskPage, pageSize: taskPageSize, total: pendingTasksTotal } },
  });
});

// ─────────────────────────────────────────────────────────────────────────
// TAREFAS RECORRENTES (Capítulo 21.18.4 — geração automática mensal real via
// `workers/accounting-recurring-tasks.worker.ts`; estas rotas cobrem a leitura
// e o ajuste manual de status pelo contador)
// ─────────────────────────────────────────────────────────────────────────

const accountingTasksQuerySchema = z.object({
  // Formato real de `AccountingTask.competencia` (ver geração em
  // accounting-recurring-tasks.worker.ts `competenciaOf()`/`yearCompetencia`):
  // "AAAA-MM" para tarefas mensais, ou "AAAA-ANUAL" para tarefas anuais
  // (ECD/ECF/DEFIS/IRPF) — aceita ambos.
  competencia: z.string().regex(/^\d{4}-(0[1-9]|1[0-2]|ANUAL)$/, "competencia deve estar no formato AAAA-MM ou AAAA-ANUAL.").optional(),
});

accountingOfficeRouter.get("/accounting-tasks", requireAuth, requireModule("ACCOUNTING_OFFICE"), async (req: Request, res: Response) => {
  if (!(await requireTaskRead(req, res))) return;
  const { tenantId } = req.session!;
  // CORREÇÃO DE AUDITORIA (fa-w6-api-accounting-office-query-unvalidated):
  // `competencia` era lido via cast direto (`as string|undefined`).
  const parsedQuery = accountingTasksQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: "Dados inválidos.", details: parsedQuery.error.flatten() } });
  }
  const { competencia } = parsedQuery.data;
  const statusParsed = readEnumQuery(res, req.query.status, ["PENDING", "IN_PROGRESS", "DONE", "LATE", "BLOCKED"] as const, "status");
  if (!statusParsed.ok) return;
  const status = statusParsed.value;

  // CORREÇÃO DE AUDITORIA: antes, o lado "escritório" via QUALQUER tarefa já
  // gravada com `accountingFirmTenantId === tenantId`, mesmo depois do vínculo
  // ser revogado pelo cliente (a tarefa em si não é apagada na revogação).
  // Restringe explicitamente o lado escritório às tarefas de clientes com
  // vínculo ATIVO, usando `assertAccountingAccess()` — a mesma porta única de
  // acesso cross-tenant do restante do módulo (Capítulo 7.4).
  const activeEngagements = await prisma.accountingEngagement.findMany({
    where: { accountingFirmTenantId: tenantId, status: "ACTIVE" },
    select: { clientTenantId: true },
    take: 500,
  });
  const activeClientIds: string[] = [];
  for (const engagement of activeEngagements) {
    try {
      await assertAccountingAccess(tenantId, engagement.clientTenantId);
      activeClientIds.push(engagement.clientTenantId);
    } catch (err) {
      if (!(err instanceof NoActiveEngagementError)) throw err;
    }
  }

  // CORREÇÃO DE AUDITORIA (fa-w6-api-unbounded-lists-batch): upgrade do teto
  // simples `take:200` para paginação completa page/pageSize+meta.
  const page = Math.max(1, Number.parseInt(String(req.query.page ?? "1"), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(req.query.pageSize ?? "50"), 10) || 50));
  const tasksWhere = {
    OR: [
      { accountingFirmTenantId: tenantId, clientTenantId: { in: activeClientIds } },
      { clientTenantId: tenantId },
    ],
    ...(competencia ? { competencia } : {}),
    ...(status ? { status } : {}),
  };
  const [tasks, total] = await Promise.all([
    prisma.accountingTask.findMany({ where: tasksWhere, orderBy: { dueDate: "asc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.accountingTask.count({ where: tasksWhere }),
  ]);
  return res.json({ success: true, data: tasks, error: null, meta: { page, pageSize, total } });
});

const updateTaskSchema = z.object({
  status: z.enum(["PENDING", "IN_PROGRESS", "DONE", "LATE", "BLOCKED"]).optional(),
  assignedUserId: z.string().uuid().nullable().optional(),
});

accountingOfficeRouter.patch("/accounting-tasks/:id", requireAuth, requireModule("ACCOUNTING_OFFICE"), async (req: Request, res: Response) => {
  if (!(await requireTaskWrite(req, res))) return;
  const parsed = updateTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const { tenantId } = req.session!;
  const task = await prisma.accountingTask.findUnique({ where: { id: req.params.id } });
  if (!task || task.accountingFirmTenantId !== tenantId) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Tarefa não encontrada." } });
  }
  // GAP DE AUDITORIA FECHADO: a leitura de tarefas (GET acima) já aceitava o
  // vínculo apenas por `accountingFirmTenantId === tenantId`, sem checar se a
  // procuração eletrônica com aquele tenant-cliente específico ainda está
  // ATIVA. Isso permitia que um escritório, mesmo após o cliente revogar o
  // vínculo, continuasse editando status/atribuição de tarefas antigas
  // referentes àquele cliente indefinidamente. Agora toda escrita exige
  // `assertAccountingAccess()` revalidando o vínculo em tempo real.
  try {
    await assertAccountingAccess(tenantId, task.clientTenantId);
  } catch (err) {
    if (err instanceof NoActiveEngagementError) {
      return res.status(403).json({ success: false, data: null, error: { code: "NO_ACTIVE_ENGAGEMENT", message: err.message } });
    }
    throw err;
  }
  const updated = await prisma.accountingTask.update({
    where: { id: task.id },
    data: {
      ...parsed.data,
      completedAt: parsed.data.status === "DONE" ? new Date() : task.completedAt,
    },
  });
  return res.json({ success: true, data: updated, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// DOCUMENTOS OFICIAIS (Capítulo 21.18.5) — GAP DE AUDITORIA FECHADO NESTA
// RODADA: geração real de ECD (SPED Contábil Digital, blocos 0/I/J/9 a partir
// dos saldos reais por conta contábil, mesma base de dados da DRE real) e
// DEFIS (receita bruta mensal real do ano-calendário). EFD-Reinf/DCTFWeb/
// Informe de Rendimentos do Sócio permanecem PENDENTES — exigem dado-fonte
// de folha/eSocial/sócios que este schema não modela (ver
// `sped-ecd.service.ts`, comentário de cabeçalho, para a justificativa
// honesta e completa do que fica fora de escopo e por quê).
// ─────────────────────────────────────────────────────────────────────────

const officialTaxDocumentsQuerySchema = z.object({
  documentType: z.enum(["ECD", "DEFIS", "ECF", "EFD_REINF", "DCTFWEB", "INFORME_RENDIMENTOS_SOCIO"]).optional(),
  clientTenantId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});

accountingOfficeRouter.get("/official-tax-documents", requireAuth, requireModule("ACCOUNTING_OFFICE"), async (req: Request, res: Response) => {
  if (!(await requireDocumentRead(req, res))) return;
  const { tenantId } = req.session!;
  // CORREÇÃO DE AUDITORIA (fa-w6-api-accounting-office-query-unvalidated):
  // `documentType`/`clientTenantId` eram lidos via cast direto (`as string|undefined`),
  // sem validar contra o enum real do Prisma nem o formato de UUID — mesmo padrão
  // de validação de enum via Zod já usado para `status` em `/accounting-tasks` abaixo.
  const parsedQuery = officialTaxDocumentsQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: "Dados inválidos.", details: parsedQuery.error.flatten() } });
  }
  const { documentType } = parsedQuery.data;

  // Caminho A (com escritório contratado): o contador acessa documentos de um
  // tenant-cliente via vínculo ATIVO, nunca por acesso direto.
  const { clientTenantId } = parsedQuery.data;
  let ownerTenantId = tenantId;
  if (clientTenantId && clientTenantId !== tenantId) {
    try {
      await assertAccountingAccess(tenantId, clientTenantId);
    } catch (err) {
      if (err instanceof NoActiveEngagementError) {
        return res.status(403).json({ success: false, data: null, error: { code: "NO_ACTIVE_ENGAGEMENT", message: err.message } });
      }
      throw err;
    }
    ownerTenantId = clientTenantId;
  }

  // CORREÇÃO DE AUDITORIA (fa-perf-accounting-docs-no-pagination): `findMany` sem
  // skip/take/select retornava TODOS os documentos do tenant (incluindo o campo
  // `fileUrl` bruto, nunca necessário na listagem). Mesmo padrão page/pageSize já
  // usado em users.routes.ts/stock.routes.ts.
  const page = parsedQuery.data.page ?? 1;
  const pageSize = parsedQuery.data.pageSize ?? 50;
  const where = { tenantId: ownerTenantId, ...(documentType ? { documentType } : {}) };

  const [documents, total] = await Promise.all([
    prisma.officialTaxDocument.findMany({
      where,
      orderBy: { generatedAt: "desc" },
      select: {
        id: true,
        tenantId: true,
        generatedByAccountingFirmTenantId: true,
        documentType: true,
        layoutVersion: true,
        competenciaInicio: true,
        competenciaFim: true,
        transmissionProtocol: true,
        rejectionReason: true,
        failureReason: true,
        status: true,
        generatedAt: true,
      },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.officialTaxDocument.count({ where }),
  ]);
  return res.json({ success: true, meta: { page, pageSize, total }, data: documents, error: null });
});

const generateDocumentSchema = z.object({
  clientTenantId: z.string().uuid().optional(), // omitido quando o próprio tenant gera para si (Caminho B, sem escritório contratado)
  documentType: z.enum(["ECD", "DEFIS", "ECF", "EFD_REINF", "DCTFWEB", "INFORME_RENDIMENTOS_SOCIO"]),
  // ECD exige período (competência contábil); DEFIS/ECF exigem apenas o ano-calendário;
  // EFD_REINF/DCTFWEB exigem competência mensal; INFORME_RENDIMENTOS_SOCIO exige
  // ano-calendário + partnerId.
  competenciaInicio: z.string().datetime().optional(),
  competenciaFim: z.string().datetime().optional(),
  calendarYear: z.number().int().min(2000).max(2100).optional(),
  competencia: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(), // "AAAA-MM"
  activityType: z.enum(["COMERCIO", "SERVICO"]).optional(), // obrigatório apenas para ECF (Lucro Presumido/Real)
  partnerId: z.string().uuid().optional(), // obrigatório apenas para INFORME_RENDIMENTOS_SOCIO
});

/**
 * Enfileira a geração do arquivo (ECD/DEFIS/ECF/EFD-Reinf/DCTFWeb/Informe de
 * Rendimentos do Sócio) via BullMQ — nunca mais síncrono dentro da requisição HTTP
 * (CORREÇÃO DE AUDITORIA fa-perf-accounting-doc-generation-inline: a geração real
 * podia envolver centenas de lançamentos contábeis + upload para o R2, arriscando
 * timeout/alto uso de memória no processo da API). A validação de formato/campos
 * obrigatórios por `documentType` continua síncrona (retorno 400 imediato,
 * nenhuma mudança de contrato para o cliente), mas a geração do conteúdo e o
 * upload passam a rodar em `workers/accounting-document-generation.worker.ts`.
 * Caminho A (contador) exige vínculo ATIVO com o tenant-cliente; Caminho B
 * (lojista autogerando) não exige vínculo nenhum.
 */
accountingOfficeRouter.post("/official-tax-documents/generate", requireAuth, requireModule("ACCOUNTING_OFFICE"), async (req: Request, res: Response) => {
  if (!(await requireDocumentWrite(req, res))) return;
  const { tenantId } = req.session!;

  const parsed = generateDocumentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }

  let ownerTenantId = tenantId;
  let generatedByAccountingFirmTenantId: string | null = null;
  if (parsed.data.clientTenantId && parsed.data.clientTenantId !== tenantId) {
    try {
      await assertAccountingAccess(tenantId, parsed.data.clientTenantId);
    } catch (err) {
      if (err instanceof NoActiveEngagementError) {
        return res.status(403).json({ success: false, data: null, error: { code: "NO_ACTIVE_ENGAGEMENT", message: err.message } });
      }
      throw err;
    }
    ownerTenantId = parsed.data.clientTenantId;
    generatedByAccountingFirmTenantId = tenantId;
  }

  let competenciaInicio: Date;
  let competenciaFim: Date;

  if (parsed.data.documentType === "ECD") {
    if (!parsed.data.competenciaInicio || !parsed.data.competenciaFim) {
      return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: "ECD exige competenciaInicio e competenciaFim." } });
    }
    competenciaInicio = new Date(parsed.data.competenciaInicio);
    competenciaFim = new Date(parsed.data.competenciaFim);
  } else if (parsed.data.documentType === "DEFIS" || parsed.data.documentType === "ECF" || parsed.data.documentType === "INFORME_RENDIMENTOS_SOCIO") {
    if (!parsed.data.calendarYear) {
      return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: `${parsed.data.documentType} exige calendarYear.` } });
    }
    if (parsed.data.documentType === "ECF" && !parsed.data.activityType) {
      return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: "ECF exige calendarYear e activityType (COMERCIO|SERVICO)." } });
    }
    if (parsed.data.documentType === "INFORME_RENDIMENTOS_SOCIO" && !parsed.data.partnerId) {
      return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: "INFORME_RENDIMENTOS_SOCIO exige calendarYear e partnerId." } });
    }
    competenciaInicio = new Date(Date.UTC(parsed.data.calendarYear, 0, 1));
    competenciaFim = new Date(Date.UTC(parsed.data.calendarYear, 11, 31, 23, 59, 59));
  } else {
    // EFD_REINF | DCTFWEB
    if (!parsed.data.competencia) {
      return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: `${parsed.data.documentType} exige competencia no formato "AAAA-MM".` } });
    }
    const [year, month] = parsed.data.competencia.split("-").map(Number);
    competenciaInicio = new Date(Date.UTC(year, month - 1, 1));
    competenciaFim = new Date(Date.UTC(year, month, 0, 23, 59, 59));
  }

  const document = await prisma.officialTaxDocument.create({
    data: {
      tenantId: ownerTenantId,
      generatedByAccountingFirmTenantId,
      documentType: parsed.data.documentType,
      competenciaInicio,
      competenciaFim,
      status: "PENDING",
    },
  });

  const jobData: AccountingDocumentGenerationJobData = {
    documentId: document.id,
    ownerTenantId,
    documentType: parsed.data.documentType,
    calendarYear: parsed.data.calendarYear,
    competencia: parsed.data.competencia,
    activityType: parsed.data.activityType,
    partnerId: parsed.data.partnerId,
    competenciaInicio: competenciaInicio.toISOString(),
    competenciaFim: competenciaFim.toISOString(),
  };
  await accountingDocumentGenerationQueue.add("generate-official-tax-document", jobData, {
    attempts: 1, // geração não é idempotente de forma segura para retry automático — falha vira status FAILED, usuário tenta de novo manualmente
    removeOnComplete: true,
  });

  return res.status(202).json({ success: true, data: document, error: null });
});

/** URL assinada de download do arquivo gerado (reaproveita o mesmo presign de leitura do R2 usado em `storage.routes.ts`). */
accountingOfficeRouter.get("/official-tax-documents/:id/download", requireAuth, requireModule("ACCOUNTING_OFFICE"), async (req: Request, res: Response) => {
  if (!(await requireDocumentRead(req, res))) return;
  const { tenantId } = req.session!;
  const document = await prisma.officialTaxDocument.findUnique({ where: { id: req.params.id } });
  if (!document) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Documento não encontrado." } });
  }
  let allowed = document.tenantId === tenantId;
  if (!allowed && document.generatedByAccountingFirmTenantId === tenantId) allowed = true;
  if (!allowed) {
    try {
      await assertAccountingAccess(tenantId, document.tenantId);
      allowed = true;
    } catch {
      allowed = false;
    }
  }
  if (!allowed) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Você não tem acesso a este documento." } });
  }
  if (!document.fileUrl) {
    // Geração ainda em andamento (PENDING/PROCESSING) ou falhou (FAILED) — nunca
    // existiu um arquivo no R2 para gerar presign.
    return res.status(409).json({
      success: false,
      data: null,
      error: { code: "DOCUMENT_NOT_READY", message: `Documento ainda não está pronto para download (status atual: ${document.status}).` },
    });
  }
  const { downloadUrl, expiresInSeconds } = await presignObjectDownload(document.tenantId, document.fileUrl);
  return res.json({ success: true, data: { downloadUrl, expiresInSeconds }, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// SÓCIOS E PRÓ-LABORE (Capítulo 21.18.12) — GAP DE AUDITORIA FECHADO: os
// modelos `CompanyPartner`/`PartnerPayout` já existiam no schema desde um
// passe anterior, mas sem NENHUMA rota/serviço consumidor (mesmo padrão do
// gap de `OnlineStoreSettings` fechado no item 11 deste mega-audit). É o
// dado-fonte real que faltava para EFD-Reinf/DCTFWeb/Informe de Rendimentos
// do Sócio (ver `ecf-reinf-dctfweb.service.ts`).
// ─────────────────────────────────────────────────────────────────────────

accountingOfficeRouter.get("/company-partners", requireAuth, requireModule("ACCOUNTING_OFFICE"), async (req: Request, res: Response) => {
  if (!(await requirePartnerRead(req, res))) return;
  const { tenantId } = req.session!;
  const partners = await prisma.companyPartner.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
  return res.json({ success: true, data: partners, error: null });
});

const upsertPartnerSchema = z.object({
  name: z.string().min(1),
  cpf: z.string().min(11),
  participationPercentage: z.number().min(0).max(100),
});

accountingOfficeRouter.post("/company-partners", requireAuth, requireModule("ACCOUNTING_OFFICE"), async (req: Request, res: Response) => {
  if (!(await requirePartnerManage(req, res))) return;
  const { tenantId } = req.session!;
  const parsed = upsertPartnerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  try {
    const partner = await prisma.companyPartner.create({
      data: { tenantId, name: parsed.data.name, cpf: parsed.data.cpf.replace(/\D/g, ""), participationPercentage: parsed.data.participationPercentage },
    });
    return res.status(201).json({ success: true, data: partner, error: null });
  } catch (err: any) {
    if (err?.code === "P2002") {
      return res.status(409).json({ success: false, data: null, error: { code: "PARTNER_CPF_ALREADY_REGISTERED", message: "Já existe um sócio cadastrado com este CPF." } });
    }
    throw err;
  }
});

accountingOfficeRouter.patch("/company-partners/:id", requireAuth, requireModule("ACCOUNTING_OFFICE"), async (req: Request, res: Response) => {
  if (!(await requirePartnerManage(req, res))) return;
  const { tenantId } = req.session!;
  const parsed = upsertPartnerSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const existing = await prisma.companyPartner.findFirst({ where: { id: req.params.id, tenantId } });
  if (!existing) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Sócio não encontrado." } });
  }
  const partner = await prisma.companyPartner.update({
    where: { id: existing.id },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.cpf !== undefined ? { cpf: parsed.data.cpf.replace(/\D/g, "") } : {}),
      ...(parsed.data.participationPercentage !== undefined ? { participationPercentage: parsed.data.participationPercentage } : {}),
    },
  });
  return res.json({ success: true, data: partner, error: null });
});

accountingOfficeRouter.delete("/company-partners/:id", requireAuth, requireModule("ACCOUNTING_OFFICE"), async (req: Request, res: Response) => {
  if (!(await requirePartnerManage(req, res))) return;
  const { tenantId } = req.session!;
  const existing = await prisma.companyPartner.findFirst({ where: { id: req.params.id, tenantId } });
  if (!existing) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Sócio não encontrado." } });
  }
  // Bloqueia a exclusão se já existir histórico de pró-labore/distribuição lançado —
  // o relacionamento é `onDelete: Cascade` no schema, mas apagar um sócio com
  // pagamentos reais já lançados destruiria o histórico auditável usado pelo
  // EFD-Reinf/DCTFWeb/Informe de Rendimentos já gerados (mesmo princípio de
  // "nunca apagar histórico fiscal" já aplicado a ChartOfAccount/CostCenter).
  const payoutCount = await prisma.partnerPayout.count({ where: { partnerId: existing.id } });
  if (payoutCount > 0) {
    return res.status(409).json({ success: false, data: null, error: { code: "PARTNER_HAS_PAYOUT_HISTORY", message: "Este sócio já possui pró-labore/distribuição lançados — não pode ser excluído (histórico fiscal). Edite o cadastro em vez de excluir." } });
  }
  // fa-w6-di-hard-deletes-critical-entities — revisado: este hard-delete é
  // ACEITÁVEL sem conversão para soft-delete, porque o guard logo acima
  // (`payoutCount > 0`) já bloqueia a exclusão sempre que existir QUALQUER
  // histórico financeiro real (`PartnerPayout`) vinculado a este sócio. Um
  // `CompanyPartner` sem nenhum pró-labore/distribuição lançado é só um cadastro de
  // sócio (nome/CPF/percentual) sem rastro contábil — equivalente a excluir um
  // cadastro de fornecedor nunca usado em nenhuma compra.
  await prisma.companyPartner.delete({ where: { id: existing.id } });
  return res.json({ success: true, data: { deleted: true }, error: null });
});

accountingOfficeRouter.get("/company-partners/:id/payouts", requireAuth, requireModule("ACCOUNTING_OFFICE"), async (req: Request, res: Response) => {
  if (!(await requirePartnerRead(req, res))) return;
  const { tenantId } = req.session!;
  const partner = await prisma.companyPartner.findFirst({ where: { id: req.params.id, tenantId } });
  if (!partner) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Sócio não encontrado." } });
  }
  const payouts = await prisma.partnerPayout.findMany({ where: { tenantId, partnerId: partner.id }, orderBy: { paidAt: "desc" } });
  return res.json({ success: true, data: payouts, error: null });
});

const createPayoutSchema = z
  .object({
    type: z.enum(["PRO_LABORE", "PROFIT_DISTRIBUTION"]),
    competencia: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    grossAmount: z.number().positive(),
    inssWithheld: z.number().min(0).default(0),
    irrfWithheld: z.number().min(0).default(0),
    paidAt: z.string().datetime(),
  })
  .refine((data) => data.type !== "PROFIT_DISTRIBUTION" || (data.inssWithheld === 0 && data.irrfWithheld === 0), {
    message: "Distribuição de lucros é isenta por lei (Lei 9.249/1995, art. 10) — inssWithheld e irrfWithheld devem ser 0.",
  })
  .refine((data) => data.inssWithheld + data.irrfWithheld <= data.grossAmount, {
    message: "A soma de inssWithheld + irrfWithheld não pode exceder grossAmount.",
  });

accountingOfficeRouter.post("/company-partners/:id/payouts", requireAuth, requireModule("ACCOUNTING_OFFICE"), async (req: Request, res: Response) => {
  if (!(await requirePartnerManage(req, res))) return;
  const { tenantId } = req.session!;
  const partner = await prisma.companyPartner.findFirst({ where: { id: req.params.id, tenantId } });
  if (!partner) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Sócio não encontrado." } });
  }
  const parsed = createPayoutSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const grossAmount = new Prisma.Decimal(parsed.data.grossAmount);
  const inssWithheld = new Prisma.Decimal(parsed.data.inssWithheld);
  const irrfWithheld = new Prisma.Decimal(parsed.data.irrfWithheld);
  const netAmount = grossAmount.minus(inssWithheld).minus(irrfWithheld);

  const payout = await prisma.partnerPayout.create({
    data: {
      tenantId,
      partnerId: partner.id,
      type: parsed.data.type,
      competencia: parsed.data.competencia,
      grossAmount,
      inssWithheld,
      irrfWithheld,
      netAmount,
      paidAt: new Date(parsed.data.paidAt),
    },
  });
  return res.status(201).json({ success: true, data: payout, error: null });
});

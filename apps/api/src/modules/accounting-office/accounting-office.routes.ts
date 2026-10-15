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
//   - CRUD de leitura/atualização de `AccountingTask` (sem geração automática
//     via cron — Capítulo 21.18.4, PENDENTE).
//   - Geração real de ECD (SPED Contábil, blocos 0/I/J/9) e DEFIS (receita
//     bruta mensal real) — `sped-ecd.service.ts`. ECF/EFD-Reinf/DCTFWeb/
//     Informe de Rendimentos do Sócio permanecem PENDENTES (Capítulo
//     21.18.5/21.18.10/21.18.11/21.18.12) — exigem dado-fonte de folha/
//     eSocial/sócios que este schema não modela; ver justificativa completa
//     no cabeçalho de `sped-ecd.service.ts`.
//   - CRUD de `AccountingFirmProfile` (perfil público do escritório no
//     marketplace — Capítulo 21.18.6, sem busca/listagem pública ainda).
// PENDENTE (flagado explicitamente, não escondido): cron de geração de
// tarefas (21.18.4), geração real de ECF/EFD-Reinf/DCTFWeb/Informe de
// Rendimentos do Sócio (21.18.5/21.18.10/21.18.11/21.18.12 — dado-fonte
// inexistente no schema), marketplace de busca pública + reviews
// (21.18.6/21.18.9), espelhamento automático de honorário em AP/AR
// (21.18.8), módulo sócios/pró-labore/IRPF (21.18.12).
import { Router, Request, Response } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";
import {
  grantAccountingEngagement,
  acceptAccountingEngagement,
  revokeAccountingEngagement,
  assertAccountingAccess,
  EngagementNotAcceptableError,
  EngagementAcceptanceExpiredError,
  NoActiveEngagementError,
} from "../../services/accounting-office/engagement.service";
import { generateSpedEcd, generateDefis, NoActiveLayoutVersionError } from "../../services/accounting-office/sped-ecd.service";
import {
  generateEcf,
  generateEfdReinf,
  generateDctfWeb,
  generateInformeRendimentosSocio,
  EcfNotApplicableError,
  NoPartnerPayoutsFoundError,
  EcfActivityType,
} from "../../services/accounting-office/ecf-reinf-dctfweb.service";
import { putObjectDirect, presignObjectDownload } from "../../lib/object-storage";

export const accountingOfficeRouter = Router();

async function hasPermission(role: string, userId: string, permissionCode: string): Promise<boolean> {
  const [defaultGrant, override] = await Promise.all([
    prisma.roleDefaultPermission.findUnique({ where: { role_permissionCode: { role: role as any, permissionCode } } }),
    prisma.rolePermission.findUnique({ where: { userId_permission: { userId, permission: permissionCode } } }),
  ]);
  return override ? override.granted : Boolean(defaultGrant);
}

async function requireManage(req: Request, res: Response): Promise<boolean> {
  const { userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "accounting-office:engagement:manage"))) {
    res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite gerenciar vínculos contábeis." } });
    return false;
  }
  return true;
}

async function requireTaskRead(req: Request, res: Response): Promise<boolean> {
  const { userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "accounting-office:task:read"))) {
    res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite consultar tarefas contábeis." } });
    return false;
  }
  return true;
}

async function requireTaskWrite(req: Request, res: Response): Promise<boolean> {
  const { userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "accounting-office:task:write"))) {
    res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite atualizar tarefas contábeis." } });
    return false;
  }
  return true;
}

async function requireDocumentRead(req: Request, res: Response): Promise<boolean> {
  const { userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "accounting-office:document:read"))) {
    res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite consultar documentos oficiais." } });
    return false;
  }
  return true;
}

async function requireDocumentWrite(req: Request, res: Response): Promise<boolean> {
  const { userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "accounting-office:document:write"))) {
    res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite gerar documentos oficiais." } });
    return false;
  }
  return true;
}

async function requirePartnerRead(req: Request, res: Response): Promise<boolean> {
  const { userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "accounting-office:partner:read"))) {
    res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite consultar sócios/pró-labore." } });
    return false;
  }
  return true;
}

async function requirePartnerManage(req: Request, res: Response): Promise<boolean> {
  const { userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "accounting-office:partner:manage"))) {
    res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite cadastrar sócios/lançar pró-labore." } });
    return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────
// PERFIL DO ESCRITÓRIO (Capítulo 21.18.1/21.18.6)
// ─────────────────────────────────────────────────────────────────────────

accountingOfficeRouter.get("/accounting-firm-profile", requireAuth, async (req: Request, res: Response) => {
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

accountingOfficeRouter.get("/accounting-engagements", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireManage(req, res))) return;
  const { tenantId } = req.session!;
  const engagements = await prisma.accountingEngagement.findMany({
    where: { OR: [{ clientTenantId: tenantId }, { accountingFirmTenantId: tenantId }] },
    orderBy: { grantedAt: "desc" },
  });
  return res.json({ success: true, data: engagements, error: null });
});

const grantEngagementSchema = z.object({
  accountingFirmTenantId: z.string().uuid(),
  // Enum fechado (AccountingEngagementScope): string livre faria o Prisma lançar 500 em valor inválido.
  scopes: z.array(z.enum(["FULL_BOOKKEEPING", "TAX_FILING", "PAYROLL_ESOCIAL", "PERSONAL_INCOME_TAX", "DOCUMENT_EXPORT_ONLY"])).min(1),
});

// Concedida pelo tenant-cliente (lojista/residência): "contratar/autorizar meu contador".
accountingOfficeRouter.post("/accounting-engagements", requireAuth, async (req: Request, res: Response) => {
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
  });
  return res.status(201).json({ success: true, data: engagement, error: null });
});

// Aceita pelo tenant-escritório, dentro da janela de 30 dias.
accountingOfficeRouter.post("/accounting-engagements/:id/accept", requireAuth, async (req: Request, res: Response) => {
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
accountingOfficeRouter.post("/accounting-engagements/:id/revoke", requireAuth, async (req: Request, res: Response) => {
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
  const updated = await revokeAccountingEngagement(engagement.id, userId, side, parsed.success ? parsed.data.reason : undefined);
  return res.json({ success: true, data: updated, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// CARTEIRA DE CLIENTES DO ESCRITÓRIO (Capítulo 21.18.6) — GAP DE AUDITORIA
// FECHADO: a Bible exige que o próprio tenant ACCOUNTING_OFFICE tenha uma
// visão agregada de todos os clientes vinculados + fila de tarefas
// consolidada, em vez de depender da mesma tela genérica do lado cliente.
// ─────────────────────────────────────────────────────────────────────────

accountingOfficeRouter.get("/accounting-firm-portfolio", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireTaskRead(req, res))) return;
  const { tenantId } = req.session!;

  const engagements = await prisma.accountingEngagement.findMany({
    where: { accountingFirmTenantId: tenantId, status: "ACTIVE" },
    include: { clientTenant: { select: { id: true, tradeName: true, slug: true, cnpj: true } } },
    orderBy: { grantedAt: "desc" },
  });

  const clientTenantIds = engagements.map((e) => e.clientTenantId);
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

  const portfolio = engagements.map((e) => ({
    engagementId: e.id,
    clientTenantId: e.clientTenantId,
    clientTradeName: e.clientTenant.tradeName,
    clientSlug: e.clientTenant.slug,
    clientCnpj: e.clientTenant.cnpj,
    scopes: e.scopes,
    grantedAt: e.grantedAt,
    tasks: countsByClient.get(e.clientTenantId) ?? { pending: 0, late: 0, done: 0 },
  }));

  const pendingTasksQueue = await prisma.accountingTask.findMany({
    where: { accountingFirmTenantId: tenantId, status: { in: ["PENDING", "IN_PROGRESS", "LATE", "BLOCKED"] } },
    include: { clientTenant: { select: { tradeName: true, slug: true } } },
    orderBy: { dueDate: "asc" },
    take: 100,
  });

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
  });
});

// ─────────────────────────────────────────────────────────────────────────
// TAREFAS RECORRENTES (Capítulo 21.18.4 — geração automática PENDENTE;
// aqui apenas leitura/atualização manual de status)
// ─────────────────────────────────────────────────────────────────────────

accountingOfficeRouter.get("/accounting-tasks", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireTaskRead(req, res))) return;
  const { tenantId } = req.session!;
  const { competencia, status } = req.query as { competencia?: string; status?: string };
  const tasks = await prisma.accountingTask.findMany({
    where: {
      OR: [{ accountingFirmTenantId: tenantId }, { clientTenantId: tenantId }],
      ...(competencia ? { competencia } : {}),
      ...(status ? { status: status as any } : {}),
    },
    orderBy: { dueDate: "asc" },
  });
  return res.json({ success: true, data: tasks, error: null });
});

const updateTaskSchema = z.object({
  status: z.enum(["PENDING", "IN_PROGRESS", "DONE", "LATE", "BLOCKED"]).optional(),
  assignedUserId: z.string().uuid().nullable().optional(),
});

accountingOfficeRouter.patch("/accounting-tasks/:id", requireAuth, async (req: Request, res: Response) => {
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

accountingOfficeRouter.get("/official-tax-documents", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireDocumentRead(req, res))) return;
  const { tenantId } = req.session!;
  const { documentType } = req.query as { documentType?: string };

  // Caminho A (com escritório contratado): o contador acessa documentos de um
  // tenant-cliente via vínculo ATIVO, nunca por acesso direto.
  const clientTenantId = req.query.clientTenantId as string | undefined;
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

  const documents = await prisma.officialTaxDocument.findMany({
    where: { tenantId: ownerTenantId, ...(documentType ? { documentType: documentType as any } : {}) },
    orderBy: { generatedAt: "desc" },
  });
  return res.json({ success: true, data: documents, error: null });
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
 * Gera de fato o arquivo (ECD/DEFIS), faz upload para R2 e persiste o
 * `OfficialTaxDocument` com status GENERATED. Caminho A (contador) exige
 * vínculo ATIVO com o tenant-cliente; Caminho B (lojista autogerando) não
 * exige vínculo nenhum.
 */
accountingOfficeRouter.post("/official-tax-documents/generate", requireAuth, async (req: Request, res: Response) => {
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

  try {
    let content: string;
    let layoutVersion: string;
    let competenciaInicio: Date;
    let competenciaFim: Date;
    let status: "GENERATED" | "DRAFT" = "GENERATED";

    if (parsed.data.documentType === "ECD") {
      if (!parsed.data.competenciaInicio || !parsed.data.competenciaFim) {
        return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: "ECD exige competenciaInicio e competenciaFim." } });
      }
      competenciaInicio = new Date(parsed.data.competenciaInicio);
      competenciaFim = new Date(parsed.data.competenciaFim);
      const result = await generateSpedEcd(ownerTenantId, competenciaInicio, competenciaFim);
      content = result.content;
      layoutVersion = result.layoutVersion;
    } else if (parsed.data.documentType === "DEFIS") {
      if (!parsed.data.calendarYear) {
        return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: "DEFIS exige calendarYear." } });
      }
      competenciaInicio = new Date(Date.UTC(parsed.data.calendarYear, 0, 1));
      competenciaFim = new Date(Date.UTC(parsed.data.calendarYear, 11, 31, 23, 59, 59));
      const result = await generateDefis(ownerTenantId, parsed.data.calendarYear);
      content = result.content;
      layoutVersion = result.layoutVersion;
    } else if (parsed.data.documentType === "ECF") {
      if (!parsed.data.calendarYear || !parsed.data.activityType) {
        return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: "ECF exige calendarYear e activityType (COMERCIO|SERVICO)." } });
      }
      competenciaInicio = new Date(Date.UTC(parsed.data.calendarYear, 0, 1));
      competenciaFim = new Date(Date.UTC(parsed.data.calendarYear, 11, 31, 23, 59, 59));
      const result = await generateEcf(ownerTenantId, parsed.data.calendarYear, parsed.data.activityType as EcfActivityType);
      content = result.content;
      layoutVersion = result.layoutVersion;
    } else if (parsed.data.documentType === "EFD_REINF" || parsed.data.documentType === "DCTFWEB") {
      if (!parsed.data.competencia) {
        return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: `${parsed.data.documentType} exige competencia no formato "AAAA-MM".` } });
      }
      const [year, month] = parsed.data.competencia.split("-").map(Number);
      competenciaInicio = new Date(Date.UTC(year, month - 1, 1));
      competenciaFim = new Date(Date.UTC(year, month, 0, 23, 59, 59));
      const result =
        parsed.data.documentType === "EFD_REINF"
          ? await generateEfdReinf(ownerTenantId, parsed.data.competencia)
          : await generateDctfWeb(ownerTenantId, parsed.data.competencia);
      content = result.content;
      layoutVersion = result.layoutVersion;
      // Ambos carregam campos de "código de receita" pendentes de confirmação do
      // contador junto à tabela vigente da RFB (ver cabeçalho de
      // ecf-reinf-dctfweb.service.ts) — nasce DRAFT, nunca GENERATED, até revisão humana.
      status = "DRAFT";
    } else {
      // INFORME_RENDIMENTOS_SOCIO — documento interno, sem leiaute SPED/transmissão a
      // órgão (ver comentário do enum OfficialTaxDocumentType), por isso não chama
      // `resolveActiveLayoutVersion`.
      if (!parsed.data.calendarYear || !parsed.data.partnerId) {
        return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: "INFORME_RENDIMENTOS_SOCIO exige calendarYear e partnerId." } });
      }
      competenciaInicio = new Date(Date.UTC(parsed.data.calendarYear, 0, 1));
      competenciaFim = new Date(Date.UTC(parsed.data.calendarYear, 11, 31, 23, 59, 59));
      const result = await generateInformeRendimentosSocio(ownerTenantId, parsed.data.partnerId, parsed.data.calendarYear);
      content = result.content;
      layoutVersion = "INTERNO — SEM LEIAUTE SPED (documento entregue ao sócio para sua própria DIRPF)";
    }

    const fileName = `${parsed.data.documentType}-${competenciaInicio.toISOString().slice(0, 10)}-${competenciaFim.toISOString().slice(0, 10)}.txt`;
    const { storageKey } = await putObjectDirect({
      tenantId: ownerTenantId,
      category: "official-tax-documents",
      fileName,
      mimeType: "text/plain",
      body: content,
    });

    const document = await prisma.officialTaxDocument.create({
      data: {
        tenantId: ownerTenantId,
        generatedByAccountingFirmTenantId,
        documentType: parsed.data.documentType,
        layoutVersion,
        competenciaInicio,
        competenciaFim,
        fileUrl: storageKey,
        status,
      },
    });

    return res.status(201).json({ success: true, data: document, error: null });
  } catch (err) {
    if (err instanceof NoActiveLayoutVersionError) {
      return res.status(422).json({ success: false, data: null, error: { code: "NO_ACTIVE_LAYOUT_VERSION", message: err.message } });
    }
    if (err instanceof EcfNotApplicableError) {
      return res.status(409).json({ success: false, data: null, error: { code: "ECF_NOT_APPLICABLE", message: err.message } });
    }
    if (err instanceof NoPartnerPayoutsFoundError) {
      return res.status(404).json({ success: false, data: null, error: { code: "NO_PARTNER_PAYOUTS_FOUND", message: err.message } });
    }
    throw err;
  }
});

/** URL assinada de download do arquivo gerado (reaproveita o mesmo presign de leitura do R2 usado em `storage.routes.ts`). */
accountingOfficeRouter.get("/official-tax-documents/:id/download", requireAuth, async (req: Request, res: Response) => {
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

accountingOfficeRouter.get("/company-partners", requireAuth, async (req: Request, res: Response) => {
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

accountingOfficeRouter.post("/company-partners", requireAuth, async (req: Request, res: Response) => {
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

accountingOfficeRouter.patch("/company-partners/:id", requireAuth, async (req: Request, res: Response) => {
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

accountingOfficeRouter.delete("/company-partners/:id", requireAuth, async (req: Request, res: Response) => {
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
  await prisma.companyPartner.delete({ where: { id: existing.id } });
  return res.json({ success: true, data: { deleted: true }, error: null });
});

accountingOfficeRouter.get("/company-partners/:id/payouts", requireAuth, async (req: Request, res: Response) => {
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

accountingOfficeRouter.post("/company-partners/:id/payouts", requireAuth, async (req: Request, res: Response) => {
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

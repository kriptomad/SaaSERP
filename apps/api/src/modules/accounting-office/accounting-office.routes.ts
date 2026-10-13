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
//   - Listagem de `OfficialTaxDocument` (sem geração real de ECD/ECF/SPED —
//     Capítulo 21.18.5, PENDENTE).
//   - CRUD de `AccountingFirmProfile` (perfil público do escritório no
//     marketplace — Capítulo 21.18.6, sem busca/listagem pública ainda).
// PENDENTE (flagado explicitamente, não escondido): cron de geração de
// tarefas (21.18.4), geração real de ECD/ECF/EFD-Reinf/DCTFWeb/DEFIS
// (21.18.5/21.18.10/21.18.11), marketplace de busca pública + reviews
// (21.18.6/21.18.9), espelhamento automático de honorário em AP/AR
// (21.18.8), módulo sócios/pró-labore/IRPF (21.18.12).
import { Router, Request, Response } from "express";
import { z } from "zod";
import { prismaUnscoped as prisma } from "@filitech/db";
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
// DOCUMENTOS OFICIAIS (Capítulo 21.18.5 — geração real de ECD/ECF PENDENTE;
// aqui apenas listagem de documentos já existentes)
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

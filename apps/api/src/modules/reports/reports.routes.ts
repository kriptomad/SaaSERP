// apps/api/src/modules/reports/reports.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 18 (Relatórios, Business
// Intelligence e Portabilidade de Dados — 18.1 Motor de Relatórios
// Self-Service, 18.2 Agendamento, 18.3 Dashboards Customizáveis).
// GAP DE AUDITORIA ENCONTRADO E CORRIGIDO: `ReportDefinition`,
// `ScheduledReport`, `DashboardLayout` existem no schema desde o início, e o
// Capítulo 18.1.1 já descrevia o tradutor seguro `executeReportDefinition()`
// em pseudocódigo, mas NENHUM arquivo real existia — zero rota REST.
// ESCOPO DESTA 1ª IMPLEMENTAÇÃO (honestamente delimitado):
//   - CRUD de `ReportDefinition` + execução real via `executeReportDefinition()`.
//   - CRUD de `ScheduledReport` (persistência do agendamento).
//   - GET/PUT de `DashboardLayout` por usuário.
// PENDENTE (flagado explicitamente): o disparo real do cron (`cronExpression`)
// via BullMQ que de fato executa e envia o `ScheduledReport` por e-mail
// (Capítulo 18.2 — nenhum worker ainda lê esta tabela), exportação para
// PDF/XLSX (`@react-pdf/renderer`/`exceljs` não estão instalados), e o
// suporte a dimensões com JOIN entre modelos no `DATASET_REGISTRY`
// (Capítulo 18.5 — importação assistida de dados — continua como gap
// totalmente separado, não coberto aqui).
import { Router, Request, Response } from "express";
import { z } from "zod";
import { prismaUnscoped as prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";
import { executeReportDefinition, InvalidReportFieldError } from "./execute-report-definition";
import { DATASET_REGISTRY } from "./dataset-registry";
import { buildAbcCurveReport, buildVariantAbcCurveReport } from "./abc-curve-report.service";
import { buildCollectionTurnoverReport } from "./collection-turnover-report.service";

export const reportsRouter = Router();

async function hasPermission(role: string, userId: string, permissionCode: string): Promise<boolean> {
  const [defaultGrant, override] = await Promise.all([
    prisma.roleDefaultPermission.findUnique({ where: { role_permissionCode: { role: role as any, permissionCode } } }),
    prisma.rolePermission.findUnique({ where: { userId_permission: { userId, permission: permissionCode } } }),
  ]);
  return override ? override.granted : Boolean(defaultGrant);
}

async function requireRead(req: Request, res: Response): Promise<boolean> {
  const { userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "reports:*:read"))) {
    res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite consultar relatórios." } });
    return false;
  }
  return true;
}

async function requireWrite(req: Request, res: Response): Promise<boolean> {
  const { userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "reports:*:write"))) {
    res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite criar/editar relatórios." } });
    return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────
// CURVA ABC (gap de mercado/conveniência fechado via pesquisa — ver
// abc-curve-report.service.ts): ranqueia produtos por participação acumulada
// no faturamento dos últimos N dias (classes A/B/C), para o lojista priorizar
// reposição/exposição dos itens que de fato sustentam o faturamento.
// ─────────────────────────────────────────────────────────────────────────

reportsRouter.get("/reports/abc-curve", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireRead(req, res))) return;
  const { tenantId } = req.session!;
  const daysParsed = Number(req.query.days);
  const days = Number.isFinite(daysParsed) && daysParsed > 0 && daysParsed <= 365 ? daysParsed : 30;
  const rows = await buildAbcCurveReport(prisma, tenantId, days);
  return res.json({ success: true, data: rows, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// CURVA ABC POR VARIANTE (Capítulo 11.4 — Loja de Roupas/Moda: classificação por
// combinação cor/tamanho, não pelo modelo agregado).
// ─────────────────────────────────────────────────────────────────────────

reportsRouter.get("/reports/abc-curve-variants", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireRead(req, res))) return;
  const { tenantId } = req.session!;
  const daysParsed = Number(req.query.days);
  const days = Number.isFinite(daysParsed) && daysParsed > 0 && daysParsed <= 365 ? daysParsed : 30;
  const rows = await buildVariantAbcCurveReport(prisma, tenantId, days);
  return res.json({ success: true, data: rows, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// GIRO POR COLEÇÃO/ESTAÇÃO + LIQUIDAÇÃO (Capítulo 11.4 — Loja de Roupas/Moda).
// ─────────────────────────────────────────────────────────────────────────

reportsRouter.get("/reports/collection-turnover", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireRead(req, res))) return;
  const { tenantId } = req.session!;
  const daysParsed = Number(req.query.days);
  const days = Number.isFinite(daysParsed) && daysParsed > 0 && daysParsed <= 365 ? daysParsed : 90;
  const report = await buildCollectionTurnoverReport(prisma, tenantId, days);
  return res.json({ success: true, data: report, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// DATASETS DISPONÍVEIS (para o front-end montar o construtor de relatório)
// ─────────────────────────────────────────────────────────────────────────

reportsRouter.get("/report-datasets", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireRead(req, res))) return;
  const datasets = Object.entries(DATASET_REGISTRY).map(([key, def]) => ({
    key,
    model: def.model,
    dimensions: Object.keys(def.allowedDimensions),
    metrics: Object.keys(def.allowedMetrics),
  }));
  return res.json({ success: true, data: datasets, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// REPORT DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────

reportsRouter.get("/report-definitions", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireRead(req, res))) return;
  const { tenantId } = req.session!;
  const definitions = await prisma.reportDefinition.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" } });
  return res.json({ success: true, data: definitions, error: null });
});

const createReportDefinitionSchema = z.object({
  name: z.string().min(1),
  datasetKey: z.string().min(1),
  dimensions: z.array(z.string()).default([]),
  metrics: z.array(z.string()).min(1),
  filters: z.record(z.any()).default({}),
  chartType: z.enum(["TABLE", "BAR", "LINE", "PIE"]),
  isPinnedToDashboard: z.boolean().default(false),
});

reportsRouter.post("/report-definitions", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireWrite(req, res))) return;
  const parsed = createReportDefinitionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  if (!DATASET_REGISTRY[parsed.data.datasetKey]) {
    return res.status(400).json({ success: false, data: null, error: { code: "INVALID_DATASET", message: `Dataset "${parsed.data.datasetKey}" não está registrado.` } });
  }
  const { tenantId, userId } = req.session!;
  const definition = await prisma.reportDefinition.create({
    data: { tenantId, createdByUserId: userId, ...parsed.data },
  });
  return res.status(201).json({ success: true, data: definition, error: null });
});

reportsRouter.get("/report-definitions/:id", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireRead(req, res))) return;
  const { tenantId } = req.session!;
  const definition = await prisma.reportDefinition.findFirst({ where: { id: req.params.id, tenantId } });
  if (!definition) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Definição de relatório não encontrada." } });
  }
  return res.json({ success: true, data: definition, error: null });
});

const patchReportDefinitionSchema = createReportDefinitionSchema.partial();

reportsRouter.patch("/report-definitions/:id", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireWrite(req, res))) return;
  const parsed = patchReportDefinitionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const { tenantId } = req.session!;
  const existing = await prisma.reportDefinition.findFirst({ where: { id: req.params.id, tenantId } });
  if (!existing) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Definição de relatório não encontrada." } });
  }
  const updated = await prisma.reportDefinition.update({ where: { id: existing.id }, data: parsed.data });
  return res.json({ success: true, data: updated, error: null });
});

reportsRouter.delete("/report-definitions/:id", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireWrite(req, res))) return;
  const { tenantId } = req.session!;
  const existing = await prisma.reportDefinition.findFirst({ where: { id: req.params.id, tenantId } });
  if (!existing) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Definição de relatório não encontrada." } });
  }
  await prisma.reportDefinition.delete({ where: { id: existing.id } });
  return res.json({ success: true, data: { id: existing.id }, error: null });
});

reportsRouter.get("/report-definitions/:id/execute", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireRead(req, res))) return;
  const { tenantId } = req.session!;
  const definition = await prisma.reportDefinition.findFirst({ where: { id: req.params.id, tenantId } });
  if (!definition) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Definição de relatório não encontrada." } });
  }
  try {
    const rows = await executeReportDefinition(prisma, tenantId, {
      datasetKey: definition.datasetKey,
      dimensions: definition.dimensions as string[],
      metrics: definition.metrics as string[],
    });
    return res.json({ success: true, data: rows, error: null });
  } catch (err) {
    if (err instanceof InvalidReportFieldError) {
      return res.status(400).json({ success: false, data: null, error: { code: "INVALID_REPORT_FIELD", message: err.message } });
    }
    throw err;
  }
});

// ─────────────────────────────────────────────────────────────────────────
// SCHEDULED REPORTS (persistência do agendamento — disparo real do cron
// PENDENTE, Capítulo 18.2)
// ─────────────────────────────────────────────────────────────────────────

reportsRouter.get("/scheduled-reports", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireRead(req, res))) return;
  const { tenantId } = req.session!;
  const schedules = await prisma.scheduledReport.findMany({ where: { tenantId } });
  return res.json({ success: true, data: schedules, error: null });
});

const createScheduledReportSchema = z.object({
  reportDefinitionId: z.string().uuid(),
  cronExpression: z.string().min(1),
  recipientEmails: z.array(z.string().email()).min(1),
  format: z.enum(["PDF", "XLSX"]),
  active: z.boolean().default(true),
});

reportsRouter.post("/scheduled-reports", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireWrite(req, res))) return;
  const parsed = createScheduledReportSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const { tenantId } = req.session!;
  const reportDefinition = await prisma.reportDefinition.findFirst({ where: { id: parsed.data.reportDefinitionId, tenantId } });
  if (!reportDefinition) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Definição de relatório não encontrada." } });
  }
  const schedule = await prisma.scheduledReport.create({ data: { tenantId, ...parsed.data } });
  return res.status(201).json({ success: true, data: schedule, error: null });
});

const patchScheduledReportSchema = z.object({
  cronExpression: z.string().min(1).optional(),
  recipientEmails: z.array(z.string().email()).min(1).optional(),
  format: z.enum(["PDF", "XLSX"]).optional(),
  active: z.boolean().optional(),
});

reportsRouter.patch("/scheduled-reports/:id", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireWrite(req, res))) return;
  const parsed = patchScheduledReportSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const { tenantId } = req.session!;
  const existing = await prisma.scheduledReport.findFirst({ where: { id: req.params.id, tenantId } });
  if (!existing) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Agendamento não encontrado." } });
  }
  const updated = await prisma.scheduledReport.update({ where: { id: existing.id }, data: parsed.data });
  return res.json({ success: true, data: updated, error: null });
});

reportsRouter.delete("/scheduled-reports/:id", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireWrite(req, res))) return;
  const { tenantId } = req.session!;
  const existing = await prisma.scheduledReport.findFirst({ where: { id: req.params.id, tenantId } });
  if (!existing) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Agendamento não encontrado." } });
  }
  await prisma.scheduledReport.delete({ where: { id: existing.id } });
  return res.json({ success: true, data: { id: existing.id }, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// DASHBOARD LAYOUT (um por usuário, Capítulo 18.3)
// ─────────────────────────────────────────────────────────────────────────

reportsRouter.get("/dashboard-layout", requireAuth, async (req: Request, res: Response) => {
  const { userId } = req.session!;
  const layout = await prisma.dashboardLayout.findUnique({ where: { userId } });
  return res.json({ success: true, data: layout, error: null });
});

const putDashboardLayoutSchema = z.object({
  widgets: z.array(
    z.object({
      reportDefinitionId: z.string().uuid(),
      x: z.number(),
      y: z.number(),
      w: z.number(),
      h: z.number(),
    }),
  ),
});

reportsRouter.put("/dashboard-layout", requireAuth, async (req: Request, res: Response) => {
  const parsed = putDashboardLayoutSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const { tenantId, userId } = req.session!;
  const layout = await prisma.dashboardLayout.upsert({
    where: { userId },
    create: { tenantId, userId, widgets: parsed.data.widgets },
    update: { widgets: parsed.data.widgets },
  });
  return res.json({ success: true, data: layout, error: null });
});

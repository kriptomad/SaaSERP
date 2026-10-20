// apps/api/src/modules/data-portability/data-import.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 18.5 — Importação Assistida de Dados: o
// wizard de 4 passos (Upload -> Mapeamento -> Validação -> Confirmação), nunca
// aplicando a importação sem confirmação visual prévia. Agora cobre PRODUCT, CLIENT
// e SUPPLIER (gap de auditoria original fechado: CLIENT/SUPPLIER tinham suporte de
// schema desde a primeira rodada, mas nenhuma validação/gravação real).
import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";
import { presignObjectUpload, presignObjectDownload, getObjectDirect } from "../../lib/object-storage";
import { dataImportValidationQueue, dataImportExecutionQueue } from "../../lib/queue";
import { parseSpreadsheetBuffer } from "../../lib/spreadsheet-parser";
import { suggestColumnMapping, ImportTargetEntity } from "./product-import-mapping";

export const dataImportRouter = Router();

const presignUploadSchema = z.object({
  fileName: z.string().min(1).max(200),
  mimeType: z.string().min(1).max(200),
  fileSizeBytes: z.number().int().positive(),
});

dataImportRouter.post("/data-import/presign-upload", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId } = req.session!;
  const parsed = presignUploadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: "Dados inválidos.", details: parsed.error.flatten() } });
  }

  try {
    const result = await presignObjectUpload({ tenantId, userId, category: "data-import-source", ...parsed.data });
    return res.status(201).json({ success: true, data: result, error: null });
  } catch (error) {
    return res.status(422).json({ success: false, data: null, error: { code: "PRESIGN_FAILED", message: (error as Error).message } });
  }
});

const createJobSchema = z.object({
  targetEntity: z.enum(["PRODUCT", "CLIENT", "SUPPLIER"]),
  sourceFileKey: z.string().min(1),
});

dataImportRouter.post("/data-import/jobs", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId } = req.session!;
  const parsed = createJobSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: "Dados inválidos.", details: parsed.error.flatten() } });
  }

  const job = await prisma.dataImportJob.create({
    data: {
      tenantId,
      targetEntity: parsed.data.targetEntity,
      sourceFileKey: parsed.data.sourceFileKey,
      status: "UPLOADED",
      columnMapping: {},
      createdByUserId: userId,
    },
  });
  return res.status(201).json({ success: true, data: job, error: null });
});

// CORREÇÃO DE AUDITORIA (fa-w5-perf-unbounded-data-import-jobs): antes, `findMany`
// sem `take`/`skip`/cursor devolvia TODOS os jobs de importação do tenant de uma vez
// — um tenant com anos de importações acumuladas paga o custo de uma varredura
// completa a cada carregamento da tela. Mesmo padrão de paginação por cursor (nunca
// OFFSET) já usado em `sales.routes.ts` GET /sales: cursor por `createdAt` via
// `?before=`, `limit` opcional (default 50, máximo 100), e a técnica de buscar
// `limit + 1` linhas para saber se há próxima página sem um `COUNT(*)` extra.
dataImportRouter.get("/data-import/jobs", requireAuth, async (req: Request, res: Response) => {
  const { tenantId } = req.session!;
  const limitParam = Number(req.query.limit);
  const limit = Number.isFinite(limitParam) && limitParam > 0 && limitParam <= 100 ? limitParam : 50;
  const before = typeof req.query.before === "string" ? new Date(req.query.before) : null;

  const jobs = await prisma.dataImportJob.findMany({
    where: {
      tenantId,
      ...(before && !Number.isNaN(before.getTime()) ? { createdAt: { lt: before } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
  });
  const hasMore = jobs.length > limit;
  const page = hasMore ? jobs.slice(0, limit) : jobs;
  const nextCursor = hasMore ? page[page.length - 1].createdAt.toISOString() : null;
  return res.json({ success: true, data: page, meta: { nextCursor, hasMore }, error: null });
});

dataImportRouter.get("/data-import/jobs/:id", requireAuth, async (req: Request, res: Response) => {
  const { tenantId } = req.session!;
  const job = await prisma.dataImportJob.findFirst({ where: { id: req.params.id, tenantId } });
  if (!job) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Job de importação não encontrado." } });
  }

  let errorReportDownloadUrl: string | null = null;
  if (job.errorReportKey) {
    const presign = await presignObjectDownload(tenantId, job.errorReportKey);
    errorReportDownloadUrl = presign.downloadUrl;
  }

  return res.json({ success: true, data: { ...job, errorReportDownloadUrl }, error: null });
});

/**
 * Passo 2 do wizard (Capítulo 18.5): preview das 5 primeiras linhas + dropdowns de
 * mapeamento pré-preenchidos por similaridade de nome de coluna, sempre editáveis.
 */
dataImportRouter.post("/data-import/jobs/:id/suggest-mapping", requireAuth, async (req: Request, res: Response) => {
  const { tenantId } = req.session!;
  const job = await prisma.dataImportJob.findFirst({ where: { id: req.params.id, tenantId } });
  if (!job) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Job de importação não encontrado." } });
  }

  try {
    const fileBuffer = await getObjectDirect(job.sourceFileKey);
    const fileName = job.sourceFileKey.split("/").pop() ?? "arquivo.csv";
    const rows = await parseSpreadsheetBuffer(fileBuffer, fileName);
    if (rows.length === 0) {
      return res.status(422).json({ success: false, data: null, error: { code: "EMPTY_FILE", message: "O arquivo enviado não contém nenhuma linha." } });
    }
    const [headers, ...dataRows] = rows;
    const previewRows = dataRows.slice(0, 5);
    const suggestedMapping = suggestColumnMapping(headers, job.targetEntity as ImportTargetEntity);

    return res.json({ success: true, data: { headers, previewRows, suggestedMapping }, error: null });
  } catch (error) {
    return res.status(422).json({ success: false, data: null, error: { code: "PARSE_FAILED", message: (error as Error).message } });
  }
});

const updateMappingSchema = z.object({ columnMapping: z.record(z.string()) });

dataImportRouter.patch("/data-import/jobs/:id", requireAuth, async (req: Request, res: Response) => {
  const { tenantId } = req.session!;
  const parsed = updateMappingSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: "Dados inválidos.", details: parsed.error.flatten() } });
  }

  const job = await prisma.dataImportJob.findFirst({ where: { id: req.params.id, tenantId } });
  if (!job) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Job de importação não encontrado." } });
  }

  const updated = await prisma.dataImportJob.update({
    where: { id: job.id },
    data: { columnMapping: parsed.data.columnMapping },
  });
  return res.json({ success: true, data: updated, error: null });
});

/**
 * Passo 3 do wizard: valida TODAS as linhas sem gravar nada no banco (job assíncrono
 * BullMQ, fila `data-import-validation`) — devolve o relatório de erros por linha.
 */
dataImportRouter.post("/data-import/jobs/:id/validate", requireAuth, async (req: Request, res: Response) => {
  const { tenantId } = req.session!;
  const job = await prisma.dataImportJob.findFirst({ where: { id: req.params.id, tenantId } });
  if (!job) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Job de importação não encontrado." } });
  }
  if (job.status === "VALIDATING" || job.status === "IMPORTING") {
    return res.status(409).json({ success: false, data: null, error: { code: "JOB_BUSY", message: `Job já está em andamento (status: ${job.status}).` } });
  }

  await dataImportValidationQueue.add(
    "validate-data-import",
    { jobId: job.id, tenantId },
    { attempts: 1, removeOnComplete: true, removeOnFail: true },
  );

  return res.status(202).json({ success: true, data: { jobId: job.id, status: "VALIDATING" }, error: null });
});

/**
 * Passo 4 do wizard: só dispara a gravação real quando o job já está
 * VALIDATED_CLEAN (Capítulo 18.5, texto integral) — nunca a partir de qualquer
 * outro estado, mesmo que o chamador tente pular etapas.
 */
dataImportRouter.post("/data-import/jobs/:id/confirm", requireAuth, async (req: Request, res: Response) => {
  const { tenantId } = req.session!;
  const job = await prisma.dataImportJob.findFirst({ where: { id: req.params.id, tenantId } });
  if (!job) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Job de importação não encontrado." } });
  }
  if (job.status !== "VALIDATED_CLEAN") {
    return res.status(409).json({ success: false, data: null, error: { code: "NOT_VALIDATED_CLEAN", message: `Importação só pode ser confirmada após validação sem erros (status atual: ${job.status}).` } });
  }

  await dataImportExecutionQueue.add(
    "execute-data-import",
    { jobId: job.id, tenantId },
    { attempts: 1, removeOnComplete: true, removeOnFail: true },
  );

  return res.status(202).json({ success: true, data: { jobId: job.id, status: "IMPORTING" }, error: null });
});

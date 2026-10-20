// apps/api/src/modules/data-portability/data-export.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 18.4 — "todo tenant tem acesso, a
// qualquer momento e sem necessidade de abrir chamado de suporte, a um botão
// 'Exportar todos os meus dados' em `/configuracoes/dados`". Disponível em TODOS os
// planos, inclusive o Tier Free — nenhuma checagem de módulo/plano é feita aqui,
// deliberadamente (texto integral do capítulo).
import { Router, Request, Response } from "express";
import { prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";
import { dataExportGenerationQueue } from "../../lib/queue";
import { presignObjectDownload } from "../../lib/object-storage";
import { writeTenantAuditLog } from "../../lib/tenant-audit-log";

export const dataExportRouter = Router();

dataExportRouter.post("/data-export", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId } = req.session!;

  const exportJob = await prisma.tenantDataExportJob.create({
    data: { tenantId, requestedByUserId: userId, status: "QUEUED" },
  });

  await dataExportGenerationQueue.add(
    "generate-data-export",
    { jobId: exportJob.id, tenantId, requestId: req.requestId },
    { attempts: 1, removeOnComplete: true, removeOnFail: true },
  );

  // fa-w4-lgpd-portability-no-audit-log
  await writeTenantAuditLog({
    tenantId,
    userId,
    action: "DATA_EXPORT_REQUESTED",
    targetType: "TenantDataExportJob",
    targetId: exportJob.id,
    outcome: "SUCCESS",
  });

  return res.status(201).json({ success: true, data: exportJob, error: null });
});

dataExportRouter.get("/data-export", requireAuth, async (req: Request, res: Response) => {
  const { tenantId } = req.session!;
  const jobs = await prisma.tenantDataExportJob.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" } });
  return res.json({ success: true, data: jobs, error: null });
});

dataExportRouter.get("/data-export/:id/download", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId } = req.session!;
  const job = await prisma.tenantDataExportJob.findFirst({ where: { id: req.params.id, tenantId } });
  if (!job) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Exportação não encontrada." } });
  }
  if (job.status !== "COMPLETED" || !job.resultStorageKey) {
    return res.status(409).json({ success: false, data: null, error: { code: "EXPORT_NOT_READY", message: `Exportação ainda não concluída (status atual: ${job.status}).` } });
  }

  const result = await presignObjectDownload(tenantId, job.resultStorageKey);

  // fa-w4-lgpd-portability-no-audit-log
  await writeTenantAuditLog({
    tenantId,
    userId,
    action: "DATA_EXPORT_DOWNLOADED",
    targetType: "TenantDataExportJob",
    targetId: job.id,
    outcome: "SUCCESS",
  });

  return res.json({ success: true, data: result, error: null });
});

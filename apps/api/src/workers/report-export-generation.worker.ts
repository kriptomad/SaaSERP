// apps/api/src/workers/report-export-generation.worker.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 18.2/18.3 — exportação PDF/XLSX sob
// demanda de um `ReportDefinition`. GAP DE AUDITORIA FECHADO
// (fa-perf-report-export-inline): `GET /report-definitions/:id/export` rodava a
// query/agregação completa + geração do PDF/XLSX síncrona dentro do processo HTTP,
// arriscando bloqueio do event loop/alto consumo de memória sob carga. Movido para
// fila BullMQ dedicada, mesmo padrão de infraestrutura de
// `workers/data-export-generation.worker.ts` / `modules/data-portability/data-export.routes.ts`:
// estado persistido no próprio registro de domínio (`ReportExportJob.status`:
// QUEUED -> GENERATING -> COMPLETED/FAILED), `prismaUnscoped` (worker roda fora de
// qualquer req.session) e nenhum rethrow após persistir FAILED.
import { Worker, Job } from "bullmq";
import { prismaUnscoped, TenantScopedPrismaClient } from "@filitech/db";
import { queueRedisConnection, QUEUE_NAMES } from "../lib/queue";
import { executeReportDefinition, InvalidReportFieldError, ReportFilterCondition } from "../modules/reports/execute-report-definition";
import { buildReportPdf, buildReportXlsx } from "../modules/reports/report-export.service";
import { putObjectDirect } from "../lib/object-storage";
import { notifyTenant } from "../modules/notifications/notify.service";
import { createModuleLogger } from "../lib/logger";

const log = createModuleLogger("report-export-generation.worker");

// fa-perf-report-export-inline exige limite de linhas/tamanho explícito — um
// ReportDefinition sem filtro de período (ex.: "todas as vendas desde o início")
// não pode gerar um PDF/XLSX ilimitado dentro do worker.
const MAX_EXPORT_ROWS = 50_000;

export interface ReportExportGenerationJobData {
  jobId: string;
  tenantId: string;
  reportDefinitionId: string;
  format: "PDF" | "XLSX";
}

export class ReportExportTooLargeError extends Error {}

export async function reportExportGenerationProcessor(job: Job<ReportExportGenerationJobData>): Promise<{ resultStorageKey: string }> {
  const { jobId, tenantId, reportDefinitionId, format } = job.data;

  await prismaUnscoped.reportExportJob.update({
    where: { id: jobId },
    data: { status: "GENERATING" },
  });

  try {
    const definition = await prismaUnscoped.reportDefinition.findFirstOrThrow({ where: { id: reportDefinitionId, tenantId } });

    // `executeReportDefinition` só usa `$queryRawUnsafe` com `tenantId` sempre
    // vinculado como parâmetro — mesmo contrato de `TenantScopedPrismaClient` e
    // `PrismaClient` puro nesse método, então o cast é seguro aqui (worker roda
    // fora de qualquer req.session, não há AsyncLocalStorage de tenant para usar
    // o client auto-escopado), mesmo padrão de `scheduled-report-generation.worker.ts`.
    const tenantScopedPrisma = prismaUnscoped as unknown as TenantScopedPrismaClient;
    const rows = await executeReportDefinition(tenantScopedPrisma, tenantId, {
      datasetKey: definition.datasetKey,
      dimensions: definition.dimensions as string[],
      metrics: definition.metrics as string[],
      filters: definition.filters as unknown as ReportFilterCondition[],
    });

    if (rows.length > MAX_EXPORT_ROWS) {
      throw new ReportExportTooLargeError(
        `Relatório possui ${rows.length} linhas, acima do limite de ${MAX_EXPORT_ROWS} por exportação — refine os filtros (ex.: período menor) antes de exportar.`,
      );
    }

    const buffer = format === "XLSX" ? await buildReportXlsx(definition.name, rows) : await buildReportPdf(definition.name, rows);
    const safeFileName = definition.name.replace(/[^a-zA-Z0-9-_]+/g, "_").slice(0, 60) || "relatorio";
    const extension = format === "XLSX" ? "xlsx" : "pdf";
    const mimeType = format === "XLSX" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf";

    const { storageKey } = await putObjectDirect({
      tenantId,
      category: "report-exports",
      fileName: `${safeFileName}.${extension}`,
      mimeType,
      body: buffer,
    });

    await prismaUnscoped.reportExportJob.update({
      where: { id: jobId },
      data: { status: "COMPLETED", resultStorageKey: storageKey, rowCount: rows.length, completedAt: new Date() },
    });

    await notifyTenant({
      tenantId,
      category: "SYSTEM_ANNOUNCEMENT",
      severity: "INFO",
      title: "Exportação de relatório concluída",
      body: `O relatório "${definition.name}" (${format}) está pronto para download.`,
      linkRoute: "/relatorios",
      sourceType: "REPORT_EXPORT_JOB",
      sourceId: jobId,
    });

    return { resultStorageKey: storageKey };
  } catch (error) {
    let failureReason = (error as Error).message;
    if (error instanceof InvalidReportFieldError) failureReason = error.message;
    else if (error instanceof ReportExportTooLargeError) failureReason = error.message;

    await prismaUnscoped.reportExportJob.update({
      where: { id: jobId },
      data: { status: "FAILED", failureReason },
    });

    await notifyTenant({
      tenantId,
      category: "SYSTEM_ANNOUNCEMENT",
      severity: "WARNING",
      title: "Falha na exportação de relatório",
      body: `Não foi possível gerar sua exportação: ${failureReason}.`,
      linkRoute: "/relatorios",
      sourceType: "REPORT_EXPORT_JOB",
      sourceId: jobId,
    });

    // Não relança o erro: o job é sob demanda (attempts:1, sem retry automático),
    // o estado FAILED já foi persistido acima, e o processo do worker nunca deve
    // cair por causa de uma falha de exportação de um único tenant — mesmo padrão
    // de `dataExportGenerationProcessor`.
    log.error({ jobId, tenantId, reportDefinitionId, err: error }, "geração de exportação de relatório falhou");
    return { resultStorageKey: "" };
  }
}

export function startReportExportGenerationWorker(): Worker {
  return new Worker<ReportExportGenerationJobData>(QUEUE_NAMES.REPORT_EXPORT_GENERATION, reportExportGenerationProcessor, {
    connection: queueRedisConnection,
    concurrency: 3,
  });
}

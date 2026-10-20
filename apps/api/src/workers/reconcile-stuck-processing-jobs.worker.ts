// apps/api/src/workers/reconcile-stuck-processing-jobs.worker.ts
// fa-w4-stale-intermediate-status-reaper — `DataImportJob`/`TenantDataExportJob`/
// `ReportExportJob` transicionam para um status intermediário (VALIDATING/IMPORTING/
// GENERATING) ANTES de fazer o trabalho de fato; se o processo do worker morrer no
// meio (deploy, OOM, restart do container), o registro de domínio fica travado
// nesse status PARA SEMPRE — ao contrário de `FiscalDocument` (que já tem
// `reconcile-stuck-fiscal-documents.worker.ts` como rede de segurança desde a
// rodada 7), nenhum destes três tinha reconciliação equivalente. Modelado 1:1 no
// mesmo padrão daquele worker (mesmo threshold conservador, mesmo teto de linhas
// por execução, mesmo "nunca derruba a varredura inteira por causa de um registro").
//
// Diferente do reaper de documento fiscal (que REENFILEIRA o job, pois emissão de
// NF-e é idempotente e pode simplesmente rodar de novo do zero), aqui a ação é
// marcar o registro como FAILED: um `DataImportJob`/`TenantDataExportJob`/
// `ReportExportJob` travado no meio do processamento não tem como "retomar
// sozinho" de forma segura a partir de uma varredura genérica — para IMPORTING em
// especial, o próprio checkpoint de `processedRows` (fa-w4-import-not-idempotent)
// já permite ao usuário clicar em "importar" de novo manualmente e retomar do
// ponto certo; a reconciliação automática aqui só evita que o registro fique
// "fantasma" (nunca mais muda de estado) para sempre, sem exigir ação humana
// baseada em nada (o usuário nem saberia que precisa tentar de novo).
import { Worker, Job } from "bullmq";
import { prismaUnscoped } from "@filitech/db";
import { queueRedisConnection, QUEUE_NAMES, reconcileStuckProcessingJobsQueue, DEFAULT_RECURRING_JOB_OPTS } from "../lib/queue";
import { createModuleLogger } from "../lib/logger";

const REPEATABLE_JOB_NAME = "reconcile-stuck-processing-jobs";
const EVERY_15_MINUTES_CRON = "*/15 * * * *";
// Margem de segurança: 45 min é bem mais que o tempo esperado de qualquer um dos
// três jobs (importação/exportação/relatório são limitados em linhas/tamanho nas
// próprias camadas que os geram) — evita marcar FAILED um job que só está lento,
// não travado.
const STUCK_THRESHOLD_MS = 45 * 60 * 1000;
const MAX_PER_SCAN = 200; // teto por execução — próxima varredura (15 min depois) pega o restante

const log = createModuleLogger("reconcile-stuck-processing-jobs");

/** Persiste um registro durável de falha terminal, reaproveitando a mesma tabela
 * de fa-w4-queue-no-dlq — este reaper não passa pelo listener `failed` do BullMQ
 * (não há job BullMQ nenhum atrelado a este FAILED, é uma transição de domínio
 * direta), então grava aqui explicitamente para a mesma superfície de consulta/
 * futura UI de admin valer também para este tipo de falha. */
async function recordStuckJobFailure(params: { tenantId: string; queueName: string; jobId: string; errorMessage: string }): Promise<void> {
  try {
    await prismaUnscoped.workerJobFailure.create({
      data: {
        tenantId: params.tenantId,
        queueName: params.queueName,
        jobId: params.jobId,
        jobName: "stale-intermediate-status-reconciliation",
        payload: { jobId: params.jobId },
        errorMessage: params.errorMessage,
        attemptsMade: 0,
      },
    });
  } catch (error) {
    log.error({ err: error, ...params }, "falha ao persistir WorkerJobFailure para job travado em status intermediário");
  }
}

export async function reconcileStuckProcessingJobsProcessor(_job: Job): Promise<{ reconciled: number }> {
  const threshold = new Date(Date.now() - STUCK_THRESHOLD_MS);
  let reconciled = 0;

  const stuckImportJobs = await prismaUnscoped.dataImportJob.findMany({
    where: { status: { in: ["VALIDATING", "IMPORTING"] }, processingStartedAt: { lte: threshold } },
    select: { id: true, tenantId: true, status: true },
    take: MAX_PER_SCAN,
  });
  for (const job of stuckImportJobs) {
    try {
      const errorMessage = `Job de importação travado em ${job.status} há mais de ${STUCK_THRESHOLD_MS / 60_000} minutos (processo provavelmente morreu no meio do processamento) — reconciliado automaticamente.`;
      await prismaUnscoped.dataImportJob.update({ where: { id: job.id }, data: { status: "FAILED" } });
      await recordStuckJobFailure({ tenantId: job.tenantId, queueName: QUEUE_NAMES.DATA_IMPORT_EXECUTION, jobId: job.id, errorMessage });
      log.warn({ jobId: job.id, tenantId: job.tenantId, previousStatus: job.status }, "DataImportJob travado reconciliado para FAILED");
      reconciled += 1;
    } catch (error) {
      log.error({ jobId: job.id, err: error }, "falha ao reconciliar DataImportJob travado — tentará de novo na próxima varredura");
    }
  }

  const stuckExportJobs = await prismaUnscoped.tenantDataExportJob.findMany({
    where: { status: "GENERATING", processingStartedAt: { lte: threshold } },
    select: { id: true, tenantId: true },
    take: MAX_PER_SCAN,
  });
  for (const job of stuckExportJobs) {
    try {
      const errorMessage = `Job de exportação de dados travado em GENERATING há mais de ${STUCK_THRESHOLD_MS / 60_000} minutos (processo provavelmente morreu no meio do processamento) — reconciliado automaticamente.`;
      await prismaUnscoped.tenantDataExportJob.update({ where: { id: job.id }, data: { status: "FAILED", failureReason: errorMessage } });
      await recordStuckJobFailure({ tenantId: job.tenantId, queueName: QUEUE_NAMES.DATA_EXPORT_GENERATION, jobId: job.id, errorMessage });
      log.warn({ jobId: job.id, tenantId: job.tenantId }, "TenantDataExportJob travado reconciliado para FAILED");
      reconciled += 1;
    } catch (error) {
      log.error({ jobId: job.id, err: error }, "falha ao reconciliar TenantDataExportJob travado — tentará de novo na próxima varredura");
    }
  }

  const stuckReportExportJobs = await prismaUnscoped.reportExportJob.findMany({
    where: { status: "GENERATING", processingStartedAt: { lte: threshold } },
    select: { id: true, tenantId: true },
    take: MAX_PER_SCAN,
  });
  for (const job of stuckReportExportJobs) {
    try {
      const errorMessage = `Job de exportação de relatório travado em GENERATING há mais de ${STUCK_THRESHOLD_MS / 60_000} minutos (processo provavelmente morreu no meio do processamento) — reconciliado automaticamente.`;
      await prismaUnscoped.reportExportJob.update({ where: { id: job.id }, data: { status: "FAILED", failureReason: errorMessage } });
      await recordStuckJobFailure({ tenantId: job.tenantId, queueName: QUEUE_NAMES.REPORT_EXPORT_GENERATION, jobId: job.id, errorMessage });
      log.warn({ jobId: job.id, tenantId: job.tenantId }, "ReportExportJob travado reconciliado para FAILED");
      reconciled += 1;
    } catch (error) {
      log.error({ jobId: job.id, err: error }, "falha ao reconciliar ReportExportJob travado — tentará de novo na próxima varredura");
    }
  }

  if (reconciled > 0) {
    log.warn({ reconciled }, "jobs travados em status intermediário foram reconciliados para FAILED");
  }

  return { reconciled };
}

export function startReconcileStuckProcessingJobsWorker(): Worker {
  return new Worker(QUEUE_NAMES.RECONCILE_STUCK_PROCESSING_JOBS, reconcileStuckProcessingJobsProcessor, {
    connection: queueRedisConnection,
  });
}

export async function scheduleReconcileStuckProcessingJobsJob(): Promise<void> {
  await reconcileStuckProcessingJobsQueue.upsertJobScheduler(
    REPEATABLE_JOB_NAME,
    { pattern: EVERY_15_MINUTES_CRON },
    { name: REPEATABLE_JOB_NAME, opts: DEFAULT_RECURRING_JOB_OPTS },
  );
}

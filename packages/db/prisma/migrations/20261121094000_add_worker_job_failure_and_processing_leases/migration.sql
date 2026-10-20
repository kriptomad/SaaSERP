-- fa-w4-queue-no-dlq: tabela durável de falhas TERMINAIS de job BullMQ (todas as
-- `attempts` esgotadas), gravada pelo listener único em `worker.ts`.
CREATE TABLE "worker_job_failures" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "queueName" TEXT NOT NULL,
    "jobId" TEXT,
    "jobName" TEXT,
    "payload" JSONB NOT NULL,
    "errorMessage" TEXT NOT NULL,
    "attemptsMade" INTEGER NOT NULL DEFAULT 0,
    "failedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "worker_job_failures_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "worker_job_failures_queueName_failedAt_idx" ON "worker_job_failures" ("queueName", "failedAt");
CREATE INDEX "worker_job_failures_tenantId_resolved_idx" ON "worker_job_failures" ("tenantId", "resolved");

-- fa-w4-stale-intermediate-status-reaper: carimbo de início de processamento usado
-- por `workers/reconcile-stuck-processing-jobs.worker.ts` para detectar jobs travados
-- em status intermediário (VALIDATING/IMPORTING/GENERATING) por tempo excessivo.
ALTER TABLE "data_import_jobs" ADD COLUMN "processingStartedAt" TIMESTAMP(3);
ALTER TABLE "tenant_data_export_jobs" ADD COLUMN "processingStartedAt" TIMESTAMP(3);
ALTER TABLE "report_export_jobs" ADD COLUMN "processingStartedAt" TIMESTAMP(3);

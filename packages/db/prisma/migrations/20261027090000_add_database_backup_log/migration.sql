-- CreateTable
-- Capítulo 10.3 — Backup Criptografado sem Downtime: histórico platform-wide (não
-- tenant-scoped, um único dump cobre todos os tenants) dos backups automáticos
-- (cron diário 03:00) e manuais (disparados pelo painel admin).
CREATE TABLE "database_backup_logs" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "storageKey" TEXT,
    "fileSizeBytes" BIGINT,
    "errorMessage" TEXT,
    "triggeredBy" TEXT NOT NULL,
    "encryptionKeyId" TEXT,

    CONSTRAINT "database_backup_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "database_backup_logs_status_startedAt_idx" ON "database_backup_logs"("status", "startedAt");

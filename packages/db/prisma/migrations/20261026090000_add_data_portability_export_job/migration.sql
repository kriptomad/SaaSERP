-- CreateEnum
-- Capítulo 18.4 — Portabilidade Total de Dados: status do job assíncrono BullMQ que
-- gera o ZIP de exportação completa (CSVs de todas as tabelas tenant-scoped +
-- documentos fiscais/fotos do R2 + schema-reference.json).
CREATE TYPE "DataExportStatus" AS ENUM ('QUEUED', 'GENERATING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "tenant_data_export_jobs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "status" "DataExportStatus" NOT NULL DEFAULT 'QUEUED',
    "resultStorageKey" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "tenant_data_export_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tenant_data_export_jobs_tenantId_status_idx" ON "tenant_data_export_jobs"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "tenant_data_export_jobs" ADD CONSTRAINT "tenant_data_export_jobs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_data_export_jobs" ADD CONSTRAINT "tenant_data_export_jobs_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

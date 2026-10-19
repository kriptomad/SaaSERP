-- fa-perf-support-tickets-no-pagination — índice composto cobrindo o padrão real de
-- acesso da listagem paginada (filtro por tenantId + status opcional, ordenado por
-- createdAt desc), sem precisar de sort em memória.
CREATE INDEX "support_tickets_tenantId_status_createdAt_idx" ON "support_tickets"("tenantId", "status", "createdAt");

-- fa-perf-accounting-doc-generation-inline — geração passa a ser assíncrona
-- (BullMQ): `layoutVersion`/`fileUrl` só são resolvidos pelo worker após o job
-- terminar, então nascem nulos (status PENDING/PROCESSING) em vez de obrigatórios.
ALTER TABLE "official_tax_documents" ALTER COLUMN "layoutVersion" DROP NOT NULL;
ALTER TABLE "official_tax_documents" ALTER COLUMN "fileUrl" DROP NOT NULL;
ALTER TABLE "official_tax_documents" ADD COLUMN "failureReason" TEXT;
ALTER TABLE "official_tax_documents" ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- fa-perf-accounting-docs-no-pagination — listagem paginada ordena por
-- `generatedAt desc` filtrando por tenantId (+ documentType opcional); o índice
-- existente ([tenantId, documentType, competenciaInicio]) não cobre esse padrão de
-- acesso real, forçando sort em memória.
CREATE INDEX "official_tax_documents_tenantId_generatedAt_idx" ON "official_tax_documents"("tenantId", "generatedAt");
CREATE INDEX "official_tax_documents_tenantId_documentType_generatedAt_idx" ON "official_tax_documents"("tenantId", "documentType", "generatedAt");

-- fa-perf-report-export-inline — rastreamento do job assíncrono de exportação
-- PDF/XLSX sob demanda de um ReportDefinition, mesmo padrão de
-- `tenant_data_export_jobs` (status QUEUED -> GENERATING -> COMPLETED/FAILED,
-- arquivo final no R2 via `resultStorageKey`).
CREATE TYPE "ReportExportStatus" AS ENUM ('QUEUED', 'GENERATING', 'COMPLETED', 'FAILED');

CREATE TABLE "report_export_jobs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reportDefinitionId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "status" "ReportExportStatus" NOT NULL DEFAULT 'QUEUED',
    "rowCount" INTEGER,
    "resultStorageKey" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "report_export_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "report_export_jobs_tenantId_status_idx" ON "report_export_jobs"("tenantId", "status");

ALTER TABLE "report_export_jobs" ADD CONSTRAINT "report_export_jobs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "report_export_jobs" ADD CONSTRAINT "report_export_jobs_reportDefinitionId_fkey" FOREIGN KEY ("reportDefinitionId") REFERENCES "report_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "report_export_jobs" ADD CONSTRAINT "report_export_jobs_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

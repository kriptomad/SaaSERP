-- fa-w4-lgpd-export-incomplete-graph / fa-w4-lgpd-no-retention-purge
-- Marca o momento em que o artefato ZIP de exportação de dados foi apagado do R2
-- pelo worker de expurgo de retenção (prazo conservador de 30 dias desde
-- `completedAt`); `resultStorageKey` é zerado no mesmo instante.
ALTER TABLE "tenant_data_export_jobs" ADD COLUMN "purgedAt" TIMESTAMP(3);

-- CreateEnum
-- fa-w4-pharmacy-prescription-no-audit / fa-w4-lgpd-portability-no-audit-log —
-- resultado de cada ação tenant-facing auditada (leitura/escrita de dado pessoal
-- sensível e ciclo de portabilidade/eliminação de dados).
CREATE TYPE "TenantAuditOutcome" AS ENUM ('SUCCESS', 'DENIED', 'FAILED');

-- CreateTable
CREATE TABLE "tenant_audit_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "outcome" "TenantAuditOutcome" NOT NULL DEFAULT 'SUCCESS',
    "metadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tenant_audit_logs_tenantId_createdAt_idx" ON "tenant_audit_logs"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "tenant_audit_logs_tenantId_targetType_targetId_idx" ON "tenant_audit_logs"("tenantId", "targetType", "targetId");

-- AddForeignKey
ALTER TABLE "tenant_audit_logs" ADD CONSTRAINT "tenant_audit_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_audit_logs" ADD CONSTRAINT "tenant_audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateEnum
-- fa-w4-lgpd-no-deletion-workflow — Direito à Eliminação (LGPD Art. 18, VI). Ver
-- comentário de design completo em schema.prisma, model `DataDeletionRequest`:
-- deliberadamente processado via ANONIMIZAÇÃO, nunca hard-delete.
CREATE TYPE "DataDeletionRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'PROCESSING', 'COMPLETED', 'REJECTED');

-- CreateTable
CREATE TABLE "data_deletion_requests" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "status" "DataDeletionRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "data_deletion_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "data_deletion_requests_tenantId_status_idx" ON "data_deletion_requests"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "data_deletion_requests" ADD CONSTRAINT "data_deletion_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_deletion_requests" ADD CONSTRAINT "data_deletion_requests_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_deletion_requests" ADD CONSTRAINT "data_deletion_requests_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

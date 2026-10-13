-- Capítulo 4.2 — comissionamento do técnico sobre mão de obra (TechnicianCommissionRule).
-- NOTA: esta migration foi escrita manualmente (ambiente sandbox sem acesso a um
-- Postgres local/shadow database para rodar `prisma migrate dev` de verdade — ver
-- documentação no resumo final). O SQL segue exatamente o padrão gerado pelo Prisma
-- Migrate para os demais modelos deste schema (ver 0_init/migration.sql).

-- CreateTable
CREATE TABLE "technician_commission_rules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "technicianId" TEXT,
    "commissionPercent" DECIMAL(5,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "technician_commission_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "technician_commission_rules_technicianId_key" ON "technician_commission_rules"("technicianId");

-- CreateIndex
CREATE INDEX "technician_commission_rules_tenantId_idx" ON "technician_commission_rules"("tenantId");

-- AddForeignKey
ALTER TABLE "technician_commission_rules" ADD CONSTRAINT "technician_commission_rules_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "technician_commission_rules" ADD CONSTRAINT "technician_commission_rules_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Rodada 6 — Capítulo 11.2 (Ótica) e 11.3 (Petshop/Veterinária)
-- Escrita manualmente (banco Postgres inacessível neste sandbox — mesma limitação de
-- todas as rodadas anteriores, `Test-NetConnection -Port 5432` falha). Pronta para
-- `prisma migrate deploy`/`dev` assim que houver uma instância Postgres acessível;
-- NÃO aplicada neste ambiente.

-- ── Novos enums ─────────────────────────────────────────────────────────────
CREATE TYPE "OpticsCategory" AS ENUM ('FRAME', 'LENS');
CREATE TYPE "LensDeliveryType" AS ENUM ('STOCK', 'CUSTOM');
CREATE TYPE "WorkOrderType" AS ENUM ('GENERAL_REPAIR', 'OPTICAL_LAB');

-- SalePaymentMethod e NotificationCategory já existem — apenas novos valores.
ALTER TYPE "SalePaymentMethod" ADD VALUE IF NOT EXISTS 'HEALTH_INSURANCE';
ALTER TYPE "NotificationCategory" ADD VALUE IF NOT EXISTS 'VACCINE_REMINDER';

-- ── Tenant: garantia contratual adicional configurável (Capítulo 11.2) ──────
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "opticalAdditionalWarrantyDays" INTEGER NOT NULL DEFAULT 0;

-- ── HealthInsurancePlan (novo model, Capítulo 11.2 — convênios) ─────────────
CREATE TABLE "health_insurance_plans" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "billingDueDay" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "health_insurance_plans_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "health_insurance_plans_tenantId_name_key" ON "health_insurance_plans"("tenantId", "name");
ALTER TABLE "health_insurance_plans" ADD CONSTRAINT "health_insurance_plans_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Client: vínculo opcional a convênio ──────────────────────────────────────
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "healthInsurancePlanId" TEXT;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "healthInsurancePlanMemberId" TEXT;
ALTER TABLE "clients" ADD CONSTRAINT "clients_healthInsurancePlanId_fkey"
    FOREIGN KEY ("healthInsurancePlanId") REFERENCES "health_insurance_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Supplier: metadado informativo de consignação ───────────────────────────
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "isConsignmentSupplier" BOOLEAN NOT NULL DEFAULT false;

-- ── Product: consignação + classificação óptica ─────────────────────────────
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "isConsignment" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "opticsCategory" "OpticsCategory";
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "lensDeliveryType" "LensDeliveryType" DEFAULT 'STOCK';

-- ── WorkOrder: distingue reparo geral de laboratório óptico ─────────────────
ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "workOrderType" "WorkOrderType" NOT NULL DEFAULT 'GENERAL_REPAIR';
ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "estimatedReadyAt" TIMESTAMP(3);
ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "opticalPrescriptionId" TEXT;
ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "saleId" TEXT;
CREATE INDEX "work_orders_tenantId_workOrderType_status_idx" ON "work_orders"("tenantId", "workOrderType", "status");

-- ── OpticalPrescription: Decreto 24.492/1934 (livro de registro de receitas) ─
ALTER TABLE "optical_prescriptions" ADD COLUMN IF NOT EXISTS "prescriptionNumber" INTEGER;
ALTER TABLE "optical_prescriptions" ADD COLUMN IF NOT EXISTS "doctorRegistrationNumber" TEXT;
ALTER TABLE "optical_prescriptions" ADD COLUMN IF NOT EXISTS "clientAddressSnapshot" TEXT;
-- Backfill necessário antes de tornar NOT NULL/UNIQUE em produção: numerar
-- sequencialmente por tenantId as receitas já existentes (se houver) antes de
-- aplicar a constraint abaixo. Em banco novo (sem dados), pode ser aplicada direto.
-- ALTER TABLE "optical_prescriptions" ALTER COLUMN "prescriptionNumber" SET NOT NULL;
-- CREATE UNIQUE INDEX "optical_prescriptions_tenantId_prescriptionNumber_key" ON "optical_prescriptions"("tenantId", "prescriptionNumber");

ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_opticalPrescriptionId_fkey"
    FOREIGN KEY ("opticalPrescriptionId") REFERENCES "optical_prescriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Sale: convênio (venda individual) + marcação de fatura consolidada ──────
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "healthInsurancePlanId" TEXT;
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "healthInsuranceReceivableId" TEXT;
ALTER TABLE "sales" ADD CONSTRAINT "sales_healthInsurancePlanId_fkey"
    FOREIGN KEY ("healthInsurancePlanId") REFERENCES "health_insurance_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_saleId_fkey"
    FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── SaleItem: garantia legal (CDC) + contratual congelada no fechamento ─────
ALTER TABLE "sale_items" ADD COLUMN IF NOT EXISTS "warrantyExpiresAt" TIMESTAMP(3);

-- ── AccountReceivable: suporta fatura consolidada sem cliente único ─────────
ALTER TABLE "accounts_receivable" ALTER COLUMN "clientId" DROP NOT NULL;
ALTER TABLE "accounts_receivable" ADD COLUMN IF NOT EXISTS "healthInsurancePlanId" TEXT;
ALTER TABLE "accounts_receivable" ADD CONSTRAINT "accounts_receivable_healthInsurancePlanId_fkey"
    FOREIGN KEY ("healthInsurancePlanId") REFERENCES "health_insurance_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales" ADD CONSTRAINT "sales_healthInsuranceReceivableId_fkey"
    FOREIGN KEY ("healthInsuranceReceivableId") REFERENCES "accounts_receivable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── VaccineRecord: idempotência do lembrete automático ──────────────────────
ALTER TABLE "vaccine_records" ADD COLUMN IF NOT EXISTS "reminderSentAt" TIMESTAMP(3);

-- NOTA: `Product.saleUnit`/`purchaseUnit`/`unitConversionFactor` (estoque fracionado,
-- gap #4 de 11.3 — ração a granel) já existiam no schema antes desta rodada
-- (mecanismo compartilhado com o Capítulo 11.8 — Material de Construção, adicionado
-- por rodada/agente paralelo) — nenhuma coluna nova necessária aqui.

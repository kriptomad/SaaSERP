-- ============================================================================
-- FILITECH ERP — Catch-up de migrations pendentes (versão 100% idempotente:
-- pode ser rodado quantas vezes for preciso, mesmo que uma tentativa anterior
-- já tenha aplicado parte do conteúdo).
-- Cole e execute este arquivo INTEIRO de uma vez no SQL Editor do Neon.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Migration: 20261014103000_add_niche_11_1_11_6_ifood_salon_booking
-- ---------------------------------------------------------------------------
-- Capítulo 11.1 (Lanchonete/Restaurante com Delivery e iFood) e 11.6 (Salão de
-- Beleza/Barbearia) — Rodada 6 de auditoria:
--   1. `sales.channel` (enum SaleChannel: COUNTER/DINE_IN/DELIVERY_IFOOD/ONLINE_STORE)
--      — distingue canal físico de marketplace para margem líquida por canal.
--   2. `comanda_items.professionalId`/`recipeConsumedAt` — profissional que executou
--      o serviço (apuração de comissão) e momento da baixa de insumos da Ficha
--      Técnica, que agora ocorre no LANÇAMENTO do item (nunca no fechamento).
--   3. `service_commission_entries` — comissão por profissional/serviço, criada
--      apenas no fechamento+pagamento da Comanda (nunca no agendamento).
--   4. `professional_working_hours` — expediente semanal por profissional, base da
--      Agenda Online pública (self-booking sem autenticação).
--   5. `accounts_payable.saleId` — vincula a despesa de comissão de marketplace
--      (iFood) à venda de origem.
--   6. `SalePaymentMethod.MARKETPLACE` e `IntegrationProvider.MARKETPLACE_IFOOD` —
--      novos valores de enum para o fluxo de webhook/venda automática do iFood.
--   7. `sales.healthInsurancePlanId` — correção incidental de um bug de schema
--      PRÉ-EXISTENTE (Capítulo 11.2 — Ótica, de uma rodada anterior) que impedia
--      `prisma generate` de rodar; sem esta coluna, NENHUMA alteração de schema
--      desta rodada (nem das anteriores) podia ser validada. Fora do escopo 11.1/11.6,
--      mas corrigido aqui por ser bloqueante. Apenas a COLUNA é adicionada aqui —
--      a FK para `health_insurance_plans` só é criada na migration seguinte
--      (20261015090000), pois essa tabela ainda não existe neste ponto da timeline
--      (bug de ordenação corrigido na auditoria de 20261020090000_fix_missing_fields_audit).
--
-- NOTA: esta migration foi escrita manualmente (ambiente sandbox sem acesso a um
-- Postgres local/shadow database para rodar `prisma migrate dev` de verdade — mesma
-- limitação documentada em todas as migrations anteriores, ex.
-- 20261013155500_add_niche_11_4_11_7_collection_exchanges_store_credit/migration.sql).
-- Aditiva: novas colunas (nullable/com default), novas tabelas e novos valores de
-- enum; nenhuma coluna/tabela existente é alterada ou removida.

-- CreateEnum
DO $$ BEGIN
CREATE TYPE "SaleChannel" AS ENUM ('COUNTER', 'DINE_IN', 'DELIVERY_IFOOD', 'ONLINE_STORE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "channel" "SaleChannel" NOT NULL DEFAULT 'COUNTER';

-- AlterTable (correção incidental pré-existente, Capítulo 11.2 — ver nota acima;
-- a FK é criada só na migration seguinte, 20261015090000, quando a tabela
-- "health_insurance_plans" passa a existir)
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "healthInsurancePlanId" TEXT;

-- AlterEnum
ALTER TYPE "SalePaymentMethod" ADD VALUE IF NOT EXISTS 'MARKETPLACE';

-- AlterEnum
ALTER TYPE "IntegrationProvider" ADD VALUE IF NOT EXISTS 'MARKETPLACE_IFOOD';

-- AlterTable
ALTER TABLE "comanda_items" ADD COLUMN IF NOT EXISTS "professionalId" TEXT;
ALTER TABLE "comanda_items" ADD COLUMN IF NOT EXISTS "recipeConsumedAt" TIMESTAMP(3);
DO $$ BEGIN
ALTER TABLE "comanda_items" ADD CONSTRAINT "comanda_items_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable
ALTER TABLE "accounts_payable" ADD COLUMN IF NOT EXISTS "saleId" TEXT;
DO $$ BEGIN
ALTER TABLE "accounts_payable" ADD CONSTRAINT "accounts_payable_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "accounts_payable_tenantId_saleId_idx" ON "accounts_payable"("tenantId", "saleId");

-- CreateTable
CREATE TABLE IF NOT EXISTS "professional_working_hours" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,

    CONSTRAINT "professional_working_hours_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "professional_working_hours_tenantId_professionalId_dayOfW_key" ON "professional_working_hours"("tenantId", "professionalId", "dayOfWeek");

-- AddForeignKey
DO $$ BEGIN
ALTER TABLE "professional_working_hours" ADD CONSTRAINT "professional_working_hours_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
ALTER TABLE "professional_working_hours" ADD CONSTRAINT "professional_working_hours_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "service_commission_entries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "comandaItemId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "baseAmount" DECIMAL(12,2) NOT NULL,
    "commissionPercentage" DECIMAL(5,2) NOT NULL,
    "commissionAmount" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_commission_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "service_commission_entries_comandaItemId_key" ON "service_commission_entries"("comandaItemId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "service_commission_entries_tenantId_professionalId_created_idx" ON "service_commission_entries"("tenantId", "professionalId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "service_commission_entries_tenantId_saleId_idx" ON "service_commission_entries"("tenantId", "saleId");

-- AddForeignKey
DO $$ BEGIN
ALTER TABLE "service_commission_entries" ADD CONSTRAINT "service_commission_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
ALTER TABLE "service_commission_entries" ADD CONSTRAINT "service_commission_entries_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
ALTER TABLE "service_commission_entries" ADD CONSTRAINT "service_commission_entries_comandaItemId_fkey" FOREIGN KEY ("comandaItemId") REFERENCES "comanda_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
ALTER TABLE "service_commission_entries" ADD CONSTRAINT "service_commission_entries_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
ALTER TABLE "service_commission_entries" ADD CONSTRAINT "service_commission_entries_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


-- ---------------------------------------------------------------------------
-- Migration: 20261015090000_add_niche_11_2_11_3_optics_petshop
-- ---------------------------------------------------------------------------
-- Rodada 6 — Capítulo 11.2 (Ótica) e 11.3 (Petshop/Veterinária)
-- Escrita manualmente (banco Postgres inacessível neste sandbox — mesma limitação de
-- todas as rodadas anteriores, `Test-NetConnection -Port 5432` falha). Pronta para
-- `prisma migrate deploy`/`dev` assim que houver uma instância Postgres acessível;
-- NÃO aplicada neste ambiente.

-- ── Novos enums ─────────────────────────────────────────────────────────────
DO $$ BEGIN
CREATE TYPE "OpticsCategory" AS ENUM ('FRAME', 'LENS');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
CREATE TYPE "LensDeliveryType" AS ENUM ('STOCK', 'CUSTOM');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
CREATE TYPE "WorkOrderType" AS ENUM ('GENERAL_REPAIR', 'OPTICAL_LAB');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- SalePaymentMethod e NotificationCategory já existem — apenas novos valores.
ALTER TYPE "SalePaymentMethod" ADD VALUE IF NOT EXISTS 'HEALTH_INSURANCE';
ALTER TYPE "NotificationCategory" ADD VALUE IF NOT EXISTS 'VACCINE_REMINDER';

-- ── Tenant: garantia contratual adicional configurável (Capítulo 11.2) ──────
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "opticalAdditionalWarrantyDays" INTEGER NOT NULL DEFAULT 0;

-- ── HealthInsurancePlan (novo model, Capítulo 11.2 — convênios) ─────────────
CREATE TABLE IF NOT EXISTS "health_insurance_plans" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "billingDueDay" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "health_insurance_plans_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "health_insurance_plans_tenantId_name_key" ON "health_insurance_plans"("tenantId", "name");
DO $$ BEGIN
ALTER TABLE "health_insurance_plans" ADD CONSTRAINT "health_insurance_plans_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ── Client: vínculo opcional a convênio ──────────────────────────────────────
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "healthInsurancePlanId" TEXT;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "healthInsurancePlanMemberId" TEXT;
DO $$ BEGIN
ALTER TABLE "clients" ADD CONSTRAINT "clients_healthInsurancePlanId_fkey"
    FOREIGN KEY ("healthInsurancePlanId") REFERENCES "health_insurance_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

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
CREATE INDEX IF NOT EXISTS "work_orders_tenantId_workOrderType_status_idx" ON "work_orders"("tenantId", "workOrderType", "status");

-- ── OpticalPrescription: Decreto 24.492/1934 (livro de registro de receitas) ─
ALTER TABLE "optical_prescriptions" ADD COLUMN IF NOT EXISTS "prescriptionNumber" INTEGER;
ALTER TABLE "optical_prescriptions" ADD COLUMN IF NOT EXISTS "doctorRegistrationNumber" TEXT;
ALTER TABLE "optical_prescriptions" ADD COLUMN IF NOT EXISTS "clientAddressSnapshot" TEXT;
-- Backfill necessário antes de tornar NOT NULL/UNIQUE em produção: numerar
-- sequencialmente por tenantId as receitas já existentes (se houver) antes de
-- aplicar a constraint abaixo. Em banco novo (sem dados), pode ser aplicada direto.
-- ALTER TABLE "optical_prescriptions" ALTER COLUMN "prescriptionNumber" SET NOT NULL;
-- CREATE UNIQUE INDEX "optical_prescriptions_tenantId_prescriptionNumber_key" ON "optical_prescriptions"("tenantId", "prescriptionNumber");

DO $$ BEGIN
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_opticalPrescriptionId_fkey"
    FOREIGN KEY ("opticalPrescriptionId") REFERENCES "optical_prescriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ── Sale: convênio (venda individual) + marcação de fatura consolidada ──────
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "healthInsurancePlanId" TEXT;
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "healthInsuranceReceivableId" TEXT;
DO $$ BEGIN
ALTER TABLE "sales" ADD CONSTRAINT "sales_healthInsurancePlanId_fkey"
    FOREIGN KEY ("healthInsurancePlanId") REFERENCES "health_insurance_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_saleId_fkey"
    FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ── SaleItem: garantia legal (CDC) + contratual congelada no fechamento ─────
ALTER TABLE "sale_items" ADD COLUMN IF NOT EXISTS "warrantyExpiresAt" TIMESTAMP(3);

-- ── AccountReceivable: suporta fatura consolidada sem cliente único ─────────
ALTER TABLE "accounts_receivable" ALTER COLUMN "clientId" DROP NOT NULL;
ALTER TABLE "accounts_receivable" ADD COLUMN IF NOT EXISTS "healthInsurancePlanId" TEXT;
DO $$ BEGIN
ALTER TABLE "accounts_receivable" ADD CONSTRAINT "accounts_receivable_healthInsurancePlanId_fkey"
    FOREIGN KEY ("healthInsurancePlanId") REFERENCES "health_insurance_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
ALTER TABLE "sales" ADD CONSTRAINT "sales_healthInsuranceReceivableId_fkey"
    FOREIGN KEY ("healthInsuranceReceivableId") REFERENCES "accounts_receivable"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ── VaccineRecord: idempotência do lembrete automático ──────────────────────
ALTER TABLE "vaccine_records" ADD COLUMN IF NOT EXISTS "reminderSentAt" TIMESTAMP(3);

-- NOTA: `Product.saleUnit`/`purchaseUnit`/`unitConversionFactor` (estoque fracionado,
-- gap #4 de 11.3 — ração a granel) já existiam no schema antes desta rodada
-- (mecanismo compartilhado com o Capítulo 11.8 — Material de Construção, adicionado
-- por rodada/agente paralelo) — nenhuma coluna nova necessária aqui.


-- ---------------------------------------------------------------------------
-- Migration: 20261016090000_add_fiscal_document_focus_nfe_emission_fields
-- ---------------------------------------------------------------------------
-- Capítulo 20.3/21.7 — fecha o gap de auditoria em que a fila BullMQ
-- `fiscal-emission` tinha produtor (close-sale.service.ts/enqueueFiscalEmission)
-- mas nenhum worker consumidor: todo FiscalDocument ficava travado em PENDING para
-- sempre e nenhuma NFC-e era de fato transmitida à SEFAZ via Focus NFe.
-- Campos devolvidos pela Focus NFe na emissão real (doc.focusnfe.com.br/reference/
-- emitir_nfce), necessários para idempotência (focusNfeReference/focusNfeStatusSefaz)
-- e para a impressão térmica do cupom NFC-e (qrCodeUrl, danfeStorageKey — Capítulo 21.7).
-- NOTA: esta migration foi escrita manualmente (ambiente sandbox sem acesso a um
-- Postgres local/shadow database para rodar `prisma migrate dev` de verdade — mesma
-- limitação documentada em 20261013152700_add_technician_commission_rule/migration.sql).
-- Aditiva: todas as colunas são NULLable, não quebra nenhuma linha existente.

-- AlterTable
ALTER TABLE "fiscal_documents" ADD COLUMN IF NOT EXISTS "focusNfeReference" TEXT;
ALTER TABLE "fiscal_documents" ADD COLUMN IF NOT EXISTS "focusNfeNumero" TEXT;
ALTER TABLE "fiscal_documents" ADD COLUMN IF NOT EXISTS "focusNfeSerie" TEXT;
ALTER TABLE "fiscal_documents" ADD COLUMN IF NOT EXISTS "focusNfeStatusSefaz" TEXT;
ALTER TABLE "fiscal_documents" ADD COLUMN IF NOT EXISTS "focusNfeMensagemSefaz" TEXT;
ALTER TABLE "fiscal_documents" ADD COLUMN IF NOT EXISTS "qrCodeUrl" TEXT;
ALTER TABLE "fiscal_documents" ADD COLUMN IF NOT EXISTS "danfeStorageKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "fiscal_documents_focusNfeReference_key" ON "fiscal_documents"("focusNfeReference");


-- ---------------------------------------------------------------------------
-- Migration: 20261017094500_add_user_whatsapp_phone
-- ---------------------------------------------------------------------------
-- Capítulo 20.2 — fecha o gap de auditoria em que o fan-out multicanal de
-- notificações (WhatsApp/e-mail/push) nunca disparava de verdade: não existia
-- nenhum campo de telefone em User, então o canal WhatsApp da
-- NotificationPreference não tinha para onde enviar mesmo quando marcado
-- "true". Opcional (NULLable) — preenchido pelo próprio usuário via
-- PATCH /users/me/contact; aditiva, não quebra nenhuma linha existente.
-- NOTA: esta migration foi escrita manualmente (ambiente sandbox sem acesso a
-- um Postgres local/shadow database para rodar `prisma migrate dev` de
-- verdade — mesma limitação documentada em outras migrations recentes, ex.:
-- 20261016090000_add_fiscal_document_focus_nfe_emission_fields/migration.sql).

-- AlterTable
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "whatsappPhone" TEXT;


-- ---------------------------------------------------------------------------
-- Migration: 20261018090000_add_personal_account_open_finance_external_id
-- ---------------------------------------------------------------------------
-- Capítulo 22.5 — fecha o gap de auditoria do worker real de sincronização Pluggy:
-- `PersonalAccount` só tinha `openFinanceConsentId`, com idempotência (incorretamente)
-- chaveada em `institutionName`, o que mescla duas contas reais distintas da mesma
-- instituição (ex.: conta corrente + cartão de crédito do mesmo banco) em uma única
-- linha. Adiciona o id lógico real da conta no agregador (mesmo papel de
-- `BankAccount.openFinanceExternalAccountId` no lado BUSINESS) e substitui a
-- constraint de unicidade antiga por uma chaveada no identificador real do agregador.
-- NOTA: escrita manualmente (ambiente sandbox sem acesso a um Postgres local/shadow
-- database para rodar `prisma migrate dev` de verdade — mesma limitação documentada
-- em outras migrations recentes, ex.: 20261017094500_add_user_whatsapp_phone).

-- DropIndex
DROP INDEX IF EXISTS "personal_accounts_openFinanceConsentId_institutionName_key";

-- AlterTable
ALTER TABLE "personal_accounts" ADD COLUMN IF NOT EXISTS "openFinanceExternalAccountId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "personal_accounts_openFinanceConsentId_openFinanceExternal_key" ON "personal_accounts"("openFinanceConsentId", "openFinanceExternalAccountId");


-- ---------------------------------------------------------------------------
-- Migration: 20261020090000_fix_missing_fields_audit
-- ---------------------------------------------------------------------------
-- Rodada de auditoria de drift schema.prisma vs. migrations — corrige campos/tabelas
-- que existiam no schema.prisma mas nunca tiveram migration.sql gerado (mesmo bug
-- de classe já visto em 20261019100000_add_platform_secret).

-- ── Client: conta empresarial (fatura consolidada / limites maiores, Cap. 4.6) ──
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "isBusinessAccount" BOOLEAN NOT NULL DEFAULT false;

-- ── Product: kit escolar montado como composição via Recipe/RecipeItem (Cap. 11.5) ──
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "isKitComposition" BOOLEAN NOT NULL DEFAULT false;

-- ── ProductBatch: garantia do fabricante em meses (distinta da validade ANVISA) ──
ALTER TABLE "product_batches" ADD COLUMN IF NOT EXISTS "manufacturerWarrantyMonths" INTEGER;

-- ── WorkOrderItem: personalização (bordado/sublimação) vinculada à venda, Cap. 11.5 ──
ALTER TABLE "work_order_items" ADD COLUMN IF NOT EXISTS "saleItemId" TEXT;
ALTER TABLE "work_order_items" ADD COLUMN IF NOT EXISTS "productionDueAt" TIMESTAMP(3);
ALTER TABLE "work_order_items" ADD COLUMN IF NOT EXISTS "artApprovedAt" TIMESTAMP(3);
DO $$ BEGIN
  ALTER TABLE "work_order_items" ADD CONSTRAINT "work_order_items_saleItemId_key" UNIQUE ("saleItemId");
EXCEPTION
  WHEN duplicate_table THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "work_order_items" ADD CONSTRAINT "work_order_items_saleItemId_fkey"
    FOREIGN KEY ("saleItemId") REFERENCES "sale_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ── SeasonalityWindow (novo model — janelas sazonais por categoria, Cap. 11.5) ──
CREATE TABLE IF NOT EXISTS "seasonality_windows" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "startMonth" INTEGER NOT NULL,
    "startDay" INTEGER NOT NULL,
    "endMonth" INTEGER NOT NULL,
    "endDay" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "seasonality_windows_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "seasonality_windows_tenantId_category_idx" ON "seasonality_windows"("tenantId", "category");
DO $$ BEGIN
  ALTER TABLE "seasonality_windows" ADD CONSTRAINT "seasonality_windows_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ── VehicleConsignmentPayout (novo model — repasse ao consignante, Cap. 11.12) ──
DO $$ BEGIN
  CREATE TYPE "VehicleConsignmentPayoutStatus" AS ENUM ('PENDING', 'PAID');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
CREATE TABLE IF NOT EXISTS "vehicle_consignment_payouts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vehicleListingId" TEXT NOT NULL,
    "consignorClientId" TEXT NOT NULL,
    "payoutAmount" DECIMAL(12,2) NOT NULL,
    "status" "VehicleConsignmentPayoutStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "vehicle_consignment_payouts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "vehicle_consignment_payouts_vehicleListingId_key" ON "vehicle_consignment_payouts"("vehicleListingId");
CREATE INDEX IF NOT EXISTS "vehicle_consignment_payouts_tenantId_status_idx" ON "vehicle_consignment_payouts"("tenantId", "status");
DO $$ BEGIN
  ALTER TABLE "vehicle_consignment_payouts" ADD CONSTRAINT "vehicle_consignment_payouts_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "vehicle_consignment_payouts" ADD CONSTRAINT "vehicle_consignment_payouts_vehicleListingId_fkey"
    FOREIGN KEY ("vehicleListingId") REFERENCES "vehicle_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "vehicle_consignment_payouts" ADD CONSTRAINT "vehicle_consignment_payouts_consignorClientId_fkey"
    FOREIGN KEY ("consignorClientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Bookkeeping do Prisma (_prisma_migrations)
-- ---------------------------------------------------------------------------
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, started_at, applied_steps_count) SELECT '7032eb39-93f0-4a15-9d55-414379e7e6e3', 'd807e1044a93dd5699bb3a4d5d634ac1b3fafd59492fc9bf5c0be049e9c4ae1b', now(), '0_init', now(), 1 WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name = '0_init');
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, started_at, applied_steps_count) SELECT '29ba508b-5e5d-47b3-a331-5af432e22d17', '4a47b8a75abefb4fa6ca1cb96257c4ddae51143b00784968c0fdcabd210d65d7', now(), '20261013152635_add_licensing', now(), 1 WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name = '20261013152635_add_licensing');
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, started_at, applied_steps_count) SELECT 'b06cdb43-0196-4242-a671-c4c3172c8621', 'f35d33200c3d2b5f22d0a74fe401d597dec393503b33c20ddd254facdffb67c2', now(), '20261013152700_add_technician_commission_rule', now(), 1 WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name = '20261013152700_add_technician_commission_rule');
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, started_at, applied_steps_count) SELECT 'c081e034-9c4b-4250-85ac-41423cb738fd', 'ceff603041167c3e1f62b1ccfa9c727553e2ca304c0dd781444894f4bef1afbc', now(), '20261013153000_add_client_is_reseller', now(), 1 WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name = '20261013153000_add_client_is_reseller');
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, started_at, applied_steps_count) SELECT '6d52e35a-615a-4a30-a332-e180e8b11776', '666696732c917f80ed7120867a63f44b632267b0669e6134f1550a6d95974dd5', now(), '20261013153500_add_client_credit_payment', now(), 1 WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name = '20261013153500_add_client_credit_payment');
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, started_at, applied_steps_count) SELECT '590445d9-89f8-4780-8535-d219400e0bd6', '6b067306ce73ba97685f4c784265bf7f55f902362186ecdc38b42b93fb28d928', now(), '20261013155500_add_niche_11_4_11_7_collection_exchanges_store_credit', now(), 1 WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name = '20261013155500_add_niche_11_4_11_7_collection_exchanges_store_credit');
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, started_at, applied_steps_count) SELECT 'fa8ee45d-6076-420e-8094-991798dd1675', 'c9df5cdbdd60765d721f7fd10659e8ccdfaaa9da6db5060c40b2f5439e34aea3', now(), '20261014103000_add_niche_11_1_11_6_ifood_salon_booking', now(), 1 WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name = '20261014103000_add_niche_11_1_11_6_ifood_salon_booking');
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, started_at, applied_steps_count) SELECT '92f1a9e4-f4da-4f93-a359-a66a97244a55', 'ca8c9fb62a9aee2fd96115e60d93cb04f78464f82642b68df7095815370bae00', now(), '20261015090000_add_niche_11_2_11_3_optics_petshop', now(), 1 WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name = '20261015090000_add_niche_11_2_11_3_optics_petshop');
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, started_at, applied_steps_count) SELECT '04a3cc06-67e8-42e9-a4ce-6f4bf844a6ad', '43066d999d8e5da37a443fa3c341fca82411a33ad2a3edc8046f132f362a25bc', now(), '20261016090000_add_fiscal_document_focus_nfe_emission_fields', now(), 1 WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name = '20261016090000_add_fiscal_document_focus_nfe_emission_fields');
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, started_at, applied_steps_count) SELECT '0c709e66-7a5c-4acc-b92b-10633c63eee7', '8149cc74ff49780812b594cff626d19140e71977fab21ea105995b225a0a8c57', now(), '20261017094500_add_user_whatsapp_phone', now(), 1 WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name = '20261017094500_add_user_whatsapp_phone');
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, started_at, applied_steps_count) SELECT '763c0573-11d5-42f4-81d0-adbbf4a4cb9e', '37e84fd7fb6176f264c3d565ccca3b9788f6d8064afa123bd9a43295bb14b43c', now(), '20261018090000_add_personal_account_open_finance_external_id', now(), 1 WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name = '20261018090000_add_personal_account_open_finance_external_id');
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, started_at, applied_steps_count) SELECT '6c182640-07d2-44aa-8827-43c3fcd245c5', 'cd63701e1e28a0b68b306cda75ce9d0d67e42126b2ada0e891849cd861e041b4', now(), '20261020090000_fix_missing_fields_audit', now(), 1 WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name = '20261020090000_fix_missing_fields_audit');
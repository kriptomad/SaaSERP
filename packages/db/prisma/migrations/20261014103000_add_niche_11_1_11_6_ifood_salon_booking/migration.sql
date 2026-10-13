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
--      mas corrigido aqui por ser bloqueante.
--
-- NOTA: esta migration foi escrita manualmente (ambiente sandbox sem acesso a um
-- Postgres local/shadow database para rodar `prisma migrate dev` de verdade — mesma
-- limitação documentada em todas as migrations anteriores, ex.
-- 20261013155500_add_niche_11_4_11_7_collection_exchanges_store_credit/migration.sql).
-- Aditiva: novas colunas (nullable/com default), novas tabelas e novos valores de
-- enum; nenhuma coluna/tabela existente é alterada ou removida.

-- CreateEnum
CREATE TYPE "SaleChannel" AS ENUM ('COUNTER', 'DINE_IN', 'DELIVERY_IFOOD', 'ONLINE_STORE');

-- AlterTable
ALTER TABLE "sales" ADD COLUMN "channel" "SaleChannel" NOT NULL DEFAULT 'COUNTER';

-- AlterTable (correção incidental pré-existente, Capítulo 11.2 — ver nota acima)
ALTER TABLE "sales" ADD COLUMN "healthInsurancePlanId" TEXT;
ALTER TABLE "sales" ADD CONSTRAINT "sales_healthInsurancePlanId_fkey" FOREIGN KEY ("healthInsurancePlanId") REFERENCES "health_insurance_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterEnum
ALTER TYPE "SalePaymentMethod" ADD VALUE IF NOT EXISTS 'MARKETPLACE';

-- AlterEnum
ALTER TYPE "IntegrationProvider" ADD VALUE IF NOT EXISTS 'MARKETPLACE_IFOOD';

-- AlterTable
ALTER TABLE "comanda_items" ADD COLUMN "professionalId" TEXT;
ALTER TABLE "comanda_items" ADD COLUMN "recipeConsumedAt" TIMESTAMP(3);
ALTER TABLE "comanda_items" ADD CONSTRAINT "comanda_items_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "accounts_payable" ADD COLUMN "saleId" TEXT;
ALTER TABLE "accounts_payable" ADD CONSTRAINT "accounts_payable_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "accounts_payable_tenantId_saleId_idx" ON "accounts_payable"("tenantId", "saleId");

-- CreateTable
CREATE TABLE "professional_working_hours" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,

    CONSTRAINT "professional_working_hours_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "professional_working_hours_tenantId_professionalId_dayOfW_key" ON "professional_working_hours"("tenantId", "professionalId", "dayOfWeek");

-- AddForeignKey
ALTER TABLE "professional_working_hours" ADD CONSTRAINT "professional_working_hours_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "professional_working_hours" ADD CONSTRAINT "professional_working_hours_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "service_commission_entries" (
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
CREATE UNIQUE INDEX "service_commission_entries_comandaItemId_key" ON "service_commission_entries"("comandaItemId");

-- CreateIndex
CREATE INDEX "service_commission_entries_tenantId_professionalId_created_idx" ON "service_commission_entries"("tenantId", "professionalId", "createdAt");

-- CreateIndex
CREATE INDEX "service_commission_entries_tenantId_saleId_idx" ON "service_commission_entries"("tenantId", "saleId");

-- AddForeignKey
ALTER TABLE "service_commission_entries" ADD CONSTRAINT "service_commission_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_commission_entries" ADD CONSTRAINT "service_commission_entries_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_commission_entries" ADD CONSTRAINT "service_commission_entries_comandaItemId_fkey" FOREIGN KEY ("comandaItemId") REFERENCES "comanda_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_commission_entries" ADD CONSTRAINT "service_commission_entries_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_commission_entries" ADD CONSTRAINT "service_commission_entries_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

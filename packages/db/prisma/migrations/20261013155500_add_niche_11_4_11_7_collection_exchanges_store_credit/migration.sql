-- Capítulo 11.4 (Loja de Roupas/Moda) e 11.7 (Loja de Calçados):
--   1. `products.collectionTag` — tag de coleção/estação (ex. "Verão 2026").
--   2. `clients.storeCreditBalance` — saldo de crédito de loja a favor do cliente.
--   3. `store_credit_transactions` — ledger imutável (ISSUED/REDEEMED) do crédito de loja.
--   4. `product_exchanges` — registro de trocas com reentrada de estoque por variante.
-- NOTA: esta migration foi escrita manualmente (ambiente sandbox sem acesso a um
-- Postgres local/shadow database para rodar `prisma migrate dev` de verdade — mesma
-- limitação documentada em 20261013152700_add_technician_commission_rule/migration.sql
-- e 20261013153500_add_client_credit_payment/migration.sql). Aditiva: novas
-- colunas (nullable/com default) e novas tabelas, nenhuma coluna existente é alterada.

-- AlterTable
ALTER TABLE "products" ADD COLUMN "collectionTag" TEXT;

-- CreateIndex
CREATE INDEX "products_tenantId_collectionTag_idx" ON "products"("tenantId", "collectionTag");

-- AlterTable
ALTER TABLE "clients" ADD COLUMN "storeCreditBalance" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateEnum
CREATE TYPE "StoreCreditDirection" AS ENUM ('ISSUED', 'REDEEMED');

-- CreateTable
CREATE TABLE "store_credit_transactions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "direction" "StoreCreditDirection" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "exchangeId" TEXT,
    "redeemedInSaleId" TEXT,
    "note" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_credit_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "store_credit_transactions_tenantId_clientId_createdAt_idx" ON "store_credit_transactions"("tenantId", "clientId", "createdAt");

-- AddForeignKey
ALTER TABLE "store_credit_transactions" ADD CONSTRAINT "store_credit_transactions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_credit_transactions" ADD CONSTRAINT "store_credit_transactions_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "ExchangeResolutionType" AS ENUM ('NEW_ITEM', 'STORE_CREDIT');

-- CreateTable
CREATE TABLE "product_exchanges" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "originalSaleItemId" TEXT NOT NULL,
    "returnedVariantId" TEXT,
    "returnedQuantity" DECIMAL(12,3) NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "resolutionType" "ExchangeResolutionType" NOT NULL,
    "newVariantId" TEXT,
    "newQuantity" DECIMAL(12,3),
    "refundValue" DECIMAL(12,2) NOT NULL,
    "priceDifference" DECIMAL(12,2),
    "storeCreditIssued" DECIMAL(12,2),
    "resultingSaleId" TEXT,
    "processedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_exchanges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_exchanges_tenantId_createdAt_idx" ON "product_exchanges"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "product_exchanges_tenantId_originalSaleItemId_idx" ON "product_exchanges"("tenantId", "originalSaleItemId");

-- AddForeignKey
ALTER TABLE "product_exchanges" ADD CONSTRAINT "product_exchanges_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

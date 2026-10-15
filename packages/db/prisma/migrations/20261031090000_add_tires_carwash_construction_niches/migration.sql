-- GAP DE AUDITORIA FECHADO (Mega-Audit Rodada 3):
-- Capítulo 11.10 (Loja de Pneus) — `WorkOrderType.TIRE_SHOP` para O.S. real de
--   montagem/balanceamento/alinhamento (ver tire-service-orders.routes.ts),
--   reaproveitando `WorkOrderItem`/`OsChecklist`/`OsPhoto`/`ProductSerial`
--   (DOT por pneu) já existentes — mesmo padrão de router companheiro do
--   `OPTICAL_LAB`, nunca edita o arquivo restrito work-orders.routes.ts.
-- Capítulo 11.11 (Estética Automotiva/Lava-Rápido) — `WorkOrderType.CAR_WASH` +
--   `Appointment.workOrderId` para checklist de entrada/saída e fotos
--   antes/depois reais (hoje só havia fila sem checklist).
-- Capítulo 11.8 (Material de Construção/Ferragens) — `ConstructionQuote`
--   (orçamento de obra) e `MaterialDelivery` (entrega agendada de material
--   pesado/volumoso); unidades de medida fracionadas (`Product.saleUnit`/
--   `purchaseUnit`/`unitConversionFactor`) já existiam de rodada anterior.

-- AlterEnum
ALTER TYPE "WorkOrderType" ADD VALUE 'TIRE_SHOP';
ALTER TYPE "WorkOrderType" ADD VALUE 'CAR_WASH';

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN "workOrderId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "appointments_workOrderId_key" ON "appointments"("workOrderId");

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "ConstructionQuoteStatus" AS ENUM ('DRAFT', 'SENT', 'APPROVED', 'REJECTED', 'CONVERTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "MaterialDeliveryStatus" AS ENUM ('PENDING', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED');

-- CreateTable
CREATE TABLE "construction_quotes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "ConstructionQuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "validUntil" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "construction_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "construction_quote_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "productId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "construction_quote_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_deliveries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "saleId" TEXT,
    "address" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" "MaterialDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "driverName" TEXT,
    "vehiclePlate" TEXT,
    "referenceNote" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "receivedByName" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "construction_quotes_tenantId_clientId_idx" ON "construction_quotes"("tenantId", "clientId");
CREATE INDEX "construction_quotes_tenantId_status_idx" ON "construction_quotes"("tenantId", "status");
CREATE INDEX "construction_quote_items_tenantId_quoteId_idx" ON "construction_quote_items"("tenantId", "quoteId");
CREATE INDEX "material_deliveries_tenantId_clientId_idx" ON "material_deliveries"("tenantId", "clientId");
CREATE INDEX "material_deliveries_tenantId_status_scheduledAt_idx" ON "material_deliveries"("tenantId", "status", "scheduledAt");

-- AddForeignKey
ALTER TABLE "construction_quotes" ADD CONSTRAINT "construction_quotes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "construction_quotes" ADD CONSTRAINT "construction_quotes_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "construction_quote_items" ADD CONSTRAINT "construction_quote_items_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "construction_quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "construction_quote_items" ADD CONSTRAINT "construction_quote_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "material_deliveries" ADD CONSTRAINT "material_deliveries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "material_deliveries" ADD CONSTRAINT "material_deliveries_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "material_deliveries" ADD CONSTRAINT "material_deliveries_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

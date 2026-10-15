-- GAP DE AUDITORIA FECHADO (Mega-Audit Rodada 2, item 8.5 — Vitrine Virtual): o
-- schema já tinha `OnlineStoreSettings` por tenant, mas nenhum produto tinha como
-- optar por aparecer na loja pública e não existia nenhum registro de pedido
-- feito pela vitrine (ver comentário detalhado em schema.prisma, modelo
-- `OnlineOrder`, sobre por que o pedido NUNCA cria uma `Sale` direto).

-- AlterTable
ALTER TABLE "products" ADD COLUMN "showInOnlineStore" BOOLEAN NOT NULL DEFAULT false;

-- CreateEnum
CREATE TYPE "OnlineOrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED');

-- CreateTable
CREATE TABLE "online_orders" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "customerEmail" TEXT,
    "isDelivery" BOOLEAN NOT NULL DEFAULT false,
    "deliveryAddress" TEXT,
    "status" "OnlineOrderStatus" NOT NULL DEFAULT 'PENDING',
    "itemsTotalAmount" DECIMAL(12,2) NOT NULL,
    "deliveryFee" DECIMAL(10,2),
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "customerNotes" TEXT,
    "cancelReason" TEXT,
    "linkedSaleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "online_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "online_order_items" (
    "id" TEXT NOT NULL,
    "onlineOrderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "online_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "online_orders_tenantId_status_idx" ON "online_orders"("tenantId", "status");

-- CreateIndex
CREATE INDEX "online_orders_tenantId_createdAt_idx" ON "online_orders"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "online_order_items_onlineOrderId_idx" ON "online_order_items"("onlineOrderId");

-- AddForeignKey
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "online_order_items" ADD CONSTRAINT "online_order_items_onlineOrderId_fkey" FOREIGN KEY ("onlineOrderId") REFERENCES "online_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "online_order_items" ADD CONSTRAINT "online_order_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

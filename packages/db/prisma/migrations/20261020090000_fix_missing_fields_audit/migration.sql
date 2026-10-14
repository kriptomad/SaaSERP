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

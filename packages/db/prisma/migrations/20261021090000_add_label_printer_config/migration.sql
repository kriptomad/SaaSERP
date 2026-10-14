-- CreateTable
CREATE TABLE "label_printer_configs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "connectionType" TEXT NOT NULL,
    "networkHost" TEXT,
    "networkPort" INTEGER DEFAULT 9100,
    "labelWidthMm" INTEGER NOT NULL DEFAULT 40,
    "labelHeightMm" INTEGER NOT NULL DEFAULT 25,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "label_printer_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "label_printer_configs_tenantId_idx" ON "label_printer_configs"("tenantId");

-- AddForeignKey
ALTER TABLE "label_printer_configs" ADD CONSTRAINT "label_printer_configs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

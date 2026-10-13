-- Capítulo 2.10 — Licença Mestra (TenantLicense/LicenseActivation).
-- NOTA: esta migration foi escrita manualmente (ambiente sandbox sem acesso a um
-- Postgres local/shadow database para rodar `prisma migrate dev` de verdade — ver
-- documentação no resumo final). O SQL segue exatamente o padrão gerado pelo Prisma
-- Migrate para os demais modelos deste schema (ver 0_init/migration.sql).

-- CreateEnum
CREATE TYPE "TenantLicenseStatus" AS ENUM ('TRIAL', 'ACTIVE', 'EXPIRED', 'SUSPENDED');

-- CreateTable
CREATE TABLE "tenant_licenses" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "status" "TenantLicenseStatus" NOT NULL DEFAULT 'TRIAL',
    "trialEndsAt" TIMESTAMP(3),
    "licensedModules" TEXT[],
    "lastValidatedAt" TIMESTAMP(3),
    "offlineTokenIssuedAt" TIMESTAMP(3),
    "offlineTokenExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_licenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "license_activations" (
    "id" TEXT NOT NULL,
    "tenantLicenseId" TEXT NOT NULL,
    "deviceFingerprint" TEXT NOT NULL,
    "deviceLabel" TEXT,
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "license_activations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_licenses_tenantId_key" ON "tenant_licenses"("tenantId");

-- CreateIndex
CREATE INDEX "license_activations_tenantLicenseId_idx" ON "license_activations"("tenantLicenseId");

-- CreateIndex
CREATE UNIQUE INDEX "license_activations_tenantLicenseId_deviceFingerprint_key" ON "license_activations"("tenantLicenseId", "deviceFingerprint");

-- AddForeignKey
ALTER TABLE "tenant_licenses" ADD CONSTRAINT "tenant_licenses_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "license_activations" ADD CONSTRAINT "license_activations_tenantLicenseId_fkey" FOREIGN KEY ("tenantLicenseId") REFERENCES "tenant_licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Capítulo 4.6 — Varejo Geral (Crediário/Fiado): histórico de baixas do saldo
-- utilizado de crediário do cliente (`Client.creditBalanceUsed`).
-- NOTA: esta migration foi escrita manualmente (ambiente sandbox sem acesso a um
-- Postgres local/shadow database para rodar `prisma migrate dev` de verdade — mesma
-- limitação documentada em 20261013152700_add_technician_commission_rule/migration.sql).
-- Aditiva: nova tabela, não altera nenhuma coluna existente.

-- CreateTable
CREATE TABLE "client_credit_payments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "registeredByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_credit_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_credit_payments_tenantId_clientId_createdAt_idx" ON "client_credit_payments"("tenantId", "clientId", "createdAt");

-- AddForeignKey
ALTER TABLE "client_credit_payments" ADD CONSTRAINT "client_credit_payments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_credit_payments" ADD CONSTRAINT "client_credit_payments_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

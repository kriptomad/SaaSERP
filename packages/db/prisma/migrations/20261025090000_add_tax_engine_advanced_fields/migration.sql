-- AlterTable
-- Capítulo 21.10 — DIFAL: UF de destino do cliente e flag de contribuinte de ICMS,
-- necessários para decidir se a venda interestadual é a consumidor final (DIFAL) ou
-- a outro contribuinte (CFOP interestadual comum, sem partilha).
ALTER TABLE "clients" ADD COLUMN "uf" TEXT;
ALTER TABLE "clients" ADD COLUMN "icmsContributor" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
-- Capítulo 21.9/21.10/21.12 — agregados de `calculateFullTax` persistidos no
-- documento fiscal da venda, no mesmo padrão dos demais agregados já existentes
-- (legacyIcmsAmount, totalTaxesApprox etc.).
ALTER TABLE "fiscal_documents" ADD COLUMN "difalAmount" DECIMAL(12,2);
ALTER TABLE "fiscal_documents" ADD COLUMN "monofasicoSegregatedRevenue" DECIMAL(12,2);
ALTER TABLE "fiscal_documents" ADD COLUMN "usedVehicleIcmsAmount" DECIMAL(12,2);

-- Mega-audit (continuação): ISS municipal nunca era calculado nem emitido em
-- lugar nenhum do sistema, apesar de TaxRule.issAliquota/issRetidoNaFonte/nbs já
-- existirem no schema. Fecha o gap: Tenant ganha Inscrição Municipal (exigida pela
-- Focus NFe para emitir NFS-e), FiscalDocument ganha os campos agregados de ISS e
-- o enum FiscalDocumentType ganha o valor NFSE.

ALTER TABLE "tenants" ADD COLUMN "inscricaoMunicipal" TEXT;

ALTER TYPE "FiscalDocumentType" ADD VALUE IF NOT EXISTS 'NFSE';

ALTER TABLE "fiscal_documents" ADD COLUMN "issAmount" DECIMAL(12, 2);
ALTER TABLE "fiscal_documents" ADD COLUMN "issRetidoNaFonte" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "fiscal_documents" ADD COLUMN "focusNfeCodigoVerificacao" TEXT;

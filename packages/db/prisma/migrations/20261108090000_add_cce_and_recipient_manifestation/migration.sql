-- Mega-audit (continuação): `FiscalDocumentEventType.CORRECTION_LETTER` (CC-e) e
-- `RECIPIENT_MANIFESTATION` + o enum `RecipientManifestationType` já existiam no
-- schema (Capítulo 21.19), mas nenhum código jamais os instanciava — gap total
-- confirmado por auditoria (zero ocorrências em todo `apps/api/src`). Fecha o gap:
--   1) Carta de Correção Eletrônica: `issue-correction-letter.service.ts`, aplicável
--      apenas a NF-e modelo 55 (NFE_SAIDA) — CC-e é legalmente vedada para NFC-e
--      (rejeição SEFAZ 784) e não existe no padrão NFS-e municipal.
--   2) Manifestação do Destinatário: `FiscalDocument` ganha os campos que
--      materializam uma nota de COMPRA recebida via Distribuição DFe (tenant como
--      destinatário, nunca emitente), vinculável a `Supplier`/`PurchaseOrder`.
--   3) `Tenant.incomingNfeLastVersion`: cursor incremental da consulta de
--      Distribuição DFe (Focus NFe `GET /v2/nfes_recebidas?versao=`).
--   4) `PurchaseOrder.supplierAccessKeyHint`: vínculo manual opcional antecipado.

ALTER TABLE "tenants" ADD COLUMN "incomingNfeLastVersion" TEXT NOT NULL DEFAULT '0';

ALTER TABLE "purchase_orders" ADD COLUMN "supplierAccessKeyHint" TEXT;

ALTER TABLE "fiscal_documents" ADD COLUMN "supplierId" TEXT;
ALTER TABLE "fiscal_documents" ADD COLUMN "purchaseOrderId" TEXT;
ALTER TABLE "fiscal_documents" ADD COLUMN "emitterCnpj" TEXT;
ALTER TABLE "fiscal_documents" ADD COLUMN "emitterName" TEXT;
ALTER TABLE "fiscal_documents" ADD COLUMN "totalAmount" DECIMAL(12, 2);

ALTER TABLE "fiscal_documents" ADD CONSTRAINT "fiscal_documents_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "fiscal_documents" ADD CONSTRAINT "fiscal_documents_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "fiscal_documents_tenantId_type_supplierId_idx" ON "fiscal_documents"("tenantId", "type", "supplierId");

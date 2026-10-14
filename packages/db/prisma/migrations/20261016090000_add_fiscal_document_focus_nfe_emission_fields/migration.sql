-- Capítulo 20.3/21.7 — fecha o gap de auditoria em que a fila BullMQ
-- `fiscal-emission` tinha produtor (close-sale.service.ts/enqueueFiscalEmission)
-- mas nenhum worker consumidor: todo FiscalDocument ficava travado em PENDING para
-- sempre e nenhuma NFC-e era de fato transmitida à SEFAZ via Focus NFe.
-- Campos devolvidos pela Focus NFe na emissão real (doc.focusnfe.com.br/reference/
-- emitir_nfce), necessários para idempotência (focusNfeReference/focusNfeStatusSefaz)
-- e para a impressão térmica do cupom NFC-e (qrCodeUrl, danfeStorageKey — Capítulo 21.7).
-- NOTA: esta migration foi escrita manualmente (ambiente sandbox sem acesso a um
-- Postgres local/shadow database para rodar `prisma migrate dev` de verdade — mesma
-- limitação documentada em 20261013152700_add_technician_commission_rule/migration.sql).
-- Aditiva: todas as colunas são NULLable, não quebra nenhuma linha existente.

-- AlterTable
ALTER TABLE "fiscal_documents" ADD COLUMN "focusNfeReference" TEXT;
ALTER TABLE "fiscal_documents" ADD COLUMN "focusNfeNumero" TEXT;
ALTER TABLE "fiscal_documents" ADD COLUMN "focusNfeSerie" TEXT;
ALTER TABLE "fiscal_documents" ADD COLUMN "focusNfeStatusSefaz" TEXT;
ALTER TABLE "fiscal_documents" ADD COLUMN "focusNfeMensagemSefaz" TEXT;
ALTER TABLE "fiscal_documents" ADD COLUMN "qrCodeUrl" TEXT;
ALTER TABLE "fiscal_documents" ADD COLUMN "danfeStorageKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_documents_focusNfeReference_key" ON "fiscal_documents"("focusNfeReference");

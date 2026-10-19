-- fa-perf-accounting-doc-generation-inline — a geração de OfficialTaxDocument
-- (SPED ECD/DEFIS/ECF/EFD-Reinf/DCTFWeb/Informe de Rendimentos do Sócio) deixa de
-- rodar síncrona dentro de `POST /official-tax-documents/generate` e passa a ser
-- enfileirada via BullMQ (`workers/accounting-document-generation.worker.ts`).
-- Novos estados intermediários do ciclo de vida assíncrono do job.
ALTER TYPE "OfficialTaxDocumentStatus" ADD VALUE IF NOT EXISTS 'PENDING';
ALTER TYPE "OfficialTaxDocumentStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';
ALTER TYPE "OfficialTaxDocumentStatus" ADD VALUE IF NOT EXISTS 'FAILED';

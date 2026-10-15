-- Rodada 5 de auditoria (r5-gatekeeper-global) — Capítulo 2.6/6.6: até esta
-- migration, closeSaleAndEmitFiscalDocument() sempre criava um FiscalDocument e
-- enfileirava a emissão real via Focus NFe para TODA venda, mesmo quando o tenant
-- nunca contratou o módulo pago FISCAL_NFCE (R$49,90/mês, ver MODULE_CATALOG em
-- seed.ts) — ou seja, a emissão fiscal real era entregue de graça. A venda em si
-- continua liberada sem o módulo (não é bloqueada, só não emite nota), mas o
-- FiscalDocument passa a nascer com este novo status em vez de PENDING, e o
-- BullMQ de emissão deixa de ser enfileirado nesse caso.
ALTER TYPE "FiscalDocumentStatus" ADD VALUE IF NOT EXISTS 'NOT_CONTRACTED';

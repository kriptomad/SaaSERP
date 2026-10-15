-- GAP DE AUDITORIA FECHADO (Mega-Audit Rodada 5, Capítulo 21.19.2): o prazo legal de
-- cancelamento de NFC-e (30 minutos, Ajuste SINIEF 07/2018) era calculado a partir de
-- `createdAt`, nunca do instante real de autorização na SEFAZ — podendo liberar
-- cancelamento fora do prazo legal (se a autorização atrasar) ou bloquear
-- indevidamente (se `createdAt` for anterior à autorização).
ALTER TABLE "fiscal_documents" ADD COLUMN "authorizedAt" TIMESTAMP(3);

-- Backfill best-effort para documentos já autorizados antes desta migração: usa
-- `updatedAt` como aproximação (foi a última atualização registrada antes da adição
-- deste campo, coerente com o momento em que o status mudou para AUTHORIZED na
-- ausência de um valor mais preciso).
UPDATE "fiscal_documents" SET "authorizedAt" = "updatedAt" WHERE "status" = 'AUTHORIZED' AND "authorizedAt" IS NULL;

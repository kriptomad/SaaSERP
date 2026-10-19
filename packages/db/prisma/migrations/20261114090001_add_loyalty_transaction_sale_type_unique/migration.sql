-- Correção de auditoria: `LoyaltyTransaction` não tinha nenhuma constraint que
-- impedisse dois lançamentos EARN (ou dois REDEEM) para a mesma venda — reprocessar
-- o fechamento de uma venda (retry de rede, replay de fila) duplicava pontos de
-- fidelidade ganhos ou permitia um segundo resgate sobre a mesma venda. `saleId`
-- nulo (MANUAL_ADJUST/EXPIRE) nunca colide entre si, pois Postgres trata NULL como
-- distinto em índices UNIQUE padrão.
CREATE UNIQUE INDEX IF NOT EXISTS "loyalty_transactions_saleId_type_key"
  ON "loyalty_transactions" ("saleId", "type");

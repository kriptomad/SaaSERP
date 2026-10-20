-- GAP DE AUDITORIA FECHADO (fa-w4-workorder-no-idempotency-key): POST /work-orders
-- não tinha nenhuma proteção contra duplo clique/retry de rede após timeout — o
-- front-end reenviava a mesma abertura de O.S. e duas ordens de serviço idênticas
-- eram criadas. Mesmo padrão de `idempotencyKey` já usado em Sale/Payment/
-- OnlineOrder: coluna opcional (nem todo client antigo envia o header) e única por
-- tenant quando informada — Postgres permite múltiplos NULLs no mesmo índice único,
-- então O.S. abertas sem a chave nunca colidem entre si.
ALTER TABLE "work_orders" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "work_orders_tenantId_idempotencyKey_key"
  ON "work_orders" ("tenantId", "idempotencyKey");

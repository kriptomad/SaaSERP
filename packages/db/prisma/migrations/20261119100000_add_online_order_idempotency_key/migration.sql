-- GAP DE AUDITORIA FECHADO (fa-online-store-order-not-idempotent): a criação de
-- pedido pela vitrine pública (public-online-store.routes.ts) não tinha nenhuma
-- proteção contra duplo clique/retry do cliente final — um clique duplo no botão
-- "Finalizar pedido" (ou um retry automático do navegador em rede instável)
-- criava dois `OnlineOrder` idênticos. Mesmo padrão de `idempotencyKey` já usado
-- em Sale/Payment/FailedOfflineSaleSync: coluna opcional (nem todo client antigo
-- envia o header) e única por tenant quando informada — Postgres permite
-- múltiplos NULLs no mesmo índice único, então pedidos sem a chave nunca colidem
-- entre si.
ALTER TABLE "online_orders" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "online_orders_tenantId_idempotencyKey_key"
  ON "online_orders" ("tenantId", "idempotencyKey");

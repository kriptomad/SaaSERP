-- Mega-audit (continuação): Capítulo 4.2 — "DELIVERED (pagamento + nota + termo de
-- garantia entregue)". A transição READY → DELIVERED existia desde sempre, mas
-- nunca cobrava o cliente, nunca criava uma Sale e nunca emitia documento fiscal —
-- gap total confirmado por auditoria (zero rota/serviço faz isso). Fecha o gap:
--   1) SaleItem.description: linha de venda sem productId/serviceId (mão de obra de
--      O.S., que não tem Service próprio) passa a ter um rótulo textual.
--   2) WorkOrder.billingSaleId: a Sale criada ao faturar/entregar a O.S., distinta de
--      WorkOrder.saleId (que é a venda que ORIGINA uma O.S. de laboratório óptico).

ALTER TABLE "sale_items" ADD COLUMN "description" TEXT;

ALTER TABLE "work_orders" ADD COLUMN "billingSaleId" TEXT;
CREATE UNIQUE INDEX "work_orders_billingSaleId_key" ON "work_orders"("billingSaleId");
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_billingSaleId_fkey" FOREIGN KEY ("billingSaleId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

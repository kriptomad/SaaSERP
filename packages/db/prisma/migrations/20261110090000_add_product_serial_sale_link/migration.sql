-- GAP DE AUDITORIA FECHADO (Rodada 6): ProductSerial não tinha nenhum vínculo
-- com a venda que o consumiu, impedindo o estorno de restaurar o serial/IMEI
-- específico para IN_STOCK (só o agregado Product.stockQuantity era revertido).
ALTER TABLE "product_serials" ADD COLUMN "saleId" TEXT;

CREATE INDEX "product_serials_tenantId_saleId_idx" ON "product_serials"("tenantId", "saleId");

ALTER TABLE "product_serials" ADD CONSTRAINT "product_serials_saleId_fkey"
  FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

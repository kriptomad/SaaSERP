-- Mega-audit rodada 7 (performance): índices compostos que faltavam para queries
-- reais já existentes no código (ver schema.prisma para o contexto de cada uma).
CREATE INDEX IF NOT EXISTS "stock_movements_tenantId_type_createdAt_idx" ON "stock_movements" ("tenantId", "type", "createdAt");
CREATE INDEX IF NOT EXISTS "sale_items_tenantId_productVariantId_idx" ON "sale_items" ("tenantId", "productVariantId");

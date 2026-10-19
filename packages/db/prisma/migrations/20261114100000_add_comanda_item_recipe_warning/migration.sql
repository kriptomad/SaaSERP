-- GAP DE AUDITORIA FECHADO (Capítulo 11.1 — Comanda Eletrônica): a decisão de
-- negócio documentada em comanda.routes.ts é permitir o lançamento do item mesmo
-- com insumo insuficiente na ficha técnica (o prato já está sendo
-- preparado/entregue ao cliente) — mas essa falha só virava um `warning` efêmero
-- na resposta HTTP do momento do lançamento, nunca persistido. Esta coluna torna o
-- evento visível/auditável (consulta, relatório, alerta), nunca silencioso.
ALTER TABLE "comanda_items" ADD COLUMN "recipeConsumptionWarning" TEXT;

-- GAP DE AUDITORIA FECHADO (fa-liquor-ledger-return-no-sale-validation): lançamento
-- manual de casco (BORROWED/RETURNED) sem saleId vinculado — ajuste administrativo —
-- não tinha nenhum registro de justificativa nem de quem autorizou o movimento.
-- `reasonCode`/`createdByUserId` são opcionais no schema (lançamentos vinculados a
-- uma venda continuam sem exigir isso, pois já têm a própria venda como trilha de
-- auditoria), mas a camada de aplicação (liquor-ledger.routes.ts) exige reasonCode
-- sempre que saleId não for informado.
ALTER TABLE "returnable_container_ledger" ADD COLUMN "reasonCode" TEXT;
ALTER TABLE "returnable_container_ledger" ADD COLUMN "createdByUserId" TEXT;

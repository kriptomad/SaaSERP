-- GAP DE AUDITORIA FECHADO (Mega-Audit Rodada 5, Capítulo 21.7/21.19): a emissão de
-- NFC-e gravava `icms_origem: "0"` (nacional) fixo para TODO produto, sem permitir
-- declarar mercadoria importada. Tabela oficial SEFAZ "Origem da Mercadoria"
-- (Convênio ICMS 38/2013): 0=nacional, 1/2=estrangeira, 3-8=conteúdo de importação.
ALTER TABLE "products" ADD COLUMN "icmsOrigin" TEXT NOT NULL DEFAULT '0';

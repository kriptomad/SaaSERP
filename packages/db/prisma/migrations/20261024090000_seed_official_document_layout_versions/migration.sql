-- Seed de leiautes oficiais vigentes (Capítulo 21.18.5) — necessário para que
-- `generateSpedEcd`/`generateDefis` (sped-ecd.service.ts) consigam resolver
-- `resolveActiveLayoutVersion()`; sem esta linha a geração falha com
-- NoActiveLayoutVersionError mesmo com o código correto.
INSERT INTO "official_document_layout_versions" ("id", "documentType", "layoutVersion", "sourceDescription", "effectiveFrom", "createdAt")
SELECT gen_random_uuid(), 'ECD', 'Leiaute 9 (ECD)', 'Ato Declaratório Executivo Cofis nº 87/2022 — Manual de Orientação do Leiaute da ECD, vigente a partir do ano-calendário 2022', '2022-01-01T00:00:00Z', now()
WHERE NOT EXISTS (
  SELECT 1 FROM "official_document_layout_versions" WHERE "documentType" = 'ECD' AND "layoutVersion" = 'Leiaute 9 (ECD)'
);

INSERT INTO "official_document_layout_versions" ("id", "documentType", "layoutVersion", "sourceDescription", "effectiveFrom", "createdAt")
SELECT gen_random_uuid(), 'DEFIS', 'DEFIS ano-calendário vigente', 'Resolução CGSN nº 140/2018, art. 66 — Declaração de Informações Socioeconômicas e Fiscais (DEFIS) do Simples Nacional', '2018-01-01T00:00:00Z', now()
WHERE NOT EXISTS (
  SELECT 1 FROM "official_document_layout_versions" WHERE "documentType" = 'DEFIS' AND "layoutVersion" = 'DEFIS ano-calendário vigente'
);

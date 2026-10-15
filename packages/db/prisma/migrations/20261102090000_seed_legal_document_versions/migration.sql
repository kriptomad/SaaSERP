-- GAP DE AUDITORIA FECHADO (Mega-Audit Rodada 5): `Tenant.termsVersionAccepted` e
-- `Tenant.privacyPolicyVersionAccepted` já existiam no schema (Capítulo 5/8.4), mas
-- nenhuma `LegalDocumentVersion` jamais foi publicada e nenhuma rota de signup de
-- fato gravava o consentimento — o cadastro simplesmente não oferecia um checkbox
-- de aceite. Seed da versão inicial publicada para que o signup tenha uma versão
-- real para referenciar (nunca um texto fixo "hardcoded" sem rastreabilidade).
INSERT INTO "legal_document_versions" ("id", "documentType", "version", "contentUrl", "publishedAt")
SELECT gen_random_uuid(), 'TERMS_OF_USE', '2025-11-v1', '/termos', now()
WHERE NOT EXISTS (
  SELECT 1 FROM "legal_document_versions" WHERE "documentType" = 'TERMS_OF_USE' AND "version" = '2025-11-v1'
);

INSERT INTO "legal_document_versions" ("id", "documentType", "version", "contentUrl", "publishedAt")
SELECT gen_random_uuid(), 'PRIVACY_POLICY', '2025-11-v1', '/privacidade', now()
WHERE NOT EXISTS (
  SELECT 1 FROM "legal_document_versions" WHERE "documentType" = 'PRIVACY_POLICY' AND "version" = '2025-11-v1'
);

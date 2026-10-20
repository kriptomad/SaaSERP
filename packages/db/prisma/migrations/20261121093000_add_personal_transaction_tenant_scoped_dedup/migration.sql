-- Correção de auditoria (fa-w4-pluggy-tx-dedup-not-tenant-scoped): o índice único
-- anterior em `personal_transactions."openFinanceExternalId"` era GLOBAL (não
-- escopado por tenant/conta). Um id de transação do agregador (Pluggy) reaproveitado
-- ou colidido entre dois tenants diferentes fazia o `upsert` em
-- `pluggy-sync.worker.ts` tratar a transação de um tenant como já existente e
-- aplicar o `update` sobre a linha do OUTRO tenant — corrupção de dado cross-tenant.
--
-- Nota de segurança desta migration (ver `MIGRATION_NOTES.md`, seção 2): como o
-- índice antigo já era globalmente único, é matematicamente impossível existirem
-- hoje duas linhas com o mesmo `("tenantId", "accountId", "openFinanceExternalId")`
-- — a nova constraint, mais permissiva, não pode falhar por duplicata preexistente.
-- Nenhum backfill/dedup de dados é necessário.
DROP INDEX IF EXISTS "personal_transactions_openFinanceExternalId_key";

-- Nome abreviado para respeitar o limite de 63 bytes de identificador do Postgres
-- (o nome "completo" no padrão Prisma ultrapassaria o limite e seria truncado).
CREATE UNIQUE INDEX IF NOT EXISTS "personal_transactions_tenant_account_ofid_key"
  ON "personal_transactions" ("tenantId", "accountId", "openFinanceExternalId");

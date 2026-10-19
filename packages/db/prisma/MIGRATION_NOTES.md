# Notas de migrations — riscos conhecidos e práticas recomendadas

Este documento registra riscos de infraestrutura identificados em auditoria sobre
migrations do Prisma **já aplicadas/históricas** neste projeto. Migrations já geradas
são imutáveis por design do Prisma (o `checksum` de cada `migration.sql` é validado
contra `_prisma_migrations` no banco; editar o conteúdo de uma migration existente
quebra esse checksum e trava `prisma migrate deploy` em qualquer ambiente que já a
tenha aplicado). Por isso, os itens abaixo são **documentação de risco conhecido**,
não correções retroativas do SQL — qualquer reconciliação de dado precisa de um plano
dedicado (nova migration de dados + validação em cópia real do banco de produção),
fora do escopo desta auditoria.

## 1. `ADD COLUMN` sem `IF NOT EXISTS` (risco de idempotência)

Migrations afetadas: `20261103090000`, `20261104090000`, `20261106090000`,
`20261107090000`, `20261108090000`, `20261109090000`, `20261110090000`,
`20261113090000`, `20261113093000`, `20261114100000`.

**Risco**: todas usam `ALTER TABLE ... ADD COLUMN ...` puro. Se a migration for
reaplicada parcialmente (ex.: restauração de backup que já tinha a coluna, drift de
schema corrigido manualmente, re-execução após falha parcial de `migrate deploy` que
aplicou DDL mas não chegou a gravar a linha em `_prisma_migrations`), o comando falha
com `column "x" of relation "y" already exists` e bloqueia o pipeline de deploy
inteiro até intervenção manual.

**Recomendação para migrations FUTURAS**: usar
`ALTER TABLE "Tabela" ADD COLUMN IF NOT EXISTS "coluna" tipo;` sempre que a migration
for de natureza "reconciliação"/"correção de drift" (não a primeira vez que a coluna é
introduzida em uma feature nova, onde `IF NOT EXISTS` mascararia um erro real de
schema). Testar sempre contra uma cópia realista do banco de produção antes do deploy.

## 2. Índices únicos novos sem validação prévia de dados duplicados

Migrations afetadas: `20261114090000_add_cash_register_open_unique_idx`,
`20261114090001_add_loyalty_transaction_sale_type_unique` (renomeada de
`20261114090000_...` para resolver timestamp duplicado — ver seção 5),
`20261109090000_add_work_order_billing`,
`20261016090000_add_fiscal_document_focus_nfe_emission_fields`.

**Risco**: `CREATE UNIQUE INDEX` falha em produção se já existirem linhas duplicadas
sob a nova restrição (ex.: dois `CashRegister` com status `OPEN` para o mesmo
operador/filial, ou duas `LoyaltyTransaction` do mesmo tipo de venda já gravadas por
uma falha de concorrência anterior). A migration trava o deploy até a duplicata ser
resolvida manualmente, no pior momento possível (durante um `migrate deploy` em
produção).

**Recomendação para migrations FUTURAS que criam índice único**: antes de aplicar,
rodar uma consulta de pré-validação equivalente ao predicado do índice (ex.:
`SELECT operatorId, filialId, COUNT(*) FROM "CashRegister" WHERE status = 'OPEN' GROUP BY 1,2 HAVING COUNT(*) > 1;`)
contra produção (ou uma cópia recente) e tratar manualmente qualquer duplicata
encontrada **antes** de rodar o `migrate deploy` que cria o índice.

## 3. FK adicionada sem checagem prévia de linhas órfãs

Arquivo:
`packages/db/prisma/migrations/20261108090000_add_cce_and_recipient_manifestation/migration.sql:24-25`
(FK em `supplierId`/`purchaseOrderId`).

**Risco**: `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY ...` falha se já existir
qualquer linha com um `supplierId`/`purchaseOrderId` que não aponte para uma linha
pai existente (órfã por exclusão manual no banco, migração de dado legado, etc.).

**Recomendação para migrations FUTURAS que adicionam FK**: rodar uma auditoria de
órfãos antes do deploy, ex.:
`SELECT t.id FROM "Tabela" t LEFT JOIN "TabelaPai" p ON p.id = t.paiId WHERE t.paiId IS NOT NULL AND p.id IS NULL;`
e decidir explicitamente (não automaticamente) se a linha órfã deve ser corrigida,
nulificada ou removida antes de aplicar a constraint.

## 4. Índices criados sem `CONCURRENTLY` em tabelas potencialmente grandes

Migrations afetadas: `20261112100000_add_perf_indexes_round7`,
`20261112103000_add_accounting_engagement_dedup_index`,
`20261114090000_add_cash_register_open_unique_idx`,
`20261114090001_add_loyalty_transaction_sale_type_unique`.

**Risco**: `CREATE INDEX`/`CREATE UNIQUE INDEX` padrão adquire um lock que bloqueia
escritas (`ACCESS EXCLUSIVE` durante parte da operação) na tabela-alvo até terminar.
Em uma tabela grande em produção, isso pode causar latência/timeout perceptível para
os tenants durante o `migrate deploy`.

**Recomendação para migrations FUTURAS em tabelas grandes**: avaliar
`CREATE INDEX CONCURRENTLY` (não pode rodar dentro de uma transação — o Prisma
encapsula cada migration em uma transação por padrão, então isso exige marcar a
migration específica para rodar fora de transação, ou aplicá-la manualmente fora do
fluxo padrão `migrate deploy` em uma janela de manutenção coordenada). Documentar a
estratégia de janela de manutenção quando `CONCURRENTLY` não for viável.

## 5. Timestamps de migration duplicados (resolvido)

`20261114090000_add_cash_register_open_unique_idx` e
`20261114090000_add_loyalty_transaction_sale_type_unique` compartilhavam o mesmo
prefixo de timestamp. Não havia dependência SQL entre as duas, então não havia falha
imediata, mas a ordem de aplicação dependia da ordenação lexicográfica do nome da
pasta — frágil para mudanças futuras/rebases. **Resolvido** renomeando a segunda para
`20261114090001_add_loyalty_transaction_sale_type_unique`, preservando a ordem
original (nenhum conteúdo SQL foi alterado, apenas o nome da pasta — nome de pasta
não é referenciado em `migration_lock.toml`, scripts, ou em código da aplicação; é
usado apenas pelo Prisma CLI no filesystem e gravado como `migration_name` na tabela
`_prisma_migrations` do banco no momento em que cada migration é aplicada).

## 6. Backfill aproximado de `FiscalDocument.authorizedAt`

Arquivo:
`packages/db/prisma/migrations/20261103090000_add_fiscal_document_authorized_at/migration.sql:6-13`.

**Risco**: a migration faz backfill de `authorizedAt` a partir de `updatedAt` como
aproximação para linhas já existentes. Se a linha tiver sido tocada depois da
autorização fiscal real por qualquer motivo não relacionado (ex.: correção manual de
outro campo, reprocessamento, migração de dado), `updatedAt` não reflete o momento
real de autorização — e `authorizedAt` é usado para calcular prazos legais de
cancelamento fiscal (SEFAZ), então um valor aproximado incorreto pode indicar
erradamente que o prazo de cancelamento ainda está aberto (ou já fechado) quando não
está.

**Status**: caveat de qualidade de dado conhecido, documentado aqui para que
nenhuma leitura futura de `authorizedAt` em linhas antigas (geradas antes da
introdução do campo) seja tratada como timestamp legal exato sem revisão. Caso seja
necessário distinguir valores aproximados de valores reais no futuro, considerar uma
nova migration que adicione uma flag explícita (ex.: `authorizedAtApproximated
boolean`) para as linhas que passaram por este backfill, em vez de inferir isso
retroativamente a partir de heurísticas sobre a data.

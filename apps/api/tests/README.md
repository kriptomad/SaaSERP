# Testes de integração — apps/api

## Suíte de isolamento multi-tenant (`tests/tenant-isolation.test.ts`)

Canário de regressão pedido na mega-auditoria (rodada 5), referente ao
Capítulo 7 do `BIBLE_ENGINEERING_V2.md` (Blindagem Multi-Tenant / Prisma
Client Extension). É um teste END-TO-END real via `supertest` contra o app
Express de verdade (`src/server.ts`), sem nenhum mock de Prisma/HTTP: cria
dois tenants reais pelo fluxo público de `/auth/signup` e garante que um
tenant nunca consegue ler, listar, editar ou apagar um recurso (`Client`,
`Product`) que pertence ao outro.

### Pré-requisitos

- Um Postgres 15 **real** de teste, com as migrations aplicadas:

  ```powershell
  cd packages\db
  npx prisma migrate deploy
  ```

- Variáveis de ambiente (ex.: `apps\api\.env.test` ou exportadas no shell)
  apontando para esse banco de teste — **nunca** aponte para um banco de
  produção/staging, pois a suíte cria e tenta remover tenants de teste:

  ```
  DATABASE_URL=postgresql://user:pass@localhost:5432/filitech_test
  JWT_PRIVATE_KEY_PATH=...   # mesmas chaves usadas em dev
  JWT_PUBLIC_KEY_PATH=...
  ```

- Redis não é estritamente necessário para esta suíte específica (ela não
  exercita filas/SSE), mas módulos carregados no boot do `server.ts` tentam
  se conectar a ele; rode também um Redis local (`docker run -p 6379:6379
  redis:7`) para evitar ruído de log de reconexão durante o teste.

### Rodando

```powershell
cd apps\api
$env:NODE_ENV = "test"
npm run test
```

`NODE_ENV=test` é o que faz `src/server.ts` exportar o `app` do Express sem
chamar `app.listen(...)` de verdade (evita `EADDRINUSE`).

## Suítes adicionais (fa-test-*, rodada de fechamento de gaps de cobertura)

As suítes abaixo foram escritas para fechar o GAP DE AUDITORIA CRÍTICO em que
o repositório possuía apenas o teste de isolamento multi-tenant acima — nenhum
teste real cobria FIFO/FEFO de estoque, Ficha Técnica/BOM, webhooks de
billing, autenticação/RBAC ou concorrência real em caixa/orçamento. Todas
seguem o MESMO padrão de `tenant-isolation.test.ts` (supertest contra o app
Express real, `prismaUnscoped` para fixtures/limpeza, nunca mock de
Prisma/HTTP/JWT/Stripe):

- `tests/stock/fifo-fefo-bom.test.ts` — `deductStockFefo` (consumo por
  validade mais próxima, bloqueio de lote vencido, estoque insuficiente com
  rollback, concorrência real via `Promise.allSettled`), `consumeRecipeForComandaItem`
  e `produceRecipeBatch` (consumo proporcional de receita/BOM, idempotência,
  rollback multi-ingrediente, perda parcial de produção).
- `tests/billing/billing-webhooks.test.ts` — assinatura HMAC real do Stripe
  (`stripe.webhooks.generateTestHeaderString`, sem rede), assinatura
  inválida/payload adulterado rejeitados, idempotência via `BillingEvent`
  (replay só aplica uma vez), eventos fora de ordem, e o fluxo equivalente do
  Asaas (token timing-safe).
- `tests/auth/auth-rbac.test.ts` — token expirado (401), token adulterado
  (401), permissão insuficiente via `RolePermission` override (403), tenant
  suspenso (402, `tenantLockoutMiddleware`), e tentativa de forjar `tenantId`
  via body/query (sempre ignorado — a rota só confia no `tenantId` do JWT
  verificado).
- `tests/tenant-contract/tenant-extension-contract.test.ts` — contrato direto
  (sem HTTP) da Prisma Client Extension multi-tenant para `ProductBatch`,
  `AccountReceivable` e `CashRegister`: findMany/findUnique/update/delete
  cross-tenant sempre bloqueados.
- `tests/concurrency/cashregister-budget-concurrency.test.ts` — duas
  aprovações de orçamento concorrentes (`Promise.allSettled` real) no mesmo
  token: exatamente uma vence; abertura de caixa concorrente (HTTP real via
  `Promise.all`) para o mesmo operador: exatamente uma vence (transação
  Serializable). **Também documenta um GAP DE AUDITORIA ENCONTRADO (não
  corrigido neste escopo, que era apenas de escrita de testes)**: duas
  chamadas concorrentes de `closeCashRegister` para o MESMO caixa não
  rejeitam a segunda — o `FOR UPDATE` serializa as transações, mas o serviço
  nunca revalida `status === "OPEN"` dentro da seção protegida, permitindo que
  a segunda chamada sobrescreva silenciosamente `closingAmount`/
  `divergenceAmount` já fechados pela primeira. Recomendação para uma rodada
  futura: adicionar `WHERE status = 'OPEN'` ao `UPDATE` final de
  `closeCashRegister`, no mesmo espírito do lock otimista já usado em
  `approve-budget.service.ts`.

### Limitação de ambiente confirmada nesta rodada

Neste ambiente de execução **não há Docker disponível** (`docker --version`
falha), portanto não foi possível subir `infra/docker/docker-compose.dev.yml`
(Postgres/Redis) nem rodar `npx prisma migrate deploy` para validar as 5
suítes acima contra um banco real. Cada arquivo foi validado com:

1. `npx tsc -p tsconfig.test.json --noEmit` — todos os 5 arquivos novos
   compilam sem nenhum erro de tipo (os únicos erros de `tsc` encontrados são
   pré-existentes, em `src/modules/accounting-office`, `src/modules/recipes`
   e `src/modules/reports`, não relacionados a este trabalho de testes).
2. `npx vitest run` — os arquivos carregam, descrevem e tentam executar
   normalmente (nenhum erro de import/sintaxe), falhando apenas no primeiro
   acesso real ao banco com `Can't reach database server at localhost:5432`
   — exatamente o comportamento esperado sem um Postgres de teste disponível.
   O boot do `src/server.ts` também gera ruído de log de reconexão ao Redis
   (`ECONNREFUSED 127.0.0.1:6379`), consistente com o já documentado acima
   para a suíte de isolamento multi-tenant.

`vitest.config.ts` já descobre arquivos aninhados via `include:
["tests/**/*.test.ts"]` — nenhuma mudança de configuração foi necessária para
que as novas suítes em subpastas (`tests/stock`, `tests/billing`, etc.) sejam
encontradas.

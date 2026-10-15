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

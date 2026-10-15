// apps/api/vitest.config.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 7 (blindagem multi-tenant) — configuração do
// Vitest usado pela suíte de regressão de isolamento (tests/tenant-isolation.test.ts).
// Requer um Postgres REAL (DATABASE_URL de teste com as migrations já aplicadas via
// `npx prisma migrate deploy`), rodando testes sequencialmente (fileParallelism/isolate
// desligados) para nunca disputar a mesma conexão/transação com outro worker.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
    include: ["tests/**/*.test.ts"],
  },
});

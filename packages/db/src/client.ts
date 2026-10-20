// packages/db/src/client.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 7.2 (bloco "src/lib/prisma.ts").
import { PrismaClient } from "@prisma/client";
import { createTenantScopedPrismaClient } from "./prisma-tenant-extension";

// CORREÇÃO DE AUDITORIA (fa-w5-perf-prisma-pool-uncapped): antes, o `PrismaClient`
// era construído sem nenhum `connection_limit` — o Prisma usa seu próprio default
// (num_cpus * 2 + 1) por INSTÂNCIA de processo, nunca coordenado entre réplicas.
// Com N réplicas da API + processo(s) de worker, cada um abrindo seu próprio pool
// default, o total de conexões reais no Postgres cresce sem nenhum teto global
// deliberado — em produção, isso já estourou (ou está perto de estourar) o
// `max_connections` do Postgres (default comum: 100) silenciosamente, sob carga.
// `DB_POOL_SIZE` (opcional) permite fixar explicitamente `connection_limit` por
// processo via variável de ambiente, sem precisar editar código — ver orientação de
// dimensionamento em `.env.example`.
function resolveDatabaseUrl(): string {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) return rawUrl as unknown as string; // deixa o Prisma lançar seu próprio erro de configuração ausente, como antes.

  const poolSize = process.env.DB_POOL_SIZE;
  if (!poolSize) return rawUrl;

  const url = new URL(rawUrl);
  url.searchParams.set("connection_limit", poolSize);
  return url.toString();
}

const basePrismaClient = new PrismaClient({
  log: ["error", "warn"],
  datasources: { db: { url: resolveDatabaseUrl() } },
});

// Client usado em todo o código de aplicação — já blindado por tenant.
export const prisma = createTenantScopedPrismaClient(basePrismaClient);

// Client "cru", reservado exclusivamente para jobs administrativos de plataforma
// (ex.: cálculo global de MRR, cron de billing) que legitimamente operam entre tenants.
export const prismaUnscoped = basePrismaClient;


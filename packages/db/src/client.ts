// packages/db/src/client.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 7.2 (bloco "src/lib/prisma.ts").
import { PrismaClient } from "@prisma/client";
import { createTenantScopedPrismaClient } from "./prisma-tenant-extension";

const basePrismaClient = new PrismaClient({ log: ["error", "warn"] });

// Client usado em todo o código de aplicação — já blindado por tenant.
export const prisma = createTenantScopedPrismaClient(basePrismaClient);

// Client "cru", reservado exclusivamente para jobs administrativos de plataforma
// (ex.: cálculo global de MRR, cron de billing) que legitimamente operam entre tenants.
export const prismaUnscoped = basePrismaClient;

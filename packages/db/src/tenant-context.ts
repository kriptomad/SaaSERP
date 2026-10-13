// packages/db/src/tenant-context.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 7.1 — AsyncLocalStorage + Prisma Client Extension.
import { AsyncLocalStorage } from "node:async_hooks";

export interface TenantContext {
  tenantId: string;
  userId: string;
  role: string;
}

export const tenantContextStorage = new AsyncLocalStorage<TenantContext>();

export function runWithTenantContext<T>(context: TenantContext, callback: () => Promise<T>): Promise<T> {
  return tenantContextStorage.run(context, callback);
}

export function getCurrentTenantId(): string {
  const context = tenantContextStorage.getStore();
  if (!context) {
    // Falha alto e explicitamente: nenhuma query tenant-scoped deve ser executada
    // fora de uma requisição autenticada. Isso impede scripts/migrations acidentais
    // de rodarem sem contexto e vazarem dados entre tenants.
    throw new Error("Tentativa de acesso ao banco fora de um contexto de tenant autenticado.");
  }
  return context.tenantId;
}

export function getCurrentContext(): TenantContext {
  const context = tenantContextStorage.getStore();
  if (!context) {
    throw new Error("Tentativa de acesso ao contexto de tenant fora de uma requisição autenticada.");
  }
  return context;
}

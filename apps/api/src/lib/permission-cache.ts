// apps/api/src/lib/permission-cache.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 3.4 — namespace Redis `tenant:{id}:cache`.
// CORREÇÃO DE AUDITORIA (fa-perf-permission-check-no-cache): `hasPermission()` era
// duplicada literalmente em dezenas de routers (reports.routes.ts,
// accounting-office.routes.ts, car-wash-service.routes.ts, gatekeeper.middleware.ts
// etc.), cada uma fazendo DOIS `findUnique` (RoleDefaultPermission + RolePermission)
// EM TODA requisição protegida — mesmo sabendo que permissões mudam raramente. Esta
// versão compartilhada cacheia a decisão (concedido/negado) por usuário/tenant em um
// hash Redis `tenant:{tenantId}:permissions:{userId}` com TTL curto (mesmo padrão de
// `TENANT_MODULE_CACHE_TTL_SECONDS` em gatekeeper.middleware.ts), e expõe funções de
// invalidação para serem chamadas por qualquer rota futura que grave em
// `RolePermission`/`RoleDefaultPermission` (nenhuma existe ainda no código — ver nota
// de auditoria no changelog desta rodada).
import { prisma } from "@filitech/db";
import { redis } from "./redis";

const PERMISSION_CACHE_TTL_SECONDS = 60;

function permissionCacheKey(tenantId: string, userId: string): string {
  return `tenant:${tenantId}:permissions:${userId}`;
}

/**
 * Resolve se `userId` (com papel `role` no tenant `tenantId`) tem a permissão
 * `permissionCode`, com cache Redis de 60s. Mesma regra de precedência de sempre:
 * override explícito em `RolePermission` vence; na ausência de override, cai no
 * default do papel (`RoleDefaultPermission`).
 */
export async function hasPermission(tenantId: string, role: string, userId: string, permissionCode: string): Promise<boolean> {
  const cacheKey = permissionCacheKey(tenantId, userId);
  const cached = await redis.hget(cacheKey, permissionCode);
  if (cached !== null) {
    return cached === "1";
  }

  const [defaultGrant, override] = await Promise.all([
    prisma.roleDefaultPermission.findUnique({ where: { role_permissionCode: { role: role as any, permissionCode } } }),
    prisma.rolePermission.findUnique({ where: { userId_permission: { userId, permission: permissionCode } } }),
  ]);
  const granted = override ? override.granted : Boolean(defaultGrant);

  await redis.hset(cacheKey, permissionCode, granted ? "1" : "0");
  await redis.expire(cacheKey, PERMISSION_CACHE_TTL_SECONDS);
  return granted;
}

/** Invalida o cache de um único usuário — chamar sempre que uma `RolePermission` dele mudar. */
export async function invalidateUserPermissionCache(tenantId: string, userId: string): Promise<void> {
  await redis.del(permissionCacheKey(tenantId, userId));
}

/**
 * Invalida o cache de TODOS os usuários de um tenant — chamar sempre que um
 * `RoleDefaultPermission` mudar (afeta potencialmente qualquer usuário do tenant que
 * não tenha override próprio para aquele código). Usa SCAN (nunca KEYS, que bloqueia
 * o Redis inteiro) para encontrar as chaves do padrão `tenant:{tenantId}:permissions:*`.
 */
export async function invalidateTenantPermissionCache(tenantId: string): Promise<void> {
  let cursor = "0";
  do {
    const [nextCursor, keys] = await redis.scan(cursor, "MATCH", `tenant:${tenantId}:permissions:*`, "COUNT", 200);
    cursor = nextCursor;
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } while (cursor !== "0");
}

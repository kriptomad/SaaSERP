// apps/api/src/middlewares/gatekeeper.middleware.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 6.1 — Upsell Gatekeeper: cruza (1) status
// financeiro do Tenant, (2) TenantModule contratado/ativo (cache Redis) e (3) RBAC
// (RoleDefaultPermission + RolePermission) em uma única chamada.
import { Request, Response, NextFunction } from "express";
import { prisma } from "@filitech/db";
import { redis } from "../lib/redis";

interface GatekeeperOptions {
  moduleCode: string;
  requiredPermission?: string;
}

const TENANT_MODULE_CACHE_TTL_SECONDS = 60;

// GAP DE AUDITORIA FECHADO — extrai os passos 1 (lockout financeiro) e 2 (módulo
// contratado/ativo) para uma função compartilhada, usada tanto por `gatekeeper()`
// quanto pelos novos middlewares `requireModule`/`requireAnyModule` abaixo. Antes
// desta correção, as rotas de nicho (O.S., laboratório óptico, pneus, lava-rápido,
// construção, prontuários etc.) nunca aplicavam NENHUMA verificação de módulo
// contratado no servidor — a trava só existia no menu do frontend, nunca na API.
async function checkTenantStatusAndModule(
  tenantId: string,
  moduleCode: string,
): Promise<{ status: number; body: Record<string, unknown> } | null> {
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { status: true },
  });

  if (tenant.status === "SUSPENDED") {
    return {
      status: 402,
      body: {
        success: false,
        data: null,
        error: {
          code: "TENANT_SUSPENDED",
          message: "Assinatura suspensa por inadimplência. Regularize o pagamento para continuar.",
        },
      },
    };
  }

  const cacheKey = `tenant:${tenantId}:modules`;
  let activeModuleCodes = await redis.smembers(cacheKey);

  if (activeModuleCodes.length === 0) {
    const tenantModules = await prisma.tenantModule.findMany({
      where: { tenantId, active: true },
      include: { module: { select: { code: true } } },
    });
    activeModuleCodes = tenantModules.map((tm) => tm.module.code);
    if (activeModuleCodes.length > 0) {
      await redis.sadd(cacheKey, ...activeModuleCodes);
      await redis.expire(cacheKey, TENANT_MODULE_CACHE_TTL_SECONDS);
    }
  }

  if (!activeModuleCodes.includes(moduleCode)) {
    const moduleInfo = await prisma.module.findUnique({ where: { code: moduleCode } });
    return {
      status: 402,
      body: {
        success: false,
        data: null,
        error: { code: "MODULE_NOT_ACTIVE", message: `O módulo "${moduleInfo?.label ?? moduleCode}" não está contratado.` },
        upsell: {
          moduleCode,
          label: moduleInfo?.label,
          price: moduleInfo?.monthlyPrice,
          checkoutUrl: `/billing/upsell?module=${moduleCode}`,
        },
      },
    };
  }

  return null;
}

// Mesma checagem acima, mas satisfeita se o tenant tiver QUALQUER UM dos módulos
// informados (ex.: Agenda é usada por SALON_BOOKING, CAR_WASH_QUEUE e PETSHOP_VET —
// nenhum deles sozinho é "o" módulo da rota). Em caso de falha, retorna o 402 do
// PRIMEIRO módulo da lista (upsell aponta para a opção mais comum/barata do grupo).
async function checkTenantStatusAndAnyModule(
  tenantId: string,
  moduleCodes: string[],
): Promise<{ status: number; body: Record<string, unknown> } | null> {
  let firstFailure: { status: number; body: Record<string, unknown> } | null = null;
  for (const moduleCode of moduleCodes) {
    const failure = await checkTenantStatusAndModule(tenantId, moduleCode);
    if (!failure) return null; // achou um módulo ativo — libera
    if (failure.status === 402 && (failure.body.error as { code?: string })?.code === "TENANT_SUSPENDED") {
      return failure; // lockout por inadimplência tem precedência absoluta, não adianta checar outro módulo
    }
    firstFailure ??= failure;
  }
  return firstFailure;
}

function unauthenticated(res: Response) {
  return res.status(401).json({
    success: false,
    data: null,
    error: { code: "UNAUTHENTICATED", message: "Sessão ausente ou expirada." },
  });
}

async function checkPermission(role: string, userId: string, permissionCode: string): Promise<boolean> {
  const [defaultGrant, override] = await Promise.all([
    prisma.roleDefaultPermission.findUnique({
      where: { role_permissionCode: { role: role as any, permissionCode } },
    }),
    prisma.rolePermission.findUnique({
      where: { userId_permission: { userId, permission: permissionCode } },
    }),
  ]);
  return override ? override.granted : Boolean(defaultGrant);
}

export function gatekeeper(options: GatekeeperOptions) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const session = req.session;
    if (!session?.tenantId || !session?.userId) {
      return unauthenticated(res);
    }

    const failure = await checkTenantStatusAndModule(session.tenantId, options.moduleCode);
    if (failure) {
      return res.status(failure.status).json(failure.body);
    }

    if (options.requiredPermission) {
      const isGranted = await checkPermission(session.role, session.userId, options.requiredPermission);
      if (!isGranted) {
        return res.status(403).json({
          success: false,
          data: null,
          error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite esta ação." },
        });
      }
    }

    return next();
  };
}

// Middleware leve para compor com checagens de permissão já existentes por rota
// (ex.: `hasPermission()` local em `client-records.routes.ts`): só valida sessão +
// lockout + módulo contratado, sem duplicar a lógica de RBAC já escrita no handler.
export function requireModule(moduleCode: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const session = req.session;
    if (!session?.tenantId) {
      return unauthenticated(res);
    }
    const failure = await checkTenantStatusAndModule(session.tenantId, moduleCode);
    if (failure) {
      return res.status(failure.status).json(failure.body);
    }
    return next();
  };
}

// Variante "QUALQUER UM" de `requireModule`, para rotas compartilhadas por mais de
// um nicho (ex.: Agenda usada por Salão, Lava-Rápido e Petshop).
export function requireAnyModule(moduleCodes: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const session = req.session;
    if (!session?.tenantId) {
      return unauthenticated(res);
    }
    const failure = await checkTenantStatusAndAnyModule(session.tenantId, moduleCodes);
    if (failure) {
      return res.status(failure.status).json(failure.body);
    }
    return next();
  };
}

/// Invalida o cache de módulos ativos de um tenant — deve ser chamado pelo handler de
/// billing (ativação/desativação de módulo) dentro da mesma transação lógica, conforme
/// a nota do Capítulo 6.1.
export async function invalidateTenantModuleCache(tenantId: string): Promise<void> {
  await redis.del(`tenant:${tenantId}:modules`);
}


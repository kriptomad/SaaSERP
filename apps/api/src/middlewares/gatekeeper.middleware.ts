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

export function gatekeeper(options: GatekeeperOptions) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const session = req.session;
    if (!session?.tenantId || !session?.userId) {
      return res.status(401).json({
        success: false,
        data: null,
        error: { code: "UNAUTHENTICATED", message: "Sessão ausente ou expirada." },
      });
    }

    // 1. Status financeiro do tenant — precedência absoluta (Tenant Lockout, Capítulo 2).
    const tenant = await prisma.tenant.findUniqueOrThrow({
      where: { id: session.tenantId },
      select: { status: true },
    });

    if (tenant.status === "SUSPENDED") {
      return res.status(402).json({
        success: false,
        data: null,
        error: {
          code: "TENANT_SUSPENDED",
          message: "Assinatura suspensa por inadimplência. Regularize o pagamento para continuar.",
        },
      });
    }

    // 2. Módulo contratado e ativo — cache em Redis por tenant.
    const cacheKey = `tenant:${session.tenantId}:modules`;
    let activeModuleCodes = await redis.smembers(cacheKey);

    if (activeModuleCodes.length === 0) {
      const tenantModules = await prisma.tenantModule.findMany({
        where: { tenantId: session.tenantId, active: true },
        include: { module: { select: { code: true } } },
      });
      activeModuleCodes = tenantModules.map((tm) => tm.module.code);
      if (activeModuleCodes.length > 0) {
        await redis.sadd(cacheKey, ...activeModuleCodes);
        await redis.expire(cacheKey, TENANT_MODULE_CACHE_TTL_SECONDS);
      }
    }

    if (!activeModuleCodes.includes(options.moduleCode)) {
      const moduleInfo = await prisma.module.findUnique({ where: { code: options.moduleCode } });
      return res.status(402).json({
        success: false,
        data: null,
        error: { code: "MODULE_NOT_ACTIVE", message: `O módulo "${moduleInfo?.label ?? options.moduleCode}" não está contratado.` },
        upsell: {
          moduleCode: options.moduleCode,
          label: moduleInfo?.label,
          price: moduleInfo?.monthlyPrice,
          checkoutUrl: `/billing/upsell?module=${options.moduleCode}`,
        },
      });
    }

    // 3. RBAC — matriz padrão por papel (RoleDefaultPermission) + override por usuário
    // (RolePermission), que tem prioridade absoluta quando existe (conceder ou revogar).
    if (options.requiredPermission) {
      const [defaultGrant, override] = await Promise.all([
        prisma.roleDefaultPermission.findUnique({
          where: { role_permissionCode: { role: session.role as any, permissionCode: options.requiredPermission } },
        }),
        prisma.rolePermission.findUnique({
          where: { userId_permission: { userId: session.userId, permission: options.requiredPermission } },
        }),
      ]);

      const isGranted = override ? override.granted : Boolean(defaultGrant);

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

/// Invalida o cache de módulos ativos de um tenant — deve ser chamado pelo handler de
/// billing (ativação/desativação de módulo) dentro da mesma transação lógica, conforme
/// a nota do Capítulo 6.1.
export async function invalidateTenantModuleCache(tenantId: string): Promise<void> {
  await redis.del(`tenant:${tenantId}:modules`);
}

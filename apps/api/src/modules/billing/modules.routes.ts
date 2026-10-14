// apps/api/src/modules/billing/modules.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 2.6 — ativação/desativação de módulos à la
// carte pelo próprio lojista (fluxo de upsell: o payload 402 do gatekeeper aponta para
// `checkoutUrl: /api/v1/billing/modules/{moduleCode}/activate`, exatamente esta rota).
//
// Protegida por requireAuth + RBAC "billing:subscription:manage" (matriz padrão:
// apenas OWNER/MANAGER, ver seed.ts) — nunca por CASHIER/TECHNICIAN. Ao mudar o
// estado de TenantModule, invalida imediatamente o cache Redis do gatekeeper
// (Capítulo 6.1) para que a liberação/bloqueio tenha efeito na próxima requisição,
// sem esperar o TTL de 60s expirar.
import { Router, Request, Response } from "express";
import { prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";
import { invalidateTenantModuleCache } from "../../middlewares/gatekeeper.middleware";

export const modulesRouter = Router();

export async function hasManageSubscriptionPermission(role: string, userId: string): Promise<boolean> {
  const permissionCode = "billing:subscription:manage";
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

// GET /billing/modules/active — Capítulo 4 (feature-flipping por nicho): qualquer
// usuário autenticado do tenant pode consultar quais módulos (ex.: WORK_ORDER,
// LIQUOR_LEDGER, RECIPE_BOM, PHARMACY_SNGPC) estão ativos, para que o frontend
// mostre/esconda as telas de nicho correspondentes na navegação (não é uma rota de
// gerenciamento, por isso não exige "billing:subscription:manage" — só requireAuth).
modulesRouter.get("/billing/modules/active", requireAuth, async (req: Request, res: Response) => {
  const { tenantId } = req.session!;
  const activeModules = await prisma.tenantModule.findMany({
    where: { tenantId, active: true },
    select: { moduleCode: true },
  });
  return res.json({ success: true, data: { moduleCodes: activeModules.map((m) => m.moduleCode) }, error: null });
});


modulesRouter.post("/billing/modules/:moduleCode/activate", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  const { moduleCode } = req.params;

  if (!(await hasManageSubscriptionPermission(role, userId))) {
    return res.status(403).json({
      success: false,
      data: null,
      error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite gerenciar módulos contratados." },
    });
  }

  const module = await prisma.module.findUnique({ where: { code: moduleCode } });
  if (!module || !module.active) {
    return res.status(404).json({
      success: false,
      data: null,
      error: { code: "MODULE_NOT_FOUND", message: `Módulo "${moduleCode}" não existe ou foi descontinuado.` },
    });
  }

  const tenantModule = await prisma.tenantModule.upsert({
    where: { tenantId_moduleCode: { tenantId, moduleCode } },
    update: { active: true, deactivatedAt: null },
    create: { tenantId, moduleCode, active: true },
  });

  await invalidateTenantModuleCache(tenantId);

  return res.json({
    success: true,
    data: {
      moduleCode: tenantModule.moduleCode,
      active: tenantModule.active,
      activatedAt: tenantModule.activatedAt,
      monthlyPrice: module.monthlyPrice,
    },
    error: null,
  });
});

modulesRouter.post("/billing/modules/:moduleCode/deactivate", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  const { moduleCode } = req.params;

  if (!(await hasManageSubscriptionPermission(role, userId))) {
    return res.status(403).json({
      success: false,
      data: null,
      error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite gerenciar módulos contratados." },
    });
  }

  const existing = await prisma.tenantModule.findUnique({ where: { tenantId_moduleCode: { tenantId, moduleCode } } });
  if (!existing?.active) {
    return res.json({ success: true, data: { moduleCode, active: false }, error: null });
  }

  await prisma.tenantModule.update({
    where: { tenantId_moduleCode: { tenantId, moduleCode } },
    data: { active: false, deactivatedAt: new Date() },
  });

  await invalidateTenantModuleCache(tenantId);

  return res.json({ success: true, data: { moduleCode, active: false }, error: null });
});

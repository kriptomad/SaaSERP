// apps/api/src/modules/optical/health-insurance-plans.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 11.2 — Ótica: convênios/planos de saúde
// faturam em lote. CRUD simples do cadastro do convênio (`HealthInsurancePlan`);
// o faturamento consolidado em si (agrupar vendas → AccountReceivable) vive em
// `health-insurance-billing.routes.ts`.
import { Router, Request, Response } from "express";
import { z } from "zod";
import { prismaUnscoped as prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";

export const healthInsurancePlansRouter = Router();

async function hasPermission(role: string, userId: string, permissionCode: string): Promise<boolean> {
  const [defaultGrant, override] = await Promise.all([
    prisma.roleDefaultPermission.findUnique({ where: { role_permissionCode: { role: role as any, permissionCode } } }),
    prisma.rolePermission.findUnique({ where: { userId_permission: { userId, permission: permissionCode } } }),
  ]);
  return override ? override.granted : Boolean(defaultGrant);
}
async function requireRead(req: Request, res: Response): Promise<boolean> {
  const { userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "optical:health-insurance:read"))) {
    res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite consultar convênios." } });
    return false;
  }
  return true;
}
async function requireWrite(req: Request, res: Response): Promise<boolean> {
  const { userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "optical:health-insurance:write"))) {
    res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite editar convênios." } });
    return false;
  }
  return true;
}

const planSchema = z.object({
  name: z.string().min(1),
  billingDueDay: z.number().int().min(1).max(28),
  active: z.boolean().optional(),
});

healthInsurancePlansRouter.get("/health-insurance-plans", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireRead(req, res))) return;
  const { tenantId } = req.session!;
  const plans = await prisma.healthInsurancePlan.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
  return res.json({ success: true, data: plans, error: null });
});

healthInsurancePlansRouter.post("/health-insurance-plans", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireWrite(req, res))) return;
  const parsed = planSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  const { tenantId } = req.session!;
  try {
    const plan = await prisma.healthInsurancePlan.create({ data: { tenantId, ...parsed.data } });
    return res.status(201).json({ success: true, data: plan, error: null });
  } catch (err: any) {
    if (err?.code === "P2002") return res.status(409).json({ success: false, data: null, error: { code: "PLAN_ALREADY_EXISTS", message: "Já existe um convênio com este nome neste tenant." } });
    throw err;
  }
});

healthInsurancePlansRouter.patch("/health-insurance-plans/:id", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireWrite(req, res))) return;
  const parsed = planSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  const { tenantId } = req.session!;
  const existing = await prisma.healthInsurancePlan.findFirst({ where: { id: req.params.id, tenantId } });
  if (!existing) return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Convênio não encontrado." } });
  const plan = await prisma.healthInsurancePlan.update({ where: { id: existing.id }, data: parsed.data });
  return res.json({ success: true, data: plan, error: null });
});

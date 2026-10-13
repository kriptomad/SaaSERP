// apps/api/src/modules/optical/health-insurance-billing.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 11.2 — Ótica: "venda individual no PDV
// normal, mas recebimento vira AccountReceivable consolidada por convênio com
// vencimento próprio". A venda em si (Sale.paymentMethod = HEALTH_INSURANCE) já é
// fechada normalmente por close-sale.service.ts; este módulo só consolida, sob
// demanda (fatura mensal real da operadora), todas as vendas ainda não faturadas
// de um convênio em uma ÚNICA AccountReceivable.
import { Router, Request, Response } from "express";
import { z } from "zod";
import { Prisma, prismaUnscoped as prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";

export const healthInsuranceBillingRouter = Router();

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
    res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite consultar faturamento de convênio." } });
    return false;
  }
  return true;
}
async function requireWrite(req: Request, res: Response): Promise<boolean> {
  const { userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "optical:health-insurance:write"))) {
    res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite faturar convênio." } });
    return false;
  }
  return true;
}

// Lista as vendas HEALTH_INSURANCE deste convênio ainda não incluídas em nenhuma
// fatura consolidada — a "pré-visualização" da próxima fatura antes de fechá-la.
healthInsuranceBillingRouter.get("/health-insurance-plans/:planId/unbilled-sales", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireRead(req, res))) return;
  const { tenantId } = req.session!;
  const plan = await prisma.healthInsurancePlan.findFirst({ where: { id: req.params.planId, tenantId } });
  if (!plan) return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Convênio não encontrado." } });
  const sales = await prisma.sale.findMany({
    where: { tenantId, healthInsurancePlanId: plan.id, healthInsuranceReceivableId: null, status: "PAID" },
    include: { client: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const totalAmount = sales.reduce((sum, s) => sum.plus(s.totalAmount), new Prisma.Decimal(0));
  return res.json({ success: true, data: { sales, totalAmount, count: sales.length }, error: null });
});

const billingSchema = z.object({ dueDate: z.coerce.date(), referenceDescription: z.string().optional() });

// Fecha a fatura consolidada: agrupa TODAS as vendas HEALTH_INSURANCE ainda não
// faturadas deste convênio em uma única AccountReceivable (sem clientId — o
// devedor desta conta é o convênio, não um cliente final) e marca cada venda como
// faturada (`Sale.healthInsuranceReceivableId`), para nunca cobrá-la duas vezes.
healthInsuranceBillingRouter.post("/health-insurance-plans/:planId/close-billing", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireWrite(req, res))) return;
  const parsed = billingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  const { tenantId } = req.session!;
  const plan = await prisma.healthInsurancePlan.findFirst({ where: { id: req.params.planId, tenantId } });
  if (!plan) return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Convênio não encontrado." } });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const sales = await tx.sale.findMany({
        where: { tenantId, healthInsurancePlanId: plan.id, healthInsuranceReceivableId: null, status: "PAID" },
        select: { id: true, totalAmount: true },
      });
      if (sales.length === 0) throw new Error("NO_UNBILLED_SALES");
      const totalAmount = sales.reduce((sum, s) => sum.plus(s.totalAmount), new Prisma.Decimal(0));

      const receivable = await tx.accountReceivable.create({
        data: {
          tenantId,
          description: parsed.data.referenceDescription ?? `Fatura consolidada — convênio ${plan.name}`,
          amount: totalAmount,
          dueDate: parsed.data.dueDate,
          status: "PENDING",
          healthInsurancePlanId: plan.id,
        },
      });

      // updateMany com o mesmo WHERE (healthInsuranceReceivableId: null) usado na
      // leitura acima, dentro da MESMA transação — mesmo padrão de claim atômico já
      // usado no débito de crediário (close-sale.service.ts) para nunca faturar
      // duas vezes a mesma venda em caso de corrida com outra chamada concorrente.
      await tx.sale.updateMany({
        where: { id: { in: sales.map((s) => s.id) }, tenantId, healthInsuranceReceivableId: null },
        data: { healthInsuranceReceivableId: receivable.id },
      });

      return { receivable, billedSalesCount: sales.length, totalAmount };
    });
    return res.status(201).json({ success: true, data: result, error: null });
  } catch (err: any) {
    if (err?.message === "NO_UNBILLED_SALES") {
      return res.status(409).json({ success: false, data: null, error: { code: "NO_UNBILLED_SALES", message: "Não há vendas pendentes de faturamento para este convênio." } });
    }
    throw err;
  }
});

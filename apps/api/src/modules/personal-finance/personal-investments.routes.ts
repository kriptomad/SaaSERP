// apps/api/src/modules/personal-finance/personal-investments.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 22.6 (Mark-to-Market de
// Investimentos pessoais). Ver `personal-accounts.routes.ts` para o
// cabeçalho completo do gap de auditoria que originou o módulo "Filitech
// Pessoal".
import { Router, Request, Response } from "express";
import { z } from "zod";
import { Prisma, prismaUnscoped as prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";

export const personalInvestmentsRouter = Router();

async function hasPermission(role: string, userId: string, permissionCode: string): Promise<boolean> {
  const [defaultGrant, override] = await Promise.all([
    prisma.roleDefaultPermission.findUnique({ where: { role_permissionCode: { role: role as any, permissionCode } } }),
    prisma.rolePermission.findUnique({ where: { userId_permission: { userId, permission: permissionCode } } }),
  ]);
  return override ? override.granted : Boolean(defaultGrant);
}

async function requireFinancialRead(req: Request, res: Response): Promise<boolean> {
  const { userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "financial:*:read"))) {
    res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite consultar dados financeiros." } });
    return false;
  }
  return true;
}

async function requireFinancialWrite(req: Request, res: Response): Promise<boolean> {
  const { userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "financial:*:write"))) {
    res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite lançar dados financeiros." } });
    return false;
  }
  return true;
}

personalInvestmentsRouter.get("/personal/investments", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireFinancialRead(req, res))) return;
  const { tenantId } = req.session!;
  const investments = await prisma.personalInvestment.findMany({ where: { tenantId }, orderBy: { assetName: "asc" } });
  const withMarketValue = investments.map((i) => ({
    ...i,
    marketValue: i.quantity.mul(i.currentPrice),
    unrealizedGainLoss: i.quantity.mul(i.currentPrice.minus(i.averagePrice)),
  }));
  return res.json({ success: true, data: withMarketValue, error: null });
});

const createInvestmentSchema = z.object({
  accountId: z.string(),
  assetType: z.enum(["TESOURO_DIRETO", "CDB", "LCI_LCA", "ACOES", "FII", "CRIPTO", "PREVIDENCIA_PRIVADA", "POUPANCA"]),
  assetName: z.string().min(1),
  ticker: z.string().optional(),
  quantity: z.number().positive(),
  averagePrice: z.number().positive(),
  currentPrice: z.number().positive(),
});

personalInvestmentsRouter.post("/personal/investments", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireFinancialWrite(req, res))) return;
  const parsed = createInvestmentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const { tenantId } = req.session!;
  if (!(await prisma.personalAccount.count({ where: { id: parsed.data.accountId, tenantId } }))) {
    return res.status(404).json({ success: false, data: null, error: { code: "ACCOUNT_NOT_FOUND", message: "Conta não encontrada neste tenant." } });
  }
  const investment = await prisma.personalInvestment.create({ data: { tenantId, ...parsed.data } });
  return res.status(201).json({ success: true, data: investment, error: null });
});

const updatePriceSchema = z.object({ currentPrice: z.number().positive(), priceDate: z.coerce.date().optional() });

// Atualização manual do preço de mercado (o job diário de cotação via BrasilAPI,
// Capítulo 22.6, fica pendente nesta correção — ver nota no final do arquivo).
// Grava histórico diário em PersonalInvestmentPriceHistory de forma idempotente
// (@@unique([investmentId, priceDate])) para nunca duplicar o ponto do gráfico.
personalInvestmentsRouter.patch("/personal/investments/:id/price", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireFinancialWrite(req, res))) return;
  const parsed = updatePriceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const { tenantId } = req.session!;
  const investment = await prisma.personalInvestment.findFirst({ where: { id: req.params.id, tenantId } });
  if (!investment) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Investimento não encontrado." } });
  }
  const priceDate = parsed.data.priceDate ?? new Date(new Date().toDateString());

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.personalInvestment.update({ where: { id: investment.id }, data: { currentPrice: parsed.data.currentPrice } });
    const history = await tx.personalInvestmentPriceHistory.upsert({
      where: { investmentId_priceDate: { investmentId: investment.id, priceDate } },
      create: { investmentId: investment.id, priceDate, closingPrice: parsed.data.currentPrice },
      update: { closingPrice: parsed.data.currentPrice },
    });
    return { investment: updated, history };
  });

  return res.json({ success: true, data: result, error: null });
});

personalInvestmentsRouter.get("/personal/investments/:id/price-history", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireFinancialRead(req, res))) return;
  const { tenantId } = req.session!;
  const investment = await prisma.personalInvestment.findFirst({ where: { id: req.params.id, tenantId } });
  if (!investment) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Investimento não encontrado." } });
  }
  const history = await prisma.personalInvestmentPriceHistory.findMany({ where: { investmentId: investment.id }, orderBy: { priceDate: "asc" } });
  return res.json({ success: true, data: history, error: null });
});

personalInvestmentsRouter.delete("/personal/investments/:id", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireFinancialWrite(req, res))) return;
  const { tenantId } = req.session!;
  const investment = await prisma.personalInvestment.findFirst({ where: { id: req.params.id, tenantId } });
  if (!investment) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Investimento não encontrado." } });
  }
  await prisma.personalInvestment.delete({ where: { id: investment.id } });
  return res.json({ success: true, data: { id: investment.id }, error: null });
});

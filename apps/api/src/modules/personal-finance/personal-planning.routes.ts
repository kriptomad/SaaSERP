// apps/api/src/modules/personal-finance/personal-planning.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 22.4 (Recorrência/Orçamento),
// 22.5 (Open Finance/consentimentos), 22.6 (Patrimônio Líquido), 22.7
// (Calculadora de quitação de dívidas), 22.8/22.9 (Fatura de cartão e
// contas a pagar). Ver `personal-accounts.routes.ts` para o cabeçalho
// completo do gap de auditoria que originou todo o módulo "Filitech Pessoal".
import { Router, Request, Response } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";
import { pluggySyncQueue } from "../../lib/queue";

export const personalPlanningRouter = Router();

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

// Anti FK-injection: todo id de conta/categoria vindo do body precisa pertencer ao tenant da sessão.
async function ownsAccountAndCategory(tenantId: string, accountIds: (string | undefined)[], categoryIds: (string | undefined)[]): Promise<boolean> {
  const accounts = [...new Set(accountIds.filter((id): id is string => Boolean(id)))];
  const categories = [...new Set(categoryIds.filter((id): id is string => Boolean(id)))];
  const [accountCount, categoryCount] = await Promise.all([
    accounts.length ? prisma.personalAccount.count({ where: { id: { in: accounts }, tenantId } }) : Promise.resolve(0),
    categories.length ? prisma.personalCategory.count({ where: { id: { in: categories }, tenantId } }) : Promise.resolve(0),
  ]);
  return accountCount === accounts.length && categoryCount === categories.length;
}

function foreignReference(res: Response) {
  return res.status(404).json({ success: false, data: null, error: { code: "REFERENCE_NOT_FOUND", message: "Conta ou categoria informada não existe neste tenant." } });
}

// ─────────────────────────────────────────────────────────────────────────
// REGRAS DE RECORRÊNCIA
// ─────────────────────────────────────────────────────────────────────────

personalPlanningRouter.get("/personal/recurrence-rules", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireFinancialRead(req, res))) return;
  const { tenantId } = req.session!;
  const rules = await prisma.personalRecurrenceRule.findMany({ where: { tenantId }, orderBy: { nextOccurrenceAt: "asc" }, take: 500 });
  return res.json({ success: true, data: rules, error: null });
});

const createRecurrenceRuleSchema = z.object({
  frequency: z.enum(["WEEKLY", "MONTHLY", "YEARLY"]),
  dayOfMonth: z.number().int().min(1).max(31).optional(),
  templateDescription: z.string().min(1),
  templateAmount: z.number(), // negativo = despesa, positivo = receita (convenção do template, Capítulo 22.4) — convertido para amount sempre positivo + type na transação gerada pelo worker
  templateAccountId: z.string(),
  templateCategoryId: z.string().optional(),
  nextOccurrenceAt: z.coerce.date(),
  endDate: z.coerce.date().optional(),
});

personalPlanningRouter.post("/personal/recurrence-rules", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireFinancialWrite(req, res))) return;
  const parsed = createRecurrenceRuleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const { tenantId } = req.session!;
  if (!(await ownsAccountAndCategory(tenantId, [parsed.data.templateAccountId], [parsed.data.templateCategoryId]))) return foreignReference(res);
  const rule = await prisma.personalRecurrenceRule.create({ data: { tenantId, ...parsed.data, templateAmount: new Prisma.Decimal(parsed.data.templateAmount) } });
  return res.status(201).json({ success: true, data: rule, error: null });
});

personalPlanningRouter.patch("/personal/recurrence-rules/:id", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireFinancialWrite(req, res))) return;
  const parsed = createRecurrenceRuleSchema.partial().extend({ active: z.boolean().optional() }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const { tenantId } = req.session!;
  const rule = await prisma.personalRecurrenceRule.findFirst({ where: { id: req.params.id, tenantId } });
  if (!rule) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Regra de recorrência não encontrada." } });
  }
  const { templateAmount, ...rest } = parsed.data;
  if (!(await ownsAccountAndCategory(tenantId, [rest.templateAccountId], [rest.templateCategoryId]))) return foreignReference(res);
  const updated = await prisma.personalRecurrenceRule.update({
    where: { id: rule.id },
    data: { ...rest, ...(templateAmount !== undefined ? { templateAmount: new Prisma.Decimal(templateAmount) } : {}) },
  });
  return res.json({ success: true, data: updated, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// ORÇAMENTOS MENSAIS (BUDGET)
// ─────────────────────────────────────────────────────────────────────────

personalPlanningRouter.get("/personal/budgets", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireFinancialRead(req, res))) return;
  const { tenantId, userId } = req.session!;
  const monthReferenceParam = req.query.monthReference as string | undefined;
  const budgets = await prisma.personalBudget.findMany({
    where: { tenantId, ...(monthReferenceParam ? { monthReference: new Date(monthReferenceParam) } : {}) },
    include: { category: true },
    orderBy: { monthReference: "desc" },
    take: 500,
  });

  // Progresso calculado on-the-fly (Capítulo 22.4) — nunca armazenado, para
  // sempre refletir o extrato real no momento da consulta.
  const withProgress = await Promise.all(
    budgets.map(async (budget) => {
      const monthStart = budget.monthReference;
      const monthEnd = new Date(monthStart); monthEnd.setMonth(monthEnd.getMonth() + 1);
      const spent = await prisma.personalTransaction.aggregate({
        // Capítulo 22.3 — despesas privadas de outro morador não entram no progresso visto por este usuário.
        where: { tenantId, categoryId: budget.categoryId, type: "EXPENSE", transactionDate: { gte: monthStart, lt: monthEnd }, OR: [{ isPrivate: false }, { createdByUserId: userId }] },
        _sum: { amount: true },
      });
      const spentAmount = spent._sum.amount ?? new Prisma.Decimal(0);
      return { ...budget, spentAmount, percentageUsed: budget.limitAmount.isZero() ? 0 : spentAmount.div(budget.limitAmount).mul(100).toNumber() };
    }),
  );
  return res.json({ success: true, data: withProgress, error: null });
});

const createBudgetSchema = z.object({
  categoryId: z.string(),
  monthReference: z.coerce.date(),
  limitAmount: z.number().positive(),
  rolloverEnabled: z.boolean().default(false),
});

personalPlanningRouter.post("/personal/budgets", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireFinancialWrite(req, res))) return;
  const parsed = createBudgetSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const { tenantId } = req.session!;
  if (!(await ownsAccountAndCategory(tenantId, [], [parsed.data.categoryId]))) return foreignReference(res);
  // monthReference sempre normalizado para o dia 01 (regra do schema, Capítulo 22.4).
  const normalizedMonth = new Date(parsed.data.monthReference.getFullYear(), parsed.data.monthReference.getMonth(), 1);
  const budget = await prisma.personalBudget.upsert({
    where: { tenantId_categoryId_monthReference: { tenantId, categoryId: parsed.data.categoryId, monthReference: normalizedMonth } },
    create: { tenantId, categoryId: parsed.data.categoryId, monthReference: normalizedMonth, limitAmount: parsed.data.limitAmount, rolloverEnabled: parsed.data.rolloverEnabled },
    update: { limitAmount: parsed.data.limitAmount, rolloverEnabled: parsed.data.rolloverEnabled },
  });
  return res.status(201).json({ success: true, data: budget, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// METAS (GOALS)
// ─────────────────────────────────────────────────────────────────────────

personalPlanningRouter.get("/personal/goals", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireFinancialRead(req, res))) return;
  const { tenantId } = req.session!;
  const goals = await prisma.personalGoal.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 500 });
  return res.json({ success: true, data: goals, error: null });
});

const createGoalSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["SAVINGS", "DEBT_PAYOFF", "EMERGENCY_FUND", "PURCHASE"]),
  targetAmount: z.number().positive(),
  targetDate: z.coerce.date().optional(),
  linkedAccountId: z.string().optional(),
});

personalPlanningRouter.post("/personal/goals", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireFinancialWrite(req, res))) return;
  const parsed = createGoalSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const { tenantId } = req.session!;
  if (!(await ownsAccountAndCategory(tenantId, [parsed.data.linkedAccountId], []))) return foreignReference(res);
  const goal = await prisma.personalGoal.create({ data: { tenantId, ...parsed.data } });
  return res.status(201).json({ success: true, data: goal, error: null });
});

personalPlanningRouter.patch("/personal/goals/:id", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireFinancialWrite(req, res))) return;
  const parsed = z.object({ currentAmount: z.number().nonnegative().optional(), status: z.enum(["ACTIVE", "COMPLETED", "ABANDONED"]).optional() }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const { tenantId } = req.session!;
  const goal = await prisma.personalGoal.findFirst({ where: { id: req.params.id, tenantId } });
  if (!goal) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Meta não encontrada." } });
  }
  const updated = await prisma.personalGoal.update({ where: { id: goal.id }, data: parsed.data });
  return res.json({ success: true, data: updated, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// DÍVIDAS + CALCULADORA DE QUITAÇÃO (SNOWBALL/AVALANCHE, Capítulo 22.7)
// ─────────────────────────────────────────────────────────────────────────

personalPlanningRouter.get("/personal/debts", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireFinancialRead(req, res))) return;
  const { tenantId } = req.session!;
  const debts = await prisma.personalDebt.findMany({ where: { tenantId }, include: { installments: { orderBy: { installmentNumber: "asc" } } }, orderBy: { createdAt: "desc" }, take: 500 });
  return res.json({ success: true, data: debts, error: null });
});

const createDebtSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["FINANCIAMENTO_IMOVEL", "FINANCIAMENTO_VEICULO", "EMPRESTIMO_PESSOAL", "CARTAO_PARCELADO", "CHEQUE_ESPECIAL"]),
  originalAmount: z.number().positive(),
  remainingAmount: z.number().positive(),
  interestRateMonthly: z.number().nonnegative(),
  installmentsTotal: z.number().int().positive(),
  installmentsPaid: z.number().int().nonnegative().default(0),
  dueDay: z.number().int().min(1).max(31),
  installmentAmount: z.number().positive(), // usado para gerar as parcelas pendentes abaixo
});

personalPlanningRouter.post("/personal/debts", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireFinancialWrite(req, res))) return;
  const parsed = createDebtSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const { tenantId } = req.session!;
  const { installmentAmount, ...debtInput } = parsed.data;

  const debt = await prisma.$transaction(async (tx) => {
    const created = await tx.personalDebt.create({ data: { tenantId, ...debtInput } });
    const today = new Date();
    const pendingCount = debtInput.installmentsTotal - debtInput.installmentsPaid;
    await tx.personalDebtInstallment.createMany({
      data: Array.from({ length: pendingCount }, (_, i) => {
        const installmentNumber = debtInput.installmentsPaid + i + 1;
        const dueDate = new Date(today.getFullYear(), today.getMonth() + i, debtInput.dueDay);
        return { debtId: created.id, installmentNumber, dueDate, amount: installmentAmount };
      }),
    });
    return created;
  });

  return res.status(201).json({ success: true, data: debt, error: null });
});

personalPlanningRouter.post("/personal/debts/:debtId/installments/:installmentId/pay", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireFinancialWrite(req, res))) return;
  const { tenantId } = req.session!;
  const debt = await prisma.personalDebt.findFirst({ where: { id: req.params.debtId, tenantId } });
  if (!debt) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Dívida não encontrada." } });
  }
  const installment = await prisma.personalDebtInstallment.findFirst({ where: { id: req.params.installmentId, debtId: debt.id } });
  if (!installment) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Parcela não encontrada." } });
  }
  if (installment.status === "PAID") {
    return res.status(409).json({ success: false, data: null, error: { code: "INSTALLMENT_ALREADY_PAID", message: "Esta parcela já foi paga." } });
  }
  const result = await prisma.$transaction(async (tx) => {
    const claimed = await tx.personalDebtInstallment.updateMany({ where: { id: installment.id, status: { not: "PAID" } }, data: { status: "PAID", paidAt: new Date() } });
    if (claimed.count !== 1) throw new Error("INSTALLMENT_ALREADY_PAID");
    const updatedInstallment = await tx.personalDebtInstallment.findUniqueOrThrow({ where: { id: installment.id } });
    const remainingAfter = Prisma.Decimal.max(new Prisma.Decimal(0), debt.remainingAmount.minus(installment.amount));
    const updatedDebt = await tx.personalDebt.update({
      where: { id: debt.id },
      data: {
        installmentsPaid: { increment: 1 },
        remainingAmount: remainingAfter,
        status: remainingAfter.isZero() ? "PAID_OFF" : "ACTIVE",
      },
    });
    return { installment: updatedInstallment, debt: updatedDebt };
  });
  return res.json({ success: true, data: result, error: null });
});

const debtPayoffInputSchema = z.object({
  extraMonthlyBudget: z.number().nonnegative(),
  strategy: z.enum(["AVALANCHE", "SNOWBALL"]),
});

interface SimDebt { id: string; name: string; remainingAmount: Prisma.Decimal; interestRateMonthly: Prisma.Decimal; minimumInstallment: Prisma.Decimal }
interface PayoffPlanMonth { month: number; allocations: { debtId: string; paid: Prisma.Decimal; remainingAfter: Prisma.Decimal }[] }

// Calculadora Snowball vs. Avalanche (Capítulo 22.7) — simulação pura, nunca
// persistida: o usuário só grava um pagamento real como PersonalTransaction.
function calculateDebtPayoffPlan(debts: SimDebt[], extraMonthlyBudget: Prisma.Decimal, strategy: "AVALANCHE" | "SNOWBALL"): PayoffPlanMonth[] {
  const sorted = [...debts].sort((a, b) =>
    strategy === "AVALANCHE" ? b.interestRateMonthly.comparedTo(a.interestRateMonthly) : a.remainingAmount.comparedTo(b.remainingAmount),
  );
  const working = sorted.map((d) => ({ ...d }));
  const plan: PayoffPlanMonth[] = [];
  let month = 0;
  const MAX_MONTHS = 600; // trava de segurança — 50 anos

  while (working.some((d) => d.remainingAmount.greaterThan(0)) && month < MAX_MONTHS) {
    month++;
    let freeBudget = extraMonthlyBudget;
    const allocations: PayoffPlanMonth["allocations"] = [];

    for (const debt of working) {
      if (debt.remainingAmount.lessThanOrEqualTo(0)) continue;
      const interest = debt.remainingAmount.mul(debt.interestRateMonthly).div(100);
      debt.remainingAmount = debt.remainingAmount.plus(interest);
      const minPayment = Prisma.Decimal.min(debt.minimumInstallment, debt.remainingAmount);
      debt.remainingAmount = debt.remainingAmount.minus(minPayment);
      allocations.push({ debtId: debt.id, paid: minPayment, remainingAfter: debt.remainingAmount });
    }

    for (const debt of working) {
      if (debt.remainingAmount.lessThanOrEqualTo(0) || freeBudget.lessThanOrEqualTo(0)) continue;
      const extraPayment = Prisma.Decimal.min(freeBudget, debt.remainingAmount);
      debt.remainingAmount = debt.remainingAmount.minus(extraPayment);
      freeBudget = freeBudget.minus(extraPayment);
      const existing = allocations.find((a) => a.debtId === debt.id)!;
      existing.paid = existing.paid.plus(extraPayment);
      existing.remainingAfter = debt.remainingAmount;
      break; // apenas a dívida de maior prioridade ativa recebe o excedente neste mês
    }

    plan.push({ month, allocations });
    if (working.every((d) => d.remainingAmount.lessThanOrEqualTo(0))) break;
  }

  return plan;
}

personalPlanningRouter.post("/personal/debts/payoff-simulation", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireFinancialRead(req, res))) return;
  const parsed = debtPayoffInputSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const { tenantId } = req.session!;
  const debts = await prisma.personalDebt.findMany({ where: { tenantId, status: "ACTIVE" }, include: { installments: { where: { status: "PENDING" }, orderBy: { installmentNumber: "asc" }, take: 1 } } });
  if (debts.length === 0) {
    return res.json({ success: true, data: { plan: [], monthsToPayoff: 0 }, error: null });
  }
  const simInput: SimDebt[] = debts.map((d) => ({
    id: d.id,
    name: d.name,
    remainingAmount: d.remainingAmount,
    interestRateMonthly: d.interestRateMonthly,
    minimumInstallment: d.installments[0]?.amount ?? d.remainingAmount.div(Math.max(1, d.installmentsTotal - d.installmentsPaid)),
  }));
  const plan = calculateDebtPayoffPlan(simInput, new Prisma.Decimal(parsed.data.extraMonthlyBudget), parsed.data.strategy);
  return res.json({ success: true, data: { plan, monthsToPayoff: plan.length }, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// CONTAS RECORRENTES (BILLS)
// ─────────────────────────────────────────────────────────────────────────

personalPlanningRouter.get("/personal/bills", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireFinancialRead(req, res))) return;
  const { tenantId } = req.session!;
  const bills = await prisma.personalBill.findMany({ where: { tenantId }, orderBy: { dueDay: "asc" }, take: 500 });
  return res.json({ success: true, data: bills, error: null });
});

const createBillSchema = z.object({
  name: z.string().min(1),
  categoryId: z.string().optional(),
  autoDebitAccountId: z.string().optional(),
  amount: z.number().positive(),
  dueDay: z.number().int().min(1).max(31),
  isRecurring: z.boolean().default(true),
  reminderDaysBefore: z.number().int().min(0).default(3),
});

personalPlanningRouter.post("/personal/bills", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireFinancialWrite(req, res))) return;
  const parsed = createBillSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const { tenantId } = req.session!;
  if (!(await ownsAccountAndCategory(tenantId, [parsed.data.autoDebitAccountId], [parsed.data.categoryId]))) return foreignReference(res);
  const bill = await prisma.personalBill.create({ data: { tenantId, ...parsed.data } });
  return res.status(201).json({ success: true, data: bill, error: null });
});

// Registra o pagamento real: marca a bill como PAID e opcionalmente gera a
// PersonalTransaction de débito na conta de pagamento automático configurada.
personalPlanningRouter.post("/personal/bills/:id/pay", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireFinancialWrite(req, res))) return;
  const { tenantId, userId } = req.session!;
  const bill = await prisma.personalBill.findFirst({ where: { id: req.params.id, tenantId } });
  if (!bill) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Conta não encontrada." } });
  }
  const payBody = z.object({ amount: z.number().positive().optional() }).safeParse(req.body ?? {});
  if (!payBody.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: payBody.error.message } });
  }
  if (bill.status === "PAID") {
    return res.status(409).json({ success: false, data: null, error: { code: "ALREADY_PAID", message: "Esta conta já foi paga." } });
  }
  const paidAmount = payBody.data.amount ?? bill.amount.toNumber();

  // CORREÇÃO DE AUDITORIA: a rota aceitava um `amount` arbitrário sem relação ao
  // valor real da conta — como o schema não modela pagamento parcial (não há campo
  // de saldo remanescente; a conta vira PAID por inteiro independentemente do
  // valor informado), o valor pago precisa ser exatamente o valor da conta (com
  // tolerância de 1 centavo para erro de arredondamento de ponto flutuante do
  // client). Pagamento parcial real exigiria um model novo (fora do escopo desta
  // correção), então aqui a validação é de igualdade, nunca de "menor ou igual".
  const amountDifference = new Prisma.Decimal(paidAmount).minus(bill.amount).abs();
  if (amountDifference.greaterThan(0.01)) {
    return res.status(400).json({
      success: false,
      data: null,
      error: {
        code: "AMOUNT_MISMATCH",
        message: `O valor pago (${paidAmount}) deve ser igual ao valor da conta (${bill.amount.toString()}). Pagamento parcial não é suportado.`,
      },
    });
  }

  const result = await prisma.$transaction(async (tx) => {
    const claimed = await tx.personalBill.updateMany({ where: { id: bill.id, tenantId, status: { not: "PAID" } }, data: { status: "PAID", lastPaidAt: new Date() } });
    if (claimed.count === 0) return null;
    const updatedBill = await tx.personalBill.findFirstOrThrow({ where: { id: bill.id, tenantId } });
    let transaction = null;
    if (bill.autoDebitAccountId) {
      transaction = await tx.personalTransaction.create({
        data: {
          tenantId, accountId: bill.autoDebitAccountId, categoryId: bill.categoryId, createdByUserId: userId,
          type: "EXPENSE", amount: paidAmount, transactionDate: new Date(), description: `Pagamento: ${bill.name}`,
        },
      });
      // CORREÇÃO DE AUDITORIA (FK/tenant isolation): faltava o filtro `tenantId` neste
      // update — mesmo com `autoDebitAccountId` já validado contra o tenant na criação
      // da bill (ownsAccountAndCategory), o update direto por `id` sem o filtro é uma
      // defesa em profundidade ausente (mesmo padrão já exigido em todo o resto do
      // backend: nenhuma escrita por `id` sem `tenantId` no WHERE).
      await tx.personalAccount.updateMany({ where: { id: bill.autoDebitAccountId, tenantId }, data: { currentBalance: { decrement: paidAmount } } });
    }
    return { bill: updatedBill, transaction };
  });

  if (!result) {
    return res.status(409).json({ success: false, data: null, error: { code: "ALREADY_PAID", message: "Esta conta já foi paga." } });
  }
  return res.json({ success: true, data: result, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// PATRIMÔNIO LÍQUIDO (NET WORTH) — leitura + recálculo manual sob demanda
// (o job mensal automático via BullMQ, Capítulo 22.6, fica pendente nesta
// correção de auditoria — mesmo padrão dos demais workers ainda não acoplados)
// ─────────────────────────────────────────────────────────────────────────

personalPlanningRouter.get("/personal/net-worth-snapshots", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireFinancialRead(req, res))) return;
  const { tenantId } = req.session!;
  // GAP DE AUDITORIA FECHADO (mega-audit rodada 9): snapshots acumulam um
  // registro por dia indefinidamente — sem teto, a consulta cresceria sem limite
  // ao longo dos anos. Cap defensivo nos últimos 1000 dias (~2.7 anos).
  const MAX_SNAPSHOTS = 1000;
  const recentSnapshots = await prisma.netWorthSnapshot.findMany({
    where: { tenantId },
    orderBy: { snapshotDate: "desc" },
    take: MAX_SNAPSHOTS,
  });
  const snapshots = recentSnapshots.slice().reverse();
  return res.json({ success: true, data: snapshots, error: null });
});

personalPlanningRouter.post("/personal/net-worth-snapshots/recompute", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireFinancialWrite(req, res))) return;
  const { tenantId } = req.session!;
  const [accounts, investments, debts] = await Promise.all([
    prisma.personalAccount.findMany({ where: { tenantId, archivedAt: null } }),
    prisma.personalInvestment.findMany({ where: { tenantId } }),
    prisma.personalDebt.findMany({ where: { tenantId, status: "ACTIVE" } }),
  ]);

  const liquidAssets = accounts.filter((a) => a.type !== "CREDIT_CARD").reduce((sum, a) => sum.plus(a.currentBalance), new Prisma.Decimal(0));
  const creditCardLiabilities = accounts.filter((a) => a.type === "CREDIT_CARD").reduce((sum, a) => sum.plus(a.currentBalance.isNegative() ? a.currentBalance.abs() : new Prisma.Decimal(0)), new Prisma.Decimal(0));
  const investmentAssets = investments.reduce((sum, i) => sum.plus(i.quantity.mul(i.currentPrice)), new Prisma.Decimal(0));
  const debtLiabilities = debts.reduce((sum, d) => sum.plus(d.remainingAmount), new Prisma.Decimal(0));

  const totalAssets = liquidAssets.plus(investmentAssets);
  const totalLiabilities = creditCardLiabilities.plus(debtLiabilities);
  const snapshotDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  const snapshot = await prisma.netWorthSnapshot.upsert({
    where: { tenantId_snapshotDate: { tenantId, snapshotDate } },
    create: { tenantId, snapshotDate, totalAssets, totalLiabilities, netWorth: totalAssets.minus(totalLiabilities) },
    update: { totalAssets, totalLiabilities, netWorth: totalAssets.minus(totalLiabilities) },
  });

  return res.json({ success: true, data: snapshot, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// OPEN FINANCE — gestão de consentimentos (Capítulo 22.5). A sincronização
// automática real via Pluggy (webhook `item/updated` + worker dedicado) foi
// implementada nesta rodada em `pluggy-webhook.routes.ts`/`pluggy-sync.worker.ts`;
// aqui seguem o ciclo de vida do consentimento e o gatilho manual "sincronizar agora".
// ─────────────────────────────────────────────────────────────────────────

personalPlanningRouter.get("/personal/open-finance-consents", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireFinancialRead(req, res))) return;
  const { tenantId } = req.session!;
  const consents = await prisma.openFinanceConsent.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 500 });
  return res.json({ success: true, data: consents, error: null });
});

const createConsentSchema = z.object({
  itemId: z.string().min(1),
  institutionName: z.string().min(1),
  consentExpiresAt: z.coerce.date(),
});

// Cria o registro de consentimento após o widget do agregador (Pluggy) concluir
// o fluxo de login do usuário — o Filitech nunca recebe nem persiste credenciais
// bancárias (Capítulo 22.5, comentário do model `OpenFinanceConsent`).
personalPlanningRouter.post("/personal/open-finance-consents", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireFinancialWrite(req, res))) return;
  const parsed = createConsentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const { tenantId } = req.session!;
  const consent = await prisma.openFinanceConsent.create({ data: { tenantId, ...parsed.data } });
  return res.status(201).json({ success: true, data: consent, error: null });
});

personalPlanningRouter.delete("/personal/open-finance-consents/:id", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireFinancialWrite(req, res))) return;
  const { tenantId } = req.session!;
  const consent = await prisma.openFinanceConsent.findFirst({ where: { id: req.params.id, tenantId } });
  if (!consent) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Consentimento não encontrado." } });
  }
  await prisma.openFinanceConsent.delete({ where: { id: consent.id } });
  return res.json({ success: true, data: { id: consent.id }, error: null });
});

// Gatilho manual de sincronização (Capítulo 22.5) — mesma fila/worker usados pelo
// webhook `item/updated` da Pluggy, para o usuário não ficar 100% dependente de um
// webhook (ex.: forçar um refresh logo após conectar a conta pela primeira vez).
personalPlanningRouter.post("/personal/open-finance-consents/:id/sync-now", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireFinancialWrite(req, res))) return;
  const { tenantId } = req.session!;
  const consent = await prisma.openFinanceConsent.findFirst({ where: { id: req.params.id, tenantId } });
  if (!consent) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Consentimento não encontrado." } });
  }
  await pluggySyncQueue.add("sync-open-finance-item", { itemId: consent.itemId, consentId: consent.id }, { attempts: 5, backoff: { type: "exponential", delay: 10_000 } });
  return res.status(202).json({ success: true, data: { enqueued: true }, error: null });
});

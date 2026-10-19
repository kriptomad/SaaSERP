// apps/api/src/modules/personal-finance/personal-accounts.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 22.2/22.3 (Filitech Pessoal — Contas,
// Categorias, Transações, Splits e Transferências).
// GAP DE AUDITORIA ENCONTRADO E CORRIGIDO: os 14 models do produto B2C
// "Filitech Pessoal" (`PersonalAccount`, `PersonalCategory`,
// `PersonalTransaction`, `PersonalTransactionSplit`, etc.) existiam no schema
// desde a redação do Capítulo 22, com pseudocódigo detalhado de serviço, mas
// NENHUMA pasta de módulo e NENHUMA rota REST jamais existiram — o produto
// inteiro pedido explicitamente pelo usuário ("ERP caseiro para controle de
// gastos de casa") não tinha nenhuma superfície de API.
// Reaproveita a permissão já seedada "financial:*:read"/"financial:*:write"
// (concedida a OWNER, MANAGER e HOUSEHOLD_MEMBER — Capítulo 22.1 do seed.ts).
import { Router, Request, Response } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";
import { isTenantStorageKey } from "../../lib/storage-key";

export const personalAccountsRouter = Router();

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

// Capítulo 22.3 — reforçado na camada de dados (nunca apenas escondido na UI):
// uma transação marcada `isPrivate` só é visível para quem a criou, mesmo que
// outro usuário pertença ao mesmo tenant/residência.
export function applyPrivacyFilter(baseWhere: Prisma.PersonalTransactionWhereInput, requestingUserId: string): Prisma.PersonalTransactionWhereInput {
  return { AND: [baseWhere, { OR: [{ isPrivate: false }, { isPrivate: true, createdByUserId: requestingUserId }] }] };
}

// Valida que todos os ids referenciados pelo body pertencem ao tenant da sessão (anti FK-injection).
async function ownedIds(model: "personalAccount" | "personalCategory" | "user", ids: (string | undefined)[], tenantId: string): Promise<boolean> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return true;
  const count = await (prisma[model] as any).count({ where: { id: { in: unique }, tenantId } });
  return count === unique.length;
}

function foreignReference(res: Response) {
  return res.status(404).json({ success: false, data: null, error: { code: "REFERENCE_NOT_FOUND", message: "Conta, categoria ou usuário informado não existe neste tenant." } });
}

// ─────────────────────────────────────────────────────────────────────────
// CONTAS
// ─────────────────────────────────────────────────────────────────────────

personalAccountsRouter.get("/personal/accounts", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireFinancialRead(req, res))) return;
  const { tenantId } = req.session!;
  const includeArchived = req.query.includeArchived === "true";
  const accounts = await prisma.personalAccount.findMany({
    where: { tenantId, ...(includeArchived ? {} : { archivedAt: null }) },
    orderBy: { createdAt: "asc" },
    take: 500,
  });
  return res.json({ success: true, data: accounts, error: null });
});

const createAccountSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["CHECKING", "SAVINGS", "WALLET_CASH", "CREDIT_CARD", "INVESTMENT_BROKERAGE"]),
  institutionName: z.string().optional(),
  currentBalance: z.number().default(0),
  creditLimit: z.number().optional(),
  invoiceClosingDay: z.number().int().min(1).max(31).optional(),
  invoiceDueDay: z.number().int().min(1).max(31).optional(),
  isShared: z.boolean().default(true),
  ownerId: z.string().optional(),
});

personalAccountsRouter.post("/personal/accounts", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireFinancialWrite(req, res))) return;
  const parsed = createAccountSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const { tenantId } = req.session!;
  if (parsed.data.type === "CREDIT_CARD" && (!parsed.data.creditLimit || !parsed.data.invoiceClosingDay || !parsed.data.invoiceDueDay)) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: "Contas do tipo CREDIT_CARD exigem creditLimit, invoiceClosingDay e invoiceDueDay." } });
  }
  if (!(await ownedIds("user", [parsed.data.ownerId], tenantId))) return foreignReference(res);
  const account = await prisma.personalAccount.create({ data: { tenantId, ...parsed.data } });
  return res.status(201).json({ success: true, data: account, error: null });
});

const patchAccountSchema = createAccountSchema.partial().extend({ archived: z.boolean().optional() });

personalAccountsRouter.patch("/personal/accounts/:id", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireFinancialWrite(req, res))) return;
  const parsed = patchAccountSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const { tenantId } = req.session!;
  const account = await prisma.personalAccount.findFirst({ where: { id: req.params.id, tenantId } });
  if (!account) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Conta não encontrada." } });
  }
  const { archived, ...rest } = parsed.data;
  if (!(await ownedIds("user", [rest.ownerId], tenantId))) return foreignReference(res);
  const updated = await prisma.personalAccount.update({
    where: { id: account.id },
    data: { ...rest, ...(archived !== undefined ? { archivedAt: archived ? new Date() : null } : {}) },
  });
  return res.json({ success: true, data: updated, error: null });
});

// Reconciliação auditável — recalcula o saldo do zero a partir do histórico
// completo de transações (nunca confiando apenas no `currentBalance` cacheado),
// útil quando o usuário suspeita de divergência. Ver Capítulo 22.2, nota de
// performance: o caminho quente continua lendo o saldo em cache.
personalAccountsRouter.post("/personal/accounts/:id/reconcile", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireFinancialWrite(req, res))) return;
  const { tenantId, userId } = req.session!;
  const account = await prisma.personalAccount.findFirst({ where: { id: req.params.id, tenantId } });
  if (!account) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Conta não encontrada." } });
  }
  // Capítulo 22.3 — a reconciliação não pode somar transações privadas de outro
  // usuário em conta compartilhada: vazaria o valor (ainda que não a descrição)
  // dessas transações para quem reconcilia, via diferença entre saldo anterior e novo.
  const transactions = await prisma.personalTransaction.findMany({
    where: applyPrivacyFilter({ accountId: account.id, tenantId }, userId),
    select: { type: true, amount: true, description: true },
  });
  const recalculated = transactions.reduce((balance, t) => {
    if (t.type === "INCOME") return balance.plus(t.amount);
    if (t.type === "EXPENSE") return balance.minus(t.amount);
    // TRANSFER não persiste sinal: a direção vem do prefixo gravado na criação (mesma convenção do DELETE).
    return t.description.startsWith("Transferência enviada") ? balance.minus(t.amount) : balance.plus(t.amount);
  }, new Prisma.Decimal(0));
  const updated = await prisma.personalAccount.update({ where: { id: account.id }, data: { currentBalance: recalculated } });
  return res.json({ success: true, data: { account: updated, previousCachedBalance: account.currentBalance, recalculatedBalance: recalculated }, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// CATEGORIAS
// ─────────────────────────────────────────────────────────────────────────

personalAccountsRouter.get("/personal/categories", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireFinancialRead(req, res))) return;
  const { tenantId } = req.session!;
  const categories = await prisma.personalCategory.findMany({ where: { tenantId, active: true }, orderBy: { name: "asc" }, take: 500 });
  return res.json({ success: true, data: categories, error: null });
});

const createCategorySchema = z.object({
  name: z.string().min(1),
  type: z.enum(["INCOME", "EXPENSE"]),
  parentCategoryId: z.string().optional(),
  icon: z.string().optional(),
  isCarneLeaoIncome: z.boolean().default(false),
});

personalAccountsRouter.post("/personal/categories", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireFinancialWrite(req, res))) return;
  const parsed = createCategorySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const { tenantId } = req.session!;
  if (!(await ownedIds("personalCategory", [parsed.data.parentCategoryId], tenantId))) return foreignReference(res);
  const category = await prisma.personalCategory.create({ data: { tenantId, ...parsed.data } });
  return res.status(201).json({ success: true, data: category, error: null });
});

personalAccountsRouter.patch("/personal/categories/:id", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireFinancialWrite(req, res))) return;
  const parsed = createCategorySchema.partial().extend({ active: z.boolean().optional() }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const { tenantId } = req.session!;
  const category = await prisma.personalCategory.findFirst({ where: { id: req.params.id, tenantId } });
  if (!category) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Categoria não encontrada." } });
  }
  if (category.isSystemDefault) {
    // Categorias padrão do onboarding (Capítulo 22.2) não podem ser excluídas nem
    // renomeadas/reclassificadas — apenas desativadas via o campo `active`.
    const { active, ...structuralChanges } = parsed.data;
    if (Object.keys(structuralChanges).length > 0) {
      return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: "Categorias padrão do sistema só podem ter o campo 'active' alterado." } });
    }
  }
  if (!(await ownedIds("personalCategory", [parsed.data.parentCategoryId], tenantId)) || parsed.data.parentCategoryId === category.id) return foreignReference(res);
  const updated = await prisma.personalCategory.update({ where: { id: category.id }, data: parsed.data });
  return res.json({ success: true, data: updated, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// TRANSAÇÕES (lançamentos simples, splits e transferências)
// ─────────────────────────────────────────────────────────────────────────

personalAccountsRouter.get("/personal/transactions", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireFinancialRead(req, res))) return;
  const { tenantId, userId } = req.session!;
  const { accountId, categoryId, from, to } = req.query as Record<string, string | undefined>;
  const baseWhere: Prisma.PersonalTransactionWhereInput = {
    tenantId,
    ...(accountId ? { accountId } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(from || to ? { transactionDate: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}),
  };
  const transactions = await prisma.personalTransaction.findMany({
    where: applyPrivacyFilter(baseWhere, userId),
    include: { splits: true, category: true },
    orderBy: { transactionDate: "desc" },
    take: 500,
  });
  return res.json({ success: true, data: transactions, error: null });
});

const splitInputSchema = z.object({ userId: z.string(), percentage: z.number().positive() });

const createTransactionSchema = z.object({
  accountId: z.string(),
  categoryId: z.string().optional(),
  description: z.string().min(1),
  merchantName: z.string().optional(),
  type: z.enum(["INCOME", "EXPENSE"]), // TRANSFER tem endpoint dedicado abaixo — nunca criado diretamente aqui
  amount: z.number().positive(),
  transactionDate: z.coerce.date(),
  isPrivate: z.boolean().default(false),
  attachmentStorageKey: z.string().optional(),
  splits: z.array(splitInputSchema).optional(),
});

personalAccountsRouter.post("/personal/transactions", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireFinancialWrite(req, res))) return;
  const parsed = createTransactionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const { tenantId, userId } = req.session!;
  const { splits, ...input } = parsed.data;
  const amount = new Prisma.Decimal(input.amount);

  if (splits && splits.length > 0 && input.type !== "EXPENSE") {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: "Divisão (splits) só é permitida em transações do tipo EXPENSE (Capítulo 22.3)." } });
  }

  if (splits && splits.length > 0) {
    // Capítulo 22.3 — a soma dos percentuais deve ser exatamente 100%, validado em
    // código (nunca no banco, Postgres não suporta CHECK entre tabelas sem trigger).
    const totalPercentage = splits.reduce((sum, s) => sum.plus(s.percentage), new Prisma.Decimal(0));
    if (!totalPercentage.equals(100)) {
      return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: `A soma dos percentuais de divisão deve ser exatamente 100%. Recebido: ${totalPercentage.toString()}%.` } });
    }
  }

  if (input.attachmentStorageKey && !isTenantStorageKey(input.attachmentStorageKey, tenantId)) {
    return res.status(400).json({ success: false, data: null, error: { code: "INVALID_STORAGE_KEY", message: "attachmentStorageKey deve pertencer ao prefixo do seu tenant." } });
  }

  if (!(await ownedIds("personalAccount", [input.accountId], tenantId))
    || !(await ownedIds("personalCategory", [input.categoryId], tenantId))
    || !(await ownedIds("user", (splits ?? []).map((s) => s.userId), tenantId))) {
    return foreignReference(res);
  }

  // CORREÇÃO DE AUDITORIA: nada impedia uma transação INCOME usar uma categoria
  // EXPENSE (e vice-versa) — ex.: um gasto de "Supermercado" (categoria EXPENSE)
  // lançado como receita, inflando indevidamente o total de ganhos do mês.
  if (input.categoryId) {
    const category = await prisma.personalCategory.findFirst({ where: { id: input.categoryId, tenantId }, select: { type: true } });
    if (!category || category.type !== input.type) {
      return res.status(400).json({
        success: false,
        data: null,
        error: { code: "CATEGORY_TYPE_MISMATCH", message: "O tipo da categoria selecionada não é compatível com o tipo da transação (INCOME/EXPENSE)." },
      });
    }
  }

  const transaction = await prisma.$transaction(async (tx) => {
    const created = await tx.personalTransaction.create({
      data: { tenantId, createdByUserId: userId, ...input, amount },
    });
    if (splits && splits.length > 0) {
      await tx.personalTransactionSplit.createMany({
        data: splits.map((s) => ({
          transactionId: created.id,
          userId: s.userId,
          percentage: s.percentage,
          amount: amount.mul(s.percentage).div(100).toDecimalPlaces(2),
        })),
      });
    }
    await tx.personalAccount.update({
      where: { id: input.accountId },
      data: input.type === "INCOME" ? { currentBalance: { increment: amount } } : { currentBalance: { decrement: amount } },
    });
    return created;
  });

  return res.status(201).json({ success: true, data: transaction, error: null });
});

const createTransferSchema = z.object({
  fromAccountId: z.string(),
  toAccountId: z.string(),
  amount: z.number().positive(),
  description: z.string().min(1),
});

// Capítulo 22.2 — uma TRANSFER nunca é um lançamento isolado: é sempre o par
// EXPENSE (origem) + INCOME (destino), criado atomicamente, sem alterar o
// patrimônio líquido total da residência.
personalAccountsRouter.post("/personal/transactions/transfer", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireFinancialWrite(req, res))) return;
  const parsed = createTransferSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  if (parsed.data.fromAccountId === parsed.data.toAccountId) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: "Conta de origem e destino não podem ser a mesma." } });
  }
  const { tenantId, userId } = req.session!;
  const amount = new Prisma.Decimal(parsed.data.amount);
  const transactionDate = new Date();

  if (!(await ownedIds("personalAccount", [parsed.data.fromAccountId, parsed.data.toAccountId], tenantId))) return foreignReference(res);

  const result = await prisma.$transaction(async (tx) => {
    const outgoing = await tx.personalTransaction.create({
      data: { tenantId, accountId: parsed.data.fromAccountId, createdByUserId: userId, type: "TRANSFER", amount, transactionDate, description: `Transferência enviada: ${parsed.data.description}` },
    });
    const incoming = await tx.personalTransaction.create({
      data: { tenantId, accountId: parsed.data.toAccountId, createdByUserId: userId, type: "TRANSFER", amount, transactionDate, description: `Transferência recebida: ${parsed.data.description}` },
    });
    await tx.personalAccount.update({ where: { id: parsed.data.fromAccountId }, data: { currentBalance: { decrement: amount } } });
    await tx.personalAccount.update({ where: { id: parsed.data.toAccountId }, data: { currentBalance: { increment: amount } } });
    return { outgoing, incoming };
  });

  return res.status(201).json({ success: true, data: result, error: null });
});

personalAccountsRouter.delete("/personal/transactions/:id", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireFinancialWrite(req, res))) return;
  const { tenantId, userId } = req.session!;
  const transaction = await prisma.personalTransaction.findFirst({ where: applyPrivacyFilter({ id: req.params.id, tenantId }, userId) });
  if (!transaction) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Transação não encontrada." } });
  }
  await prisma.$transaction(async (tx) => {
    await tx.personalTransaction.delete({ where: { id: transaction.id } });
    if (transaction.type === "INCOME") {
      await tx.personalAccount.update({ where: { id: transaction.accountId }, data: { currentBalance: { decrement: transaction.amount } } });
    } else if (transaction.type === "EXPENSE") {
      await tx.personalAccount.update({ where: { id: transaction.accountId }, data: { currentBalance: { increment: transaction.amount } } });
    } else {
      // TRANSFER: cada perna é um registro independente (ver createTransfer) sem
      // sinal persistido — a direção original é inferida pelo prefixo da descrição
      // gravado na criação ("enviada" decrementou o saldo; "recebida" incrementou),
      // para que excluir apenas uma perna reverta exatamente o efeito que ela causou.
      const wasOutgoing = transaction.description.startsWith("Transferência enviada");
      await tx.personalAccount.update({
        where: { id: transaction.accountId },
        data: wasOutgoing ? { currentBalance: { increment: transaction.amount } } : { currentBalance: { decrement: transaction.amount } },
      });
    }
  });
  return res.json({ success: true, data: { id: transaction.id }, error: null });
});

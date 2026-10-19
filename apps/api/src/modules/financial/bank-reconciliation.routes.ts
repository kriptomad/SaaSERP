// apps/api/src/modules/financial/bank-reconciliation.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 17.4 (Conciliação Bancária — importação
// de extrato OFX + Open Finance, Capítulo 17.4.1).
// GAP DE AUDITORIA ENCONTRADO E CORRIGIDO: `BankAccount`/`BankTransaction` existem
// no schema (com os campos de vínculo Open Finance adicionados em 17.4.1) desde o
// início deste capítulo, mas nenhuma rota de importação/conciliação jamais existiu.
// Esta implementação cobre o Caminho B (importação manual de arquivo OFX, sem
// depender de nenhuma API externa) E o Caminho A (sincronização automática via
// Open Finance/Pluggy): o worker real (`workers/pluggy-sync.worker.ts`) e o
// webhook (`pluggy-webhook.routes.ts`) foram implementados nesta rodada — aqui só
// resta a rota de gatilho manual "sincronizar agora" (`/bank-accounts/:id/sync-now`).
// Reaproveita o parser dedicado `apps/api/src/lib/ofx-parser.ts` em vez de inventar
// parsing inline, e as permissões já seedadas `financial:*:read`/`financial:*:write`
// (mesmo domínio financeiro do Capítulo 17, sem código RBAC novo).
import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma, Prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";
import { parseOfxTransactions, InvalidOfxContentError } from "../../lib/ofx-parser";
import { pluggySyncQueue } from "../../lib/queue";
import { readEnumQuery } from "../../lib/query-enum";

export const bankReconciliationRouter = Router();

async function hasPermission(role: string, userId: string, permissionCode: string): Promise<boolean> {
  const [defaultGrant, override] = await Promise.all([
    prisma.roleDefaultPermission.findUnique({ where: { role_permissionCode: { role: role as any, permissionCode } } }),
    prisma.rolePermission.findUnique({ where: { userId_permission: { userId, permission: permissionCode } } }),
  ]);
  return override ? override.granted : Boolean(defaultGrant);
}

async function requireRead(req: Request, res: Response): Promise<boolean> {
  const { userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "financial:*:read"))) {
    res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite consultar dados financeiros." } });
    return false;
  }
  return true;
}

async function requireWrite(req: Request, res: Response): Promise<boolean> {
  const { userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "financial:*:write"))) {
    res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite lançar dados financeiros." } });
    return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────
// CONTAS BANCÁRIAS
// ─────────────────────────────────────────────────────────────────────────

bankReconciliationRouter.get("/bank-accounts", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireRead(req, res))) return;
  const { tenantId } = req.session!;
  const accounts = await prisma.bankAccount.findMany({ where: { tenantId }, orderBy: { bankName: "asc" } });
  return res.json({ success: true, data: accounts, error: null });
});

const createBankAccountSchema = z.object({
  bankName: z.string().min(1),
  agencyNumber: z.string().min(1),
  accountNumber: z.string().min(1),
});

// Cadastro manual — a conta vinculada via Open Finance (Caminho A) é criada pelo
// worker de sincronização (Capítulo 22.5/17.4.1), nunca por esta rota.
bankReconciliationRouter.post("/bank-accounts", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireWrite(req, res))) return;
  const parsed = createBankAccountSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const { tenantId } = req.session!;
  const account = await prisma.bankAccount.create({ data: { tenantId, ...parsed.data } });
  return res.status(201).json({ success: true, data: account, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// IMPORTAÇÃO OFX (Caminho B — sem dependência de API externa)
// ─────────────────────────────────────────────────────────────────────────

const importOfxSchema = z.object({ ofxContent: z.string().min(1) });

bankReconciliationRouter.post("/bank-accounts/:id/import-ofx", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireWrite(req, res))) return;
  const parsed = importOfxSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const { tenantId } = req.session!;
  const bankAccount = await prisma.bankAccount.findFirst({ where: { id: req.params.id, tenantId } });
  if (!bankAccount) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Conta bancária não encontrada." } });
  }

  let parsedTransactions;
  try {
    parsedTransactions = parseOfxTransactions(parsed.data.ofxContent);
  } catch (err) {
    if (err instanceof InvalidOfxContentError) {
      return res.status(400).json({ success: false, data: null, error: { code: "INVALID_OFX", message: err.message } });
    }
    throw err;
  }

  // Idempotente por design: `@@unique([tenantId, bankAccountId, externalFitId])`
  // garante que reimportar o mesmo extrato (ou um extrato com período sobreposto)
  // nunca duplica transação — usa `createMany({ skipDuplicates: true })`.
  const result = await prisma.bankTransaction.createMany({
    data: parsedTransactions.map((t) => ({
      tenantId,
      bankAccountId: bankAccount.id,
      externalFitId: t.fitId,
      description: t.description,
      amount: t.amount,
      transactionDate: t.postedAt,
    })),
    skipDuplicates: true,
  });

  return res.status(201).json({ success: true, data: { importedCount: result.count, totalInFile: parsedTransactions.length }, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// SINCRONIZAÇÃO OPEN FINANCE (Caminho A — Capítulo 17.4.1): gatilho manual, para o
// usuário não depender 100% do webhook `item/updated` da Pluggy (ex.: forçar um
// refresh logo após conectar o banco pela primeira vez). Mesma fila/worker
// (`pluggy-sync.worker.ts`) usados pelo webhook — nunca uma segunda implementação.
// ─────────────────────────────────────────────────────────────────────────

bankReconciliationRouter.post("/bank-accounts/:id/sync-now", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireWrite(req, res))) return;
  const { tenantId } = req.session!;
  const bankAccount = await prisma.bankAccount.findFirst({ where: { id: req.params.id, tenantId } });
  if (!bankAccount) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Conta bancária não encontrada." } });
  }
  if (!bankAccount.openFinanceConsentId) {
    return res.status(409).json({
      success: false,
      data: null,
      error: { code: "NOT_OPEN_FINANCE_LINKED", message: "Esta conta não está vinculada a um consentimento Open Finance — sincronização automática só se aplica a contas conectadas via Pluggy." },
    });
  }
  const consent = await prisma.openFinanceConsent.findFirst({ where: { id: bankAccount.openFinanceConsentId, tenantId } });
  if (!consent) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Consentimento Open Finance não encontrado." } });
  }
  await pluggySyncQueue.add("sync-open-finance-item", { itemId: consent.itemId, consentId: consent.id }, { attempts: 5, backoff: { type: "exponential", delay: 10_000 } });
  return res.status(202).json({ success: true, data: { enqueued: true }, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// TRANSAÇÕES E CONCILIAÇÃO
// ─────────────────────────────────────────────────────────────────────────

bankReconciliationRouter.get("/bank-transactions", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireRead(req, res))) return;
  const { tenantId } = req.session!;
  const { bankAccountId } = req.query as { bankAccountId?: string };
  const statusParsed = readEnumQuery(res, req.query.status, ["UNMATCHED", "SUGGESTED", "MATCHED", "IGNORED"] as const, "status");
  if (!statusParsed.ok) return;
  const transactions = await prisma.bankTransaction.findMany({
    where: {
      tenantId,
      ...(bankAccountId ? { bankAccountId } : {}),
      ...(statusParsed.value ? { reconciliationStatus: statusParsed.value } : {}),
    },
    orderBy: { transactionDate: "desc" },
    take: 500, // CORREÇÃO DE AUDITORIA: listagem antes era unbounded
  });
  return res.json({ success: true, data: transactions, error: null });
});

const TOLERANCE_DAYS = 5;
const TOLERANCE_CENTS = 1;

/**
 * Sugestão automática de conciliação: para cada transação UNMATCHED, procura um
 * AccountPayable (saída, amount < 0) ou AccountReceivable (entrada, amount > 0)
 * em aberto, do mesmo tenant, com valor igual (tolerância de 1 centavo, para
 * absorver arredondamento) e vencimento dentro de +/-5 dias da data do extrato —
 * nunca conciliação automática silenciosa: fica em status SUGGESTED, exige
 * confirmação explícita do usuário em `/confirm-match`.
 */
bankReconciliationRouter.post("/bank-transactions/suggest-matches", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireWrite(req, res))) return;
  const { tenantId } = req.session!;
  // CORREÇÃO DE AUDITORIA: listagem antes era unbounded (todas as transações
  // UNMATCHED do tenant de uma vez) e cada uma disparava 1 query extra de AP ou AR
  // dentro do loop sequencial (N+1 clássico). Agora a leitura de candidatos
  // (AccountPayable/AccountReceivable em aberto) é feita em lote, uma única vez,
  // e o casamento é todo em memória — nenhuma query de leitura extra por transação.
  const unmatched = await prisma.bankTransaction.findMany({ where: { tenantId, reconciliationStatus: "UNMATCHED" }, take: 500 });

  const [payableCandidates, receivableCandidates] = await Promise.all([
    prisma.accountPayable.findMany({ where: { tenantId, status: { in: ["PENDING", "OVERDUE"] } }, take: 2000 }),
    prisma.accountReceivable.findMany({ where: { tenantId, status: { in: ["PENDING", "OVERDUE"] } }, take: 2000 }),
  ]);

  // CORREÇÃO DE AUDITORIA: comparação de valores monetários usava `Number`/
  // `Math.abs`/`.toFixed(2)` (ponto flutuante, pode introduzir erro de
  // arredondamento em conciliação bancária) — agora tudo em Prisma.Decimal.
  const tolerance = new Prisma.Decimal(TOLERANCE_CENTS).dividedBy(100);
  const usedPayableIds = new Set<string>();
  const usedReceivableIds = new Set<string>();
  let suggestedCount = 0;
  const updates: Promise<unknown>[] = [];

  for (const tx of unmatched) {
    const windowStart = new Date(tx.transactionDate.getTime() - TOLERANCE_DAYS * 24 * 60 * 60 * 1000);
    const windowEnd = new Date(tx.transactionDate.getTime() + TOLERANCE_DAYS * 24 * 60 * 60 * 1000);
    const amount = new Prisma.Decimal(tx.amount);
    const absAmount = amount.abs();
    const minAmount = absAmount.minus(tolerance);
    const maxAmount = absAmount.plus(tolerance);

    if (amount.isNegative()) {
      const candidate = payableCandidates.find(
        (ap) =>
          !usedPayableIds.has(ap.id) &&
          ap.dueDate >= windowStart &&
          ap.dueDate <= windowEnd &&
          new Prisma.Decimal(ap.amount).gte(minAmount) &&
          new Prisma.Decimal(ap.amount).lte(maxAmount),
      );
      if (candidate) {
        usedPayableIds.add(candidate.id);
        updates.push(prisma.bankTransaction.update({ where: { id: tx.id }, data: { reconciliationStatus: "SUGGESTED", matchedAccountPayableId: candidate.id } }));
        suggestedCount += 1;
      }
    } else {
      const candidate = receivableCandidates.find(
        (ar) =>
          !usedReceivableIds.has(ar.id) &&
          ar.dueDate >= windowStart &&
          ar.dueDate <= windowEnd &&
          new Prisma.Decimal(ar.amount).gte(minAmount) &&
          new Prisma.Decimal(ar.amount).lte(maxAmount),
      );
      if (candidate) {
        usedReceivableIds.add(candidate.id);
        updates.push(prisma.bankTransaction.update({ where: { id: tx.id }, data: { reconciliationStatus: "SUGGESTED", matchedAccountReceivableId: candidate.id } }));
        suggestedCount += 1;
      }
    }
  }

  await Promise.all(updates);

  return res.json({ success: true, data: { evaluated: unmatched.length, suggested: suggestedCount }, error: null });
});

bankReconciliationRouter.post("/bank-transactions/:id/confirm-match", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireWrite(req, res))) return;
  const { tenantId } = req.session!;
  const tx = await prisma.bankTransaction.findFirst({ where: { id: req.params.id, tenantId } });
  if (!tx) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Transação bancária não encontrada." } });
  }
  if (tx.reconciliationStatus !== "SUGGESTED" || (!tx.matchedAccountPayableId && !tx.matchedAccountReceivableId)) {
    return res.status(409).json({ success: false, data: null, error: { code: "NO_SUGGESTION", message: "Esta transação não possui sugestão de conciliação pendente de confirmação." } });
  }
  const updated = await prisma.bankTransaction.update({ where: { id: tx.id }, data: { reconciliationStatus: "MATCHED" } });
  return res.json({ success: true, data: updated, error: null });
});

const manualMatchSchema = z
  .object({
    accountPayableId: z.string().uuid().optional(),
    accountReceivableId: z.string().uuid().optional(),
  })
  .refine((v) => Boolean(v.accountPayableId) !== Boolean(v.accountReceivableId), {
    message: "Informe exatamente um entre accountPayableId e accountReceivableId.",
  });

// Conciliação manual explícita, quando o usuário encontra o lançamento certo sem
// depender da sugestão automática (ex.: conciliando um extrato de meses atrás).
bankReconciliationRouter.post("/bank-transactions/:id/match", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireWrite(req, res))) return;
  const parsed = manualMatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const { tenantId } = req.session!;
  const tx = await prisma.bankTransaction.findFirst({ where: { id: req.params.id, tenantId } });
  if (!tx) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Transação bancária não encontrada." } });
  }

  if (parsed.data.accountPayableId) {
    const ap = await prisma.accountPayable.findFirst({ where: { id: parsed.data.accountPayableId, tenantId } });
    if (!ap) {
      return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Conta a pagar não encontrada." } });
    }
  } else {
    const ar = await prisma.accountReceivable.findFirst({ where: { id: parsed.data.accountReceivableId, tenantId } });
    if (!ar) {
      return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Conta a receber não encontrada." } });
    }
  }

  const updated = await prisma.bankTransaction.update({
    where: { id: tx.id },
    data: {
      reconciliationStatus: "MATCHED",
      matchedAccountPayableId: parsed.data.accountPayableId ?? null,
      matchedAccountReceivableId: parsed.data.accountReceivableId ?? null,
    },
  });
  return res.json({ success: true, data: updated, error: null });
});

bankReconciliationRouter.post("/bank-transactions/:id/ignore", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireWrite(req, res))) return;
  const { tenantId } = req.session!;
  const tx = await prisma.bankTransaction.findFirst({ where: { id: req.params.id, tenantId } });
  if (!tx) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Transação bancária não encontrada." } });
  }
  const updated = await prisma.bankTransaction.update({ where: { id: tx.id }, data: { reconciliationStatus: "IGNORED" } });
  return res.json({ success: true, data: updated, error: null });
});

// apps/api/src/modules/personal-finance/personal-tax-tools.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 22.8 (Motor de Fatura de Cartão de
// Crédito) e Capítulo 22.11 (Carnê-Leão / organização para o IRPF).
// GAP DE AUDITORIA (Rodada 4): os dois models/campos já existiam no schema
// (`PersonalAccount.invoiceClosingDay/invoiceDueDay/creditLimit`,
// `PersonalCategory.isCarneLeaoIncome`) e o pseudocódigo de serviço estava
// detalhado byte-a-byte no Bible, mas nenhuma rota real jamais existiu — só
// o lançamento manual de transações, sem o "limite disponível" do cartão nem
// a sugestão de apuração mensal do Carnê-Leão. Esta rota fecha ambos os gaps
// de forma síncrona/on-the-fly (mesmo padrão de `/net-worth-snapshots/recompute`
// e `/debts/payoff-simulation`), sem persistir nenhum novo model.
import { Router, Request, Response } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";
import { applyPrivacyFilter } from "./personal-accounts.routes";

export const personalTaxToolsRouter = Router();

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

// ─────────────────────────────────────────────────────────────────────────
// 22.8 — MOTOR DE FATURA DE CARTÃO DE CRÉDITO
// ─────────────────────────────────────────────────────────────────────────

/** Regra real do mercado brasileiro: uma compra feita NO DIA do fechamento ou
 * depois cai na fatura seguinte, nunca na que está fechando. Portado 1:1 do
 * pseudocódigo do Capítulo 22.8. */
export function resolveInvoiceCompetence(purchaseDate: Date, closingDay: number): { year: number; month: number } {
  const day = purchaseDate.getDate();
  let month = purchaseDate.getMonth();
  let year = purchaseDate.getFullYear();
  if (day >= closingDay) {
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return { year, month };
}

export async function getCurrentInvoiceTotal(accountId: string, tenantId: string, requestingUserId: string): Promise<Prisma.Decimal> {
  const account = await prisma.personalAccount.findFirstOrThrow({ where: { id: accountId, tenantId } });
  if (account.type !== "CREDIT_CARD" || !account.invoiceClosingDay) {
    throw new Error("Conta não é do tipo CREDIT_CARD ou não possui dia de fechamento configurado.");
  }

  const now = new Date();
  const competence = resolveInvoiceCompetence(now, account.invoiceClosingDay);
  const invoiceStart = new Date(competence.year, competence.month - 1, account.invoiceClosingDay);
  const invoiceEnd = new Date(competence.year, competence.month, account.invoiceClosingDay);

  // Capítulo 22.3 — mesma blindagem de privacidade das transações: o total da
  // fatura (e o limite disponível derivado dele) não pode somar despesas
  // privadas de outro usuário em conta compartilhada, nem vazar entre tenants.
  const result = await prisma.personalTransaction.aggregate({
    where: applyPrivacyFilter({ accountId, tenantId, type: "EXPENSE", transactionDate: { gte: invoiceStart, lt: invoiceEnd } }, requestingUserId),
    _sum: { amount: true },
  });
  return result._sum.amount ?? new Prisma.Decimal(0);
}

personalTaxToolsRouter.get("/personal/accounts/:id/invoice-summary", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireFinancialRead(req, res))) return;
  const { tenantId, userId } = req.session!;
  const account = await prisma.personalAccount.findFirst({ where: { id: req.params.id, tenantId } });
  if (!account) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Conta não encontrada." } });
  }
  if (account.type !== "CREDIT_CARD" || !account.invoiceClosingDay) {
    return res.status(400).json({ success: false, data: null, error: { code: "NOT_A_CREDIT_CARD", message: "Esta conta não é um cartão de crédito com dia de fechamento configurado." } });
  }

  const currentInvoiceTotal = await getCurrentInvoiceTotal(account.id, tenantId, userId);
  const creditLimit = account.creditLimit ?? new Prisma.Decimal(0);
  const availableLimit = creditLimit.minus(currentInvoiceTotal);
  const competence = resolveInvoiceCompetence(new Date(), account.invoiceClosingDay);
  const invoiceStart = new Date(competence.year, competence.month - 1, account.invoiceClosingDay);
  const invoiceEnd = new Date(competence.year, competence.month, account.invoiceClosingDay);

  return res.json({
    success: true,
    data: {
      accountId: account.id,
      creditLimit,
      currentInvoiceTotal,
      availableLimit,
      invoicePeriodStart: invoiceStart,
      invoicePeriodEnd: invoiceEnd,
      invoiceDueDay: account.invoiceDueDay,
    },
    error: null,
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 22.11 — CARNÊ-LEÃO (SUGESTÃO ORGANIZACIONAL, NUNCA DECLARAÇÃO OFICIAL)
// ─────────────────────────────────────────────────────────────────────────

// Tabela progressiva mensal do IRPF 2025 (Receita Federal) — portada 1:1 do
// pseudocódigo do Capítulo 22.11.
const FAIXAS_IRPF_MENSAL_2025 = [
  { ate: 2259.2, aliquota: 0, deducao: 0 },
  { ate: 2826.65, aliquota: 0.075, deducao: 169.44 },
  { ate: 3751.05, aliquota: 0.15, deducao: 381.44 },
  { ate: 4664.68, aliquota: 0.225, deducao: 662.77 },
  { ate: Infinity, aliquota: 0.275, deducao: 896.0 },
] as const;

export async function calculateCarneLeaoSuggestion(input: { tenantId: string; createdByUserId: string; referenceMonth: Date }) {
  const start = new Date(input.referenceMonth.getFullYear(), input.referenceMonth.getMonth(), 1);
  const end = new Date(input.referenceMonth.getFullYear(), input.referenceMonth.getMonth() + 1, 0);

  const { _sum } = await prisma.personalTransaction.aggregate({
    where: {
      tenantId: input.tenantId,
      createdByUserId: input.createdByUserId,
      type: "INCOME",
      transactionDate: { gte: start, lte: end },
      category: { isCarneLeaoIncome: true },
    },
    _sum: { amount: true },
  });
  const rendimentoTributavel = _sum.amount ?? new Prisma.Decimal(0);
  const base = rendimentoTributavel.toNumber();

  const faixa = FAIXAS_IRPF_MENSAL_2025.find((f) => base <= f.ate)!;
  const impostoSugerido = Math.max(0, base * faixa.aliquota - faixa.deducao);

  return {
    rendimentoTributavel: base,
    aliquotaAplicada: faixa.aliquota,
    impostoSugerido: new Prisma.Decimal(impostoSugerido.toFixed(2)),
    codigoDarf: "0190",
    vencimento: new Date(end.getFullYear(), end.getMonth() + 1, 0), // último dia útil do mês seguinte (aproximação; feriados não tratados, igual ao pseudocódigo original)
    disclaimer:
      "Valor sugestivo calculado pela tabela progressiva mensal do IRPF — a apuração oficial e o envio da DARF devem ser feitos no app Carnê-Leão da Receita Federal (gov.br), que também permite lançar deduções (livro-caixa, dependentes, previdência) não disponíveis neste cálculo simplificado.",
  };
}

const carneLeaoQuerySchema = z.object({ referenceMonth: z.string().regex(/^\d{4}-\d{2}$/, "Use o formato AAAA-MM") });

personalTaxToolsRouter.get("/personal/tax-tools/carne-leao", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireFinancialRead(req, res))) return;
  const parsed = carneLeaoQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const { tenantId, userId } = req.session!;
  const [year, month] = parsed.data.referenceMonth.split("-").map(Number);
  const referenceMonth = new Date(year, month - 1, 1);

  const result = await calculateCarneLeaoSuggestion({ tenantId, createdByUserId: userId, referenceMonth });
  return res.json({ success: true, data: result, error: null });
});

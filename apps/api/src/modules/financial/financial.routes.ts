// apps/api/src/modules/financial/financial.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 17 (Financeiro — Plano de Contas,
// Centro de Custo, Contas a Pagar/Receber, DRE automática, Fluxo de Caixa
// Projetado).
// GAP DE AUDITORIA ENCONTRADO E CORRIGIDO: os modelos `ChartOfAccount`,
// `CostCenter`, `AccountPayable`, `AccountReceivable` existem no schema desde
// o início, e o Capítulo 17.2/17.3 já descrevia `generateDre()`/
// `getCashFlowProjection()` em pseudocódigo, mas NENHUM desses arquivos
// existia de fato — o módulo Financeiro inteiro, oferecido como serviço SaaS
// (escritório financeiro online, Capítulo 20.9), não tinha absolutamente
// nenhuma implementação real nem rota REST.
// Usa a permissão RBAC já seedada "financial:*:read"/"financial:*:write"
// (nota: o "*" aqui é um código LITERAL de permissão guarda-chuva para todo o
// domínio financeiro — não um padrão wildcard resolvido em runtime; não
// existe nenhum motor de expansão de wildcard no projeto. Isso é intencional:
// o Capítulo 20.9 define o Portal do Contador com UMA permissão de somente
// leitura cobrindo TODO o financeiro, não permissões por sub-recurso como em
// CRM/estoque).
import { Router, Request, Response } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";
import { createAsaasCustomer, createAsaasCharge, getAsaasPixQrCode, getAsaasBoletoIdentificationField } from "../billing/asaas.client";
import { resolveServiceAnexo } from "../fiscal/fator-r-calculator.service";

export const financialRouter = Router();

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

// ─────────────────────────────────────────────────────────────────────────
// PLANO DE CONTAS
// ─────────────────────────────────────────────────────────────────────────

financialRouter.get("/chart-of-accounts", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireFinancialRead(req, res))) return;
  const { tenantId } = req.session!;
  const accounts = await prisma.chartOfAccount.findMany({ where: { tenantId }, orderBy: { code: "asc" } });
  return res.json({ success: true, data: accounts, error: null });
});

const createChartOfAccountSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  nature: z.enum(["REVENUE", "EXPENSE"]),
  parentId: z.string().uuid().nullable().optional(),
});

financialRouter.post("/chart-of-accounts", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireFinancialWrite(req, res))) return;
  const { tenantId } = req.session!;

  const parsed = createChartOfAccountSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const input = parsed.data;

  if (input.parentId && !(await prisma.chartOfAccount.count({ where: { id: input.parentId, tenantId } }))) {
    return res.status(404).json({ success: false, data: null, error: { code: "PARENT_ACCOUNT_NOT_FOUND", message: "Conta contábil pai não encontrada." } });
  }

  try {
    const account = await prisma.chartOfAccount.create({
      data: { tenantId, code: input.code, name: input.name, nature: input.nature, parentId: input.parentId ?? null },
    });
    return res.status(201).json({ success: true, data: account, error: null });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return res.status(409).json({ success: false, data: null, error: { code: "DUPLICATE_CODE", message: "Já existe uma conta contábil com este código." } });
    }
    throw error;
  }
});

// ─────────────────────────────────────────────────────────────────────────
// CENTRO DE CUSTO
// ─────────────────────────────────────────────────────────────────────────

financialRouter.get("/cost-centers", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireFinancialRead(req, res))) return;
  const { tenantId } = req.session!;
  const costCenters = await prisma.costCenter.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
  return res.json({ success: true, data: costCenters, error: null });
});

const createCostCenterSchema = z.object({
  accountId: z.string().uuid(),
  code: z.string().nullable().optional(),
  name: z.string().min(1),
});

financialRouter.post("/cost-centers", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireFinancialWrite(req, res))) return;
  const { tenantId } = req.session!;

  const parsed = createCostCenterSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const input = parsed.data;

  const account = await prisma.chartOfAccount.findFirst({ where: { id: input.accountId, tenantId } });
  if (!account) {
    return res.status(404).json({ success: false, data: null, error: { code: "ACCOUNT_NOT_FOUND", message: "Conta contábil não encontrada." } });
  }

  try {
    const costCenter = await prisma.costCenter.create({
      data: { tenantId, accountId: input.accountId, code: input.code ?? null, name: input.name },
    });
    return res.status(201).json({ success: true, data: costCenter, error: null });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return res.status(409).json({ success: false, data: null, error: { code: "DUPLICATE_CODE", message: "Já existe um centro de custo com este código." } });
    }
    throw error;
  }
});

// ─────────────────────────────────────────────────────────────────────────
// CONTAS A PAGAR
// ─────────────────────────────────────────────────────────────────────────

financialRouter.get("/accounts-payable", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireFinancialRead(req, res))) return;
  const { tenantId } = req.session!;
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const supplierId = typeof req.query.supplierId === "string" ? req.query.supplierId : null;

  const payables = await prisma.accountPayable.findMany({
    where: { tenantId, ...(status ? { status: status as any } : {}), ...(supplierId ? { supplierId } : {}) },
    include: { supplier: true, chartOfAccount: true, costCenter: true },
    orderBy: { dueDate: "asc" },
    take: 200,
  });
  return res.json({ success: true, data: payables, error: null });
});

const createPayableSchema = z.object({
  supplierId: z.string().uuid(),
  description: z.string().min(1),
  amount: z.number().positive(),
  dueDate: z.string().datetime(),
  sourceNfeKey: z.string().nullable().optional(),
  chartOfAccountId: z.string().uuid().nullable().optional(),
  costCenterId: z.string().uuid().nullable().optional(),
});

financialRouter.post("/accounts-payable", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireFinancialWrite(req, res))) return;
  const { tenantId } = req.session!;

  const parsed = createPayableSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const input = parsed.data;

  const supplier = await prisma.supplier.findFirst({ where: { id: input.supplierId, tenantId } });
  if (!supplier) {
    return res.status(404).json({ success: false, data: null, error: { code: "SUPPLIER_NOT_FOUND", message: "Fornecedor não encontrado." } });
  }

  if (input.chartOfAccountId && !(await prisma.chartOfAccount.count({ where: { id: input.chartOfAccountId, tenantId } }))) {
    return res.status(404).json({ success: false, data: null, error: { code: "ACCOUNT_NOT_FOUND", message: "Conta contábil não encontrada." } });
  }
  if (input.costCenterId && !(await prisma.costCenter.count({ where: { id: input.costCenterId, tenantId } }))) {
    return res.status(404).json({ success: false, data: null, error: { code: "COST_CENTER_NOT_FOUND", message: "Centro de custo não encontrado." } });
  }

  const payable = await prisma.accountPayable.create({
    data: {
      tenantId,
      supplierId: input.supplierId,
      description: input.description,
      amount: input.amount,
      dueDate: input.dueDate,
      sourceNfeKey: input.sourceNfeKey ?? null,
      chartOfAccountId: input.chartOfAccountId ?? null,
      costCenterId: input.costCenterId ?? null,
    },
  });
  return res.status(201).json({ success: true, data: payable, error: null });
});

/**
 * Baixa (pagamento) de uma conta a pagar — única transição PENDING/OVERDUE →
 * PAID, grava `paidAt` no instante do pagamento efetivo (consumido
 * diretamente por `generateDre()`/`getCashFlowProjection()` abaixo).
 */
financialRouter.post("/accounts-payable/:id/pay", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireFinancialWrite(req, res))) return;
  const { tenantId } = req.session!;

  const payable = await prisma.accountPayable.findFirst({ where: { id: req.params.id, tenantId } });
  if (!payable) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Conta a pagar não encontrada." } });
  }
  if (payable.status === "PAID" || payable.status === "CANCELLED") {
    return res.status(409).json({ success: false, data: null, error: { code: "INVALID_STATUS", message: `Não é possível pagar uma conta com status ${payable.status}.` } });
  }

  const claimed = await prisma.accountPayable.updateMany({
    where: { id: payable.id, tenantId, status: { notIn: ["PAID", "CANCELLED"] } },
    data: { status: "PAID", paidAt: new Date() },
  });
  if (claimed.count === 0) {
    return res.status(409).json({ success: false, data: null, error: { code: "INVALID_STATUS", message: "Conta já paga ou cancelada por outra requisição." } });
  }
  const updated = await prisma.accountPayable.findFirstOrThrow({ where: { id: payable.id, tenantId } });
  return res.json({ success: true, data: updated, error: null });
});

financialRouter.post("/accounts-payable/:id/cancel", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireFinancialWrite(req, res))) return;
  const { tenantId } = req.session!;

  const payable = await prisma.accountPayable.findFirst({ where: { id: req.params.id, tenantId } });
  if (!payable) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Conta a pagar não encontrada." } });
  }
  if (payable.status === "PAID") {
    return res.status(409).json({ success: false, data: null, error: { code: "INVALID_STATUS", message: "Não é possível cancelar uma conta já paga — estorne manualmente se necessário." } });
  }

  const claimed = await prisma.accountPayable.updateMany({
    where: { id: payable.id, tenantId, status: { not: "PAID" } },
    data: { status: "CANCELLED" },
  });
  if (claimed.count === 0) {
    return res.status(409).json({ success: false, data: null, error: { code: "INVALID_STATUS", message: "Conta já paga por outra requisição." } });
  }
  const updated = await prisma.accountPayable.findFirstOrThrow({ where: { id: payable.id, tenantId } });
  return res.json({ success: true, data: updated, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// CONTAS A RECEBER
// ─────────────────────────────────────────────────────────────────────────

financialRouter.get("/accounts-receivable", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireFinancialRead(req, res))) return;
  const { tenantId } = req.session!;
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const clientId = typeof req.query.clientId === "string" ? req.query.clientId : null;

  const receivables = await prisma.accountReceivable.findMany({
    where: { tenantId, ...(status ? { status: status as any } : {}), ...(clientId ? { clientId } : {}) },
    include: { client: true, chartOfAccount: true },
    orderBy: { dueDate: "asc" },
    take: 200,
  });
  return res.json({ success: true, data: receivables, error: null });
});

const createReceivableSchema = z.object({
  clientId: z.string().uuid(),
  saleId: z.string().uuid().nullable().optional(),
  description: z.string().min(1),
  amount: z.number().positive(),
  dueDate: z.string().datetime(),
  chartOfAccountId: z.string().uuid().nullable().optional(),
});

/**
 * Lançamento manual de conta a receber (ex.: crediário/fiado do varejo geral,
 * Capítulo 17 prosa "Alimentado por vendas STORE_CREDIT"). Vendas fechadas
 * via PDV com `paymentMethod: STORE_CREDIT` também alimentam este mesmo
 * modelo — este endpoint cobre o lançamento avulso/manual (ex.: acordo
 * renegociado fora do fluxo de venda).
 */
financialRouter.post("/accounts-receivable", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireFinancialWrite(req, res))) return;
  const { tenantId } = req.session!;

  const parsed = createReceivableSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const input = parsed.data;

  const client = await prisma.client.findFirst({ where: { id: input.clientId, tenantId } });
  if (!client) {
    return res.status(404).json({ success: false, data: null, error: { code: "CLIENT_NOT_FOUND", message: "Cliente não encontrado." } });
  }

  if (input.saleId && !(await prisma.sale.count({ where: { id: input.saleId, tenantId } }))) {
    return res.status(404).json({ success: false, data: null, error: { code: "SALE_NOT_FOUND", message: "Venda não encontrada." } });
  }
  if (input.chartOfAccountId && !(await prisma.chartOfAccount.count({ where: { id: input.chartOfAccountId, tenantId } }))) {
    return res.status(404).json({ success: false, data: null, error: { code: "ACCOUNT_NOT_FOUND", message: "Conta contábil não encontrada." } });
  }

  const receivable = await prisma.accountReceivable.create({
    data: {
      tenantId,
      clientId: input.clientId,
      saleId: input.saleId ?? null,
      description: input.description,
      amount: input.amount,
      dueDate: input.dueDate,
      chartOfAccountId: input.chartOfAccountId ?? null,
    },
  });
  return res.status(201).json({ success: true, data: receivable, error: null });
});

financialRouter.post("/accounts-receivable/:id/receive", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireFinancialWrite(req, res))) return;
  const { tenantId } = req.session!;

  const receivable = await prisma.accountReceivable.findFirst({ where: { id: req.params.id, tenantId } });
  if (!receivable) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Conta a receber não encontrada." } });
  }
  if (receivable.status === "PAID" || receivable.status === "CANCELLED") {
    return res.status(409).json({ success: false, data: null, error: { code: "INVALID_STATUS", message: `Não é possível receber uma conta com status ${receivable.status}.` } });
  }

  const claimed = await prisma.accountReceivable.updateMany({
    where: { id: receivable.id, tenantId, status: { notIn: ["PAID", "CANCELLED"] } },
    data: { status: "PAID", paidAt: new Date() },
  });
  if (claimed.count === 0) {
    return res.status(409).json({ success: false, data: null, error: { code: "INVALID_STATUS", message: "Conta já recebida ou cancelada por outra requisição." } });
  }
  const updated = await prisma.accountReceivable.findFirstOrThrow({ where: { id: receivable.id, tenantId } });
  return res.json({ success: true, data: updated, error: null });
});

// Capítulo 9 — emite cobrança real de Boleto/Pix no Asaas para uma conta a
// receber do lojista, e cria/reaproveita o PaymentCharge correspondente.
// GAP DE AUDITORIA ENCONTRADO E CORRIGIDO: `PaymentCharge` existia no schema
// desde o início, mas nenhuma rota disparava a criação real da cobrança no PSP.
const chargeReceivableSchema = z.object({
  billingType: z.enum(["BOLETO", "PIX"]),
});

financialRouter.post("/accounts-receivable/:id/charge", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireFinancialWrite(req, res))) return;
  const { tenantId } = req.session!;

  const parsed = chargeReceivableSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const receivable = await prisma.accountReceivable.findFirst({ where: { id: req.params.id, tenantId }, include: { client: true } });
  if (!receivable) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Conta a receber não encontrada." } });
  }
  if (receivable.status === "PAID" || receivable.status === "CANCELLED") {
    return res.status(409).json({ success: false, data: null, error: { code: "INVALID_STATUS", message: `Não é possível cobrar uma conta com status ${receivable.status}.` } });
  }
  if (!receivable.client) {
    return res.status(422).json({ success: false, data: null, error: { code: "CLIENT_REQUIRED", message: "Esta conta a receber não possui cliente vinculado — não é possível emitir Boleto/Pix." } });
  }
  if (!receivable.client.document) {
    return res.status(422).json({ success: false, data: null, error: { code: "DOCUMENT_REQUIRED", message: "O cliente precisa ter CPF/CNPJ cadastrado para emitir cobrança." } });
  }

  const existingCharge = await prisma.paymentCharge.findUnique({ where: { accountReceivableId: receivable.id } });
  if (existingCharge && existingCharge.status === "PENDING") {
    return res.status(409).json({ success: false, data: null, error: { code: "CHARGE_ALREADY_EXISTS", message: "Já existe uma cobrança pendente para esta conta a receber." } });
  }

  try {
    let asaasCustomerId = receivable.client.asaasCustomerId;
    if (!asaasCustomerId) {
      const customer = await createAsaasCustomer({
        name: receivable.client.name,
        cpfCnpj: receivable.client.document,
        email: receivable.client.email ?? undefined,
        phone: receivable.client.phone ?? undefined,
        externalReference: receivable.client.id,
      });
      asaasCustomerId = customer.id;
      await prisma.client.update({ where: { id: receivable.client.id }, data: { asaasCustomerId } });
    }

    const dueDate = receivable.dueDate.toISOString().slice(0, 10);
    const charge = await createAsaasCharge({
      customer: asaasCustomerId,
      billingType: parsed.data.billingType,
      value: Number(receivable.amount),
      dueDate,
      description: receivable.description,
      externalReference: receivable.id,
    });

    let pixQrCodePayload: string | null = null;
    let boletoDigitableLine: string | null = null;
    if (parsed.data.billingType === "PIX") {
      const qr = await getAsaasPixQrCode(charge.id);
      pixQrCodePayload = qr.payload;
    } else {
      const identification = await getAsaasBoletoIdentificationField(charge.id);
      boletoDigitableLine = identification.identificationField;
    }

    const paymentCharge = await prisma.paymentCharge.upsert({
      where: { accountReceivableId: receivable.id },
      create: {
        tenantId,
        accountReceivableId: receivable.id,
        type: parsed.data.billingType,
        status: "PENDING",
        pixQrCodePayload,
        boletoDigitableLine,
        expiresAt: receivable.dueDate,
        externalProviderId: charge.id,
      },
      update: {
        type: parsed.data.billingType,
        status: "PENDING",
        pixQrCodePayload,
        boletoDigitableLine,
        expiresAt: receivable.dueDate,
        externalProviderId: charge.id,
        paidAt: null,
      },
    });

    return res.status(201).json({
      success: true,
      data: { ...paymentCharge, invoiceUrl: charge.invoiceUrl, bankSlipUrl: charge.bankSlipUrl ?? null },
      error: null,
    });
  } catch (err) {
    return res.status(502).json({ success: false, data: null, error: { code: "ASAAS_CHARGE_FAILED", message: (err as Error).message } });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// DRE AUTOMÁTICA (Capítulo 17.2)
// ─────────────────────────────────────────────────────────────────────────

const dreQuerySchema = z.object({
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
});

/**
 * Implementação real de `generateDre()` (Capítulo 17.2): agregação por conta
 * contábil, nunca recálculo manual pelo lojista. Receita = `Sale.status=PAID`
 * no período; Despesa = `AccountPayable.paidAt` no período (regime de caixa,
 * não competência — alinhado ao perfil de pequeno/médio negócio alvo deste
 * SaaS, que normalmente não possui contabilidade por competência).
 */
financialRouter.get("/reports/dre", requireAuth, async (req: Request, res: Response) => {
  const { userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "reports:*:read")) && !(await hasPermission(role, userId, "financial:*:read"))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite gerar a DRE." } });
  }
  const { tenantId } = req.session!;

  const parsed = dreQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const periodStart = new Date(parsed.data.periodStart);
  const periodEnd = new Date(parsed.data.periodEnd);

  const revenueByAccount = await prisma.sale.groupBy({
    by: ["chartOfAccountId"],
    where: { tenantId, status: "PAID", createdAt: { gte: periodStart, lte: periodEnd } },
    _sum: { totalAmount: true },
  });

  const expensesByAccount = await prisma.accountPayable.groupBy({
    by: ["chartOfAccountId"],
    where: { tenantId, status: "PAID", paidAt: { gte: periodStart, lte: periodEnd } },
    _sum: { amount: true },
  });

  const accountIds = [
    ...new Set(
      [...revenueByAccount, ...expensesByAccount]
        .map((row) => row.chartOfAccountId)
        .filter((id): id is string => id !== null),
    ),
  ];
  const accounts = accountIds.length
    ? await prisma.chartOfAccount.findMany({ where: { id: { in: accountIds }, tenantId } })
    : [];
  const accountNameById = new Map(accounts.map((a) => [a.id, a.name]));

  const revenueLines = revenueByAccount.map((row) => ({
    chartOfAccountId: row.chartOfAccountId,
    accountName: row.chartOfAccountId ? accountNameById.get(row.chartOfAccountId) ?? "Sem classificação" : "Sem classificação",
    amount: row._sum.totalAmount ?? new Prisma.Decimal(0),
  }));
  const expenseLines = expensesByAccount.map((row) => ({
    chartOfAccountId: row.chartOfAccountId,
    accountName: row.chartOfAccountId ? accountNameById.get(row.chartOfAccountId) ?? "Sem classificação" : "Sem classificação",
    amount: row._sum.amount ?? new Prisma.Decimal(0),
  }));

  const grossRevenue = revenueLines.reduce((acc, line) => acc.plus(line.amount), new Prisma.Decimal(0));
  const totalExpenses = expenseLines.reduce((acc, line) => acc.plus(line.amount), new Prisma.Decimal(0));
  const netResult = grossRevenue.minus(totalExpenses);

  return res.json({
    success: true,
    data: { periodStart, periodEnd, revenueLines, expenseLines, grossRevenue, totalExpenses, netResult },
    error: null,
  });
});

// ─────────────────────────────────────────────────────────────────────────
// FATOR "r" DO SIMPLES NACIONAL — ANEXO III vs. V (Capítulo 21.8)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Apuração sob demanda do Fator "r" (LC 123/2006, art. 18, §5º-J): folha de
 * pagamento / faturamento bruto dos últimos 12 meses. Exposto como relatório
 * (mesmo padrão de /reports/dre) em vez de um cron automático que reescreveria
 * `Tenant.simplesNacionalAnexo` sozinho — a migração de Anexo tem efeito
 * tributário real e documentado, e deve ser uma decisão consciente do
 * contador/lojista confirmada manualmente em Configurações Fiscais, nunca uma
 * alteração silenciosa de fundo.
 */
financialRouter.get("/reports/fator-r", requireAuth, async (req: Request, res: Response) => {
  const { userId, role, tenantId } = req.session!;
  if (!(await hasPermission(role, userId, "reports:*:read")) && !(await hasPermission(role, userId, "financial:*:read"))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite apurar o Fator \"r\"." } });
  }

  const result = await resolveServiceAnexo(prisma, tenantId);

  return res.json({
    success: true,
    data: {
      fatorR: result.fatorR,
      anexoApurado: result.anexo,
      folhaUltimos12Meses: result.folhaUltimos12Meses,
      faturamentoUltimos12Meses: result.faturamentoUltimos12Meses,
      limiarMigracao: new Prisma.Decimal(0.28),
      observacao:
        'Migração de Anexo exige confirmação manual em Configurações Fiscais (Tenant.simplesNacionalAnexo) — esta apuração nunca altera o cadastro automaticamente (Capítulo 21.8).',
    },
    error: null,
  });
});

// ─────────────────────────────────────────────────────────────────────────
// FLUXO DE CAIXA PROJETADO (Capítulo 17.3)
// ─────────────────────────────────────────────────────────────────────────

const cashFlowQuerySchema = z.object({
  daysAhead: z.coerce.number().int().positive().max(365).default(30),
});

/**
 * Implementação real de `getCashFlowProjection()` (Capítulo 17.3): realizado
 * (vendas pagas + contas pagas até hoje) vs. projetado por dia (contas a
 * receber/pagar PENDING agrupadas por `dueDate`), permitindo ao frontend
 * destacar antecipadamente qualquer dia com saldo acumulado projetado
 * negativo — o "alerta de caixa negativo projetado" do Capítulo 17.3.
 */
financialRouter.get("/reports/cash-flow-projection", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireFinancialRead(req, res))) return;
  const { tenantId } = req.session!;

  const parsed = cashFlowQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const { daysAhead } = parsed.data;
  const today = new Date();
  const horizon = new Date(today.getTime() + daysAhead * 24 * 60 * 60 * 1000);

  const [realizedSalesSum, realizedPayablesSum] = await Promise.all([
    prisma.sale.aggregate({ where: { tenantId, status: "PAID" }, _sum: { totalAmount: true } }),
    prisma.accountPayable.aggregate({ where: { tenantId, status: "PAID" }, _sum: { amount: true } }),
  ]);

  const projectedByDay = await prisma.$queryRaw<{ day: Date; inflow: Prisma.Decimal; outflow: Prisma.Decimal }[]>`
    SELECT
      day_series.day AS day,
      COALESCE((SELECT SUM(ar.amount) FROM accounts_receivable ar
        WHERE ar."tenantId" = ${tenantId} AND ar.status = 'PENDING'
          AND date_trunc('day', ar."dueDate") = day_series.day), 0) AS inflow,
      COALESCE((SELECT SUM(ap.amount) FROM accounts_payable ap
        WHERE ap."tenantId" = ${tenantId} AND ap.status = 'PENDING'
          AND date_trunc('day', ap."dueDate") = day_series.day), 0) AS outflow
    FROM generate_series(date_trunc('day', ${today}::timestamp), date_trunc('day', ${horizon}::timestamp), interval '1 day') AS day_series(day)
    ORDER BY day_series.day;
  `;

  return res.json({
    success: true,
    data: {
      realizedInflow: realizedSalesSum._sum.totalAmount ?? new Prisma.Decimal(0),
      realizedOutflow: realizedPayablesSum._sum.amount ?? new Prisma.Decimal(0),
      projectedByDay,
    },
    error: null,
  });
});

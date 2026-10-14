// apps/api/src/modules/clients/credit-payments.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 4.6 — Varejo Geral (Crediário/Fiado).
// GAP DE AUDITORIA ENCONTRADO E CORRIGIDO: `Client.creditBalanceUsed` só era
// incrementado (por uma venda STORE_CREDIT, ver close-sale.service.ts) e nunca tinha
// nenhum caminho de baixa — o crediário era uma via de mão única que travava o
// cliente para sempre, incapaz de voltar a comprar fiado mesmo após pagar parte do
// saldo em aberto. Este módulo fecha essa lacuna com (1) o lançamento de pagamento
// (parcial ou total) e (2) o extrato/conta-corrente do cliente para a tela
// gerencial (Capítulo 4.6 prosa: "exigindo pagamento de parte do saldo em aberto
// antes de nova venda fiada").
// Reaproveita a permissão RBAC já seedada "crm:client:read"/"crm:client:write"
// (mesma usada por clients.routes.ts) — não é um domínio novo, é uma operação sobre
// o próprio cadastro de cliente.
import { Router, Request, Response } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";

export const clientCreditPaymentsRouter = Router();

async function hasPermission(role: string, userId: string, permissionCode: string): Promise<boolean> {
  const [defaultGrant, override] = await Promise.all([
    prisma.roleDefaultPermission.findUnique({ where: { role_permissionCode: { role: role as any, permissionCode } } }),
    prisma.rolePermission.findUnique({ where: { userId_permission: { userId, permission: permissionCode } } }),
  ]);
  return override ? override.granted : Boolean(defaultGrant);
}

const fail = (res: Response, status: number, code: string, message: string, details?: unknown) =>
  res.status(status).json({ success: false, data: null, error: { code, message, ...(details ? { details } : {}) } });

// ─────────────────────────────────────────────────────────────────────────
// EXTRATO / CONTA-CORRENTE DO CLIENTE (crediário)
// ─────────────────────────────────────────────────────────────────────────

clientCreditPaymentsRouter.get("/clients/:id/credit-statement", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "crm:client:read"))) {
    return fail(res, 403, "FORBIDDEN", "Seu nível de acesso não permite consultar o crediário deste cliente.");
  }

  const client = await prisma.client.findFirst({
    where: { id: req.params.id, tenantId },
    select: { id: true, name: true, creditLimit: true, creditBalanceUsed: true },
  });
  if (!client) return fail(res, 404, "NOT_FOUND", "Cliente não encontrado.");

  const [storeCreditSales, payments] = await Promise.all([
    // Vendas a prazo (Sale.paymentMethod = STORE_CREDIT) que debitaram o saldo deste
    // cliente — ver trava/incremento atômico em close-sale.service.ts.
    prisma.sale.findMany({
      where: { tenantId, clientId: client.id, paymentMethod: "STORE_CREDIT" },
      select: { id: true, totalAmount: true, status: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.clientCreditPayment.findMany({
      where: { tenantId, clientId: client.id },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  ]);

  const availableLimit = Prisma.Decimal.max(0, new Prisma.Decimal(client.creditLimit).minus(client.creditBalanceUsed));

  return res.json({
    success: true,
    data: {
      client: { id: client.id, name: client.name },
      creditLimit: client.creditLimit,
      creditBalanceUsed: client.creditBalanceUsed,
      availableLimit,
      storeCreditSales,
      payments,
    },
    error: null,
  });
});

// ─────────────────────────────────────────────────────────────────────────
// BAIXA DE CREDIÁRIO (pagamento total ou parcial do saldo em aberto)
// ─────────────────────────────────────────────────────────────────────────

const creditPaymentSchema = z.object({
  amount: z.number().positive(),
  note: z.string().trim().min(1).max(500).nullable().optional(),
});

clientCreditPaymentsRouter.post("/clients/:id/credit-payments", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "crm:client:write"))) {
    return fail(res, 403, "FORBIDDEN", "Seu nível de acesso não permite registrar pagamento de crediário.");
  }
  const parsed = creditPaymentSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "VALIDATION_ERROR", "Dados inválidos.", parsed.error.flatten());
  const { amount, note } = parsed.data;

  const client = await prisma.client.findFirst({ where: { id: req.params.id, tenantId }, select: { id: true } });
  if (!client) return fail(res, 404, "NOT_FOUND", "Cliente não encontrado.");

  const result = await prisma.$transaction(async (tx) => {
    // Nunca abaixo de zero: o pagamento nunca cria saldo "negativo" de crediário —
    // um pagamento maior do que o saldo em aberto apenas zera o saldo usado (mesmo
    // check-and-update atômico de productVariant.updateMany em
    // product-variants.routes.ts/stock-adjust — a quantidade decrementada no WHERE
    // nunca excede o saldo disponível da própria linha).
    const claimed = await tx.client.updateMany({
      where: { id: client.id, tenantId, creditBalanceUsed: { gte: new Prisma.Decimal(amount) } },
      data: { creditBalanceUsed: { decrement: amount } },
    });
    if (claimed.count === 0) {
      // Saldo em aberto menor que o valor informado: zera o saldo (nunca decrementa
      // além do que existe) em vez de rejeitar — pagamento a mais de um crediário
      // quase quitado é comum na prática do varejo (arredondamento/troco do cliente).
      await tx.client.updateMany({
        where: { id: client.id, tenantId, creditBalanceUsed: { gt: 0 } },
        data: { creditBalanceUsed: 0 },
      });
    }
    const payment = await tx.clientCreditPayment.create({
      data: {
        tenantId,
        clientId: client.id,
        amount,
        note: note ?? null,
        registeredByUserId: userId,
      },
    });
    const updatedClient = await tx.client.findUniqueOrThrow({
      where: { id: client.id },
      select: { creditLimit: true, creditBalanceUsed: true },
    });
    return { payment, client: updatedClient };
  });

  return res.status(201).json({ success: true, data: result, error: null });
});

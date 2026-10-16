// apps/api/src/modules/construction/business-accounts.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 11.8 (Material de Construção/Ferragens) —
// "Vendas a prazo para profissionais (construtoras/empreiteiros)": reaproveita
// `Client.creditLimit`/`AccountReceivable` do Varejo Geral, mas com
// `Client.isBusinessAccount=true` habilitando faturamento mensal consolidado em vez
// de cobrança por venda individual.
//
// Permissão: reaproveita "stock:product:read"/"stock:product:write" — não existe
// nenhum código "financial:receivable:*" seedado em packages/db/prisma/seed.ts (só
// lido, não editado nesta rodada) para reaproveitar; "stock:product:write" já é o
// mesmo domínio RBAC usado por purchase-orders.routes.ts para operações financeiras
// derivadas de estoque/compras (AccountPayable), então é consistente reaproveitá-lo
// aqui também para a geração de AccountReceivable de clientes profissionais.
import { Router, Request, Response } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";
import { requireModule } from "../../middlewares/gatekeeper.middleware";

export const businessAccountsRouter = Router();

async function hasPermission(role: string, userId: string, permissionCode: string): Promise<boolean> {
  const [defaultGrant, override] = await Promise.all([
    prisma.roleDefaultPermission.findUnique({ where: { role_permissionCode: { role: role as any, permissionCode } } }),
    prisma.rolePermission.findUnique({ where: { userId_permission: { userId, permission: permissionCode } } }),
  ]);
  return override ? override.granted : Boolean(defaultGrant);
}

function forbidden(res: Response, message: string) {
  return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message } });
}
function notFound(res: Response, message: string) {
  return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message } });
}
function validationError(res: Response, details: unknown) {
  return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: "Dados inválidos.", details } });
}

const monthQuerySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/, "Use o formato AAAA-MM.")
    .optional(),
});

function resolveMonthRange(month?: string): { start: Date; end: Date; label: string } {
  const now = new Date();
  const [year, monthIndex] = month ? month.split("-").map(Number) : [now.getFullYear(), now.getMonth() + 1];
  const start = new Date(year, monthIndex - 1, 1);
  const end = new Date(year, monthIndex, 0, 23, 59, 59, 999);
  const label = `${year}-${String(monthIndex).padStart(2, "0")}`;
  return { start, end, label };
}

// ─────────────────────────────────────────────────────────────────────────
// EXTRATO MENSAL (Capítulo 11.8)
// ─────────────────────────────────────────────────────────────────────────

businessAccountsRouter.get("/business-accounts/:clientId/monthly-statement", requireAuth, requireModule("CONSTRUCTION_BULK_UNITS"), async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "stock:product:read"))) {
    return forbidden(res, "Seu nível de acesso não permite consultar o extrato de conta profissional.");
  }

  const parsedQuery = monthQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) return validationError(res, parsedQuery.error.flatten());

  const client = await prisma.client.findFirst({ where: { id: req.params.clientId, tenantId } });
  if (!client) return notFound(res, "Cliente não encontrado.");
  if (!client.isBusinessAccount) {
    return res.status(400).json({
      success: false,
      data: null,
      error: { code: "NOT_BUSINESS_ACCOUNT", message: "Este cliente não é uma conta profissional (isBusinessAccount=false)." },
    });
  }

  const { start, end, label } = resolveMonthRange(parsedQuery.data.month);

  const sales = await prisma.sale.findMany({
    where: { tenantId, clientId: client.id, paymentMethod: "STORE_CREDIT", createdAt: { gte: start, lte: end } },
    include: { items: true },
    orderBy: { createdAt: "asc" },
    // CORREÇÃO DE AUDITORIA (mega-audit rodada 7, defesa em profundidade): já
    // escopado por cliente único + mês único (não é um N+1 nem uma listagem global
    // sem filtro), mas sem nenhum teto explícito uma conta profissional com volume
    // anômalo de vendas no mês (ex.: integração externa com bug gerando milhares de
    // vendas) ainda conseguiria estourar a resposta. Mesmo padrão de `take` usado em
    // outras rotas de relatório do arquivo (ex.: work-order-reports.routes.ts).
    take: 5000,
  });

  return res.json({
    success: true,
    data: {
      client: { id: client.id, name: client.name, creditLimit: client.creditLimit, creditBalanceUsed: client.creditBalanceUsed },
      month: label,
      sales,
    },
    error: null,
  });
});

// ─────────────────────────────────────────────────────────────────────────
// FATURAMENTO MENSAL CONSOLIDADO — gera UMA AccountReceivable e zera o saldo
// utilizado de crediário do cliente, na mesma transação.
// ─────────────────────────────────────────────────────────────────────────

businessAccountsRouter.post("/business-accounts/:clientId/generate-monthly-invoice", requireAuth, requireModule("CONSTRUCTION_BULK_UNITS"), async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "stock:product:write"))) {
    return forbidden(res, "Seu nível de acesso não permite gerar faturamento consolidado.");
  }

  const parsedQuery = monthQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) return validationError(res, parsedQuery.error.flatten());
  const { label } = resolveMonthRange(parsedQuery.data.month);

  const client = await prisma.client.findFirst({ where: { id: req.params.clientId, tenantId } });
  if (!client) return notFound(res, "Cliente não encontrado.");
  if (!client.isBusinessAccount) {
    return res.status(400).json({
      success: false,
      data: null,
      error: { code: "NOT_BUSINESS_ACCOUNT", message: "Este cliente não é uma conta profissional (isBusinessAccount=false)." },
    });
  }
  if (client.creditBalanceUsed.lte(0)) {
    return res.status(400).json({
      success: false,
      data: null,
      error: { code: "NOTHING_TO_INVOICE", message: "Este cliente não possui saldo de crediário pendente para faturar." },
    });
  }

  const amount = client.creditBalanceUsed;
  const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Guarda de concorrência: só zera se o saldo ainda for exatamente o que lemos
      // (mesmo padrão `updateMany` com where-guard usado em purchase-orders.routes.ts
      // e documentado como referência em close-sale.service.ts).
      const claimed = await tx.client.updateMany({
        where: { id: client.id, tenantId, creditBalanceUsed: amount },
        data: { creditBalanceUsed: new Prisma.Decimal(0) },
      });
      if (claimed.count === 0) {
        throw new Error("CONCURRENT_BALANCE_CHANGE");
      }

      const receivable = await tx.accountReceivable.create({
        data: {
          tenantId,
          clientId: client.id,
          saleId: null,
          description: `Faturamento mensal consolidado — ${label}`,
          amount,
          dueDate,
          status: "PENDING",
        },
      });

      return receivable;
    });

    return res.status(201).json({ success: true, data: result, error: null });
  } catch (err: any) {
    if (err?.message === "CONCURRENT_BALANCE_CHANGE") {
      return res.status(409).json({
        success: false,
        data: null,
        error: { code: "CONCURRENT_BALANCE_CHANGE", message: "O saldo do cliente mudou enquanto a fatura era gerada; recarregue e tente novamente." },
      });
    }
    throw err;
  }
});

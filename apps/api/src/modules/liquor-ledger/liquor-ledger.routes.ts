// apps/api/src/modules/liquor-ledger/liquor-ledger.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 4.3 — Adega/Bebidas: conta-corrente de
// CASCOS/VASILHAMES RETORNÁVEIS, separada da conta-corrente financeira do cliente,
// rastreando apenas posse física. GAP DE AUDITORIA: o model `ReturnableContainerLedger`
// já existia no schema (packages/db/prisma/schema.prisma) mas nenhuma rota de API o
// consumia — esta é a implementação do zero.
//
// Regra de negócio (Capítulo 4.3, item 2):
//   - Venda de um produto com `isReturnableContainer=true` gera um lançamento BORROWED
//     (o casco saiu fisicamente com o cliente, mesmo a crédito/comodato).
//   - Devolução física do casco gera um lançamento RETURNED.
//   - Saldo de cascos emprestados por cliente/produto = soma(BORROWED) - soma(RETURNED).
//   - Se o cliente não devolver dentro de um prazo configurável (ex.: 30 dias), o
//     sistema deve sugerir cobrar o valor de reposição do casco na próxima venda.
//
// Decisão de integração com o fechamento de venda (close-sale.service.ts):
//   NÃO foi adicionado lançamento automático de BORROWED no fechamento de venda nesta
//   rodada. Motivos: (1) `CloseSaleServerInput`/`executeCloseSaleTransaction` não
//   recebem `clientId` em nenhum ponto hoje — nem o schema de validação em
//   `sales.routes.ts`, nem o `tx.sale.create` gravam esse campo, apesar de
//   `Sale.clientId` existir no schema; (2) esse arquivo foi corrigido recentemente por
//   outro agente para bugs de vazamento de tenant, e estender seu contrato de entrada
//   (rota → service → transação) é uma mudança não-trivial que arrisca regressão num
//   fluxo transacional crítico (Capítulo 6.6) sem tempo hábil para testar com segurança
//   nesta tarefa. Fica documentado como pendência explícita (ver relatório final) — o
//   lançamento continua disponível manualmente via POST /liquor-ledger/entries,
//   inclusive com `saleId` opcional para o operador vincular à venda já fechada.
import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";

export const liquorLedgerRouter = Router();

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

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────
// SALDO DE CASCOS POR CLIENTE (por produto)
// ─────────────────────────────────────────────────────────────────────────

liquorLedgerRouter.get("/liquor-ledger/clients/:clientId", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "liquor-ledger:ledger:read"))) {
    return forbidden(res, "Seu nível de acesso não permite consultar a conta-corrente de cascos.");
  }
  const client = await prisma.client.findFirst({ where: { id: req.params.clientId, tenantId }, select: { id: true, name: true } });
  if (!client) return notFound(res, "Cliente não encontrado.");

  const grouped = await prisma.returnableContainerLedger.groupBy({
    by: ["productId", "direction"],
    where: { tenantId, clientId: client.id },
    _sum: { quantity: true },
  });

  const productIds = [...new Set(grouped.map((g) => g.productId))];
  const products = productIds.length
    ? await prisma.product.findMany({ where: { tenantId, id: { in: productIds } }, select: { id: true, name: true, sku: true } })
    : [];
  const productById = new Map(products.map((p) => [p.id, p]));

  const byProduct = new Map<string, { borrowed: number; returned: number }>();
  for (const row of grouped) {
    const entry = byProduct.get(row.productId) ?? { borrowed: 0, returned: 0 };
    const qty = row._sum.quantity ?? 0;
    if (row.direction === "BORROWED") entry.borrowed += qty;
    else entry.returned += qty;
    byProduct.set(row.productId, entry);
  }

  const balances = [...byProduct.entries()]
    .map(([productId, { borrowed, returned }]) => ({
      productId,
      productName: productById.get(productId)?.name ?? "Produto não encontrado",
      productSku: productById.get(productId)?.sku ?? null,
      borrowed,
      returned,
      balance: borrowed - returned,
    }))
    .sort((a, b) => b.balance - a.balance);

  return res.json({ success: true, data: { client, balances }, error: null });
});

liquorLedgerRouter.get("/liquor-ledger/clients/:clientId/entries", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "liquor-ledger:ledger:read"))) {
    return forbidden(res, "Seu nível de acesso não permite consultar o histórico de cascos.");
  }
  const client = await prisma.client.findFirst({ where: { id: req.params.clientId, tenantId }, select: { id: true } });
  if (!client) return notFound(res, "Cliente não encontrado.");

  const entries = await prisma.returnableContainerLedger.findMany({
    where: { tenantId, clientId: client.id },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const productIds = [...new Set(entries.map((e) => e.productId))];
  const products = productIds.length
    ? await prisma.product.findMany({ where: { tenantId, id: { in: productIds } }, select: { id: true, name: true } })
    : [];
  const productNameById = new Map(products.map((p) => [p.id, p.name]));

  const data = entries.map((e) => ({ ...e, productName: productNameById.get(e.productId) ?? "Produto não encontrado" }));
  return res.json({ success: true, data, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// CASCOS EM ATRASO (relatório gerencial) — aproximação FIFO documentada abaixo.
// ─────────────────────────────────────────────────────────────────────────

// Algoritmo: para cada par (clientId, productId), os lançamentos são processados em
// ordem cronológica crescente como uma fila FIFO de BORROWED. Cada RETURNED consome a
// quantidade das entradas BORROWED mais antigas ainda não compensadas (primeiro a
// emprestar, primeiro a ser considerado devolvido). O que sobra na fila ao final é o
// saldo "em aberto", e a idade do item mais antigo ainda na fila é usada para decidir
// se ultrapassou `daysThreshold`. É uma aproximação: não identifica fisicamente QUAL
// unidade específica do casco voltou, apenas assume a ordem cronológica mais provável —
// suficiente para o relatório gerencial, não para rastreio físico por número de série.
liquorLedgerRouter.get("/liquor-ledger/overdue", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "liquor-ledger:ledger:read"))) {
    return forbidden(res, "Seu nível de acesso não permite consultar o relatório de cascos em atraso.");
  }
  const thresholdParsed = z.coerce.number().int().positive().max(3650).safeParse(req.query.daysThreshold ?? 30);
  if (!thresholdParsed.success) return validationError(res, thresholdParsed.error.flatten());
  const daysThreshold = thresholdParsed.data;

  const entries = await prisma.returnableContainerLedger.findMany({
    where: { tenantId },
    orderBy: { createdAt: "asc" },
    include: { client: { select: { id: true, name: true, phone: true } } },
  });

  type Group = {
    clientId: string;
    productId: string;
    client: { id: string; name: string; phone: string | null };
    queue: { qty: number; createdAt: Date }[];
  };
  const groups = new Map<string, Group>();

  for (const entry of entries) {
    const key = `${entry.clientId}:${entry.productId}`;
    let group = groups.get(key);
    if (!group) {
      group = { clientId: entry.clientId, productId: entry.productId, client: entry.client, queue: [] };
      groups.set(key, group);
    }
    if (entry.direction === "BORROWED") {
      group.queue.push({ qty: entry.quantity, createdAt: entry.createdAt });
    } else {
      let remaining = entry.quantity;
      while (remaining > 0 && group.queue.length > 0) {
        const front = group.queue[0];
        if (front.qty <= remaining) {
          remaining -= front.qty;
          group.queue.shift();
        } else {
          front.qty -= remaining;
          remaining = 0;
        }
      }
    }
  }

  const now = Date.now();
  const outstanding = [...groups.values()]
    .filter((g) => g.queue.length > 0)
    .map((g) => {
      const outstandingQty = g.queue.reduce((sum, item) => sum + item.qty, 0);
      const oldestCreatedAt = g.queue[0].createdAt;
      const ageDays = Math.floor((now - oldestCreatedAt.getTime()) / MS_PER_DAY);
      return { ...g, outstandingQty, oldestCreatedAt, ageDays };
    })
    .filter((g) => g.ageDays >= daysThreshold);

  const productIds = [...new Set(outstanding.map((g) => g.productId))];
  const products = productIds.length
    ? await prisma.product.findMany({ where: { tenantId, id: { in: productIds } }, select: { id: true, name: true, unitPrice: true } })
    : [];
  const productById = new Map(products.map((p) => [p.id, p]));

  const data = outstanding
    .map((g) => {
      const product = productById.get(g.productId);
      const replacementUnitPrice = product ? Number(product.unitPrice) : null;
      return {
        clientId: g.clientId,
        clientName: g.client.name,
        clientPhone: g.client.phone,
        productId: g.productId,
        productName: product?.name ?? "Produto não encontrado",
        outstandingQty: g.outstandingQty,
        oldestBorrowedAt: g.oldestCreatedAt,
        ageDays: g.ageDays,
        suggestedReplacementCharge: replacementUnitPrice !== null ? Number((replacementUnitPrice * g.outstandingQty).toFixed(2)) : null,
      };
    })
    .sort((a, b) => b.ageDays - a.ageDays);

  return res.json({ success: true, data: { daysThreshold, overdue: data }, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// LANÇAMENTO MANUAL (BORROWED/RETURNED)
// ─────────────────────────────────────────────────────────────────────────

const entrySchema = z.object({
  clientId: z.string().uuid(),
  productId: z.string().uuid(),
  direction: z.enum(["BORROWED", "RETURNED"]),
  quantity: z.number().int().positive(),
  saleId: z.string().uuid().optional().nullable(),
});

liquorLedgerRouter.post("/liquor-ledger/entries", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "liquor-ledger:ledger:write"))) {
    return forbidden(res, "Seu nível de acesso não permite lançar movimentos de casco.");
  }
  const parsed = entrySchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error.flatten());
  const { clientId, productId, direction, quantity, saleId } = parsed.data;

  const client = await prisma.client.findFirst({ where: { id: clientId, tenantId }, select: { id: true } });
  if (!client) return notFound(res, "Cliente não encontrado.");
  const product = await prisma.product.findFirst({ where: { id: productId, tenantId }, select: { id: true } });
  if (!product) return notFound(res, "Produto não encontrado.");

  if (saleId) {
    const sale = await prisma.sale.findFirst({ where: { id: saleId, tenantId }, select: { id: true } });
    if (!sale) return notFound(res, "Venda informada não encontrada.");
  }

  const entry = await prisma.returnableContainerLedger.create({
    data: { tenantId, clientId, productId, direction, quantity, saleId: saleId ?? null },
  });
  return res.status(201).json({ success: true, data: entry, error: null });
});

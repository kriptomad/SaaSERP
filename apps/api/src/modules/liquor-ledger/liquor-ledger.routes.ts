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
//   RESOLVIDO NESTA RODADA (Capítulo 6.6/4.3): `close-sale.service.ts` agora coleta,
//   durante o loop de itens, todo produto com `isReturnableContainer=true` vendido
//   com `clientId` identificado, e materializa um lançamento BORROWED vinculado ao
//   `sale.id` logo após a criação da venda (mesmo padrão de `opticalLabOrders`). Uma
//   venda de casco retornável SEM cliente identificado (ex.: balcão avulso) não gera
//   lançamento algum — não há "conta-corrente" sem titular. O lançamento manual via
//   POST /liquor-ledger/entries continua disponível para correções/ajustes.
import { Router, Request, Response } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";
import { requireModule } from "../../middlewares/gatekeeper.middleware";

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

class InsufficientBorrowedBalanceError extends Error {}
// CORREÇÃO DE AUDITORIA (fa-liquor-ledger-return-no-sale-validation): o saleId
// opcional de um lançamento manual antes só era checado quanto à EXISTÊNCIA no
// tenant — nunca se a venda pertence ao mesmo cliente, nem se a quantidade
// devolvida respeita o que foi efetivamente emprestado NAQUELA venda específica.
class SaleContainerNotLentError extends Error {}
class SaleReturnExceedsLentQuantityError extends Error {}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────
// SALDO DE CASCOS POR CLIENTE (por produto)
// ─────────────────────────────────────────────────────────────────────────

liquorLedgerRouter.get("/liquor-ledger/clients/:clientId", requireAuth, requireModule("LIQUOR_LEDGER"), async (req: Request, res: Response) => {
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

liquorLedgerRouter.get("/liquor-ledger/clients/:clientId/entries", requireAuth, requireModule("LIQUOR_LEDGER"), async (req: Request, res: Response) => {
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
liquorLedgerRouter.get("/liquor-ledger/overdue", requireAuth, requireModule("LIQUOR_LEDGER"), async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "liquor-ledger:ledger:read"))) {
    return forbidden(res, "Seu nível de acesso não permite consultar o relatório de cascos em atraso.");
  }
  const thresholdParsed = z.coerce.number().int().positive().max(3650).safeParse(req.query.daysThreshold ?? 30);
  if (!thresholdParsed.success) return validationError(res, thresholdParsed.error.flatten());
  const daysThreshold = thresholdParsed.data;

  // CORREÇÃO DE AUDITORIA (fa-liquor-ledger-truncated-fifo): filtros opcionais de
  // escopo — permitem ao operador restringir a consulta a um cliente/produto
  // específico, reduzindo o volume lido muito abaixo do teto defensivo abaixo, sem
  // depender de paginação (o algoritmo FIFO precisa do histórico cronológico
  // completo DENTRO do escopo consultado para estar correto).
  const scopeParsed = z.object({ clientId: z.string().uuid().optional(), productId: z.string().uuid().optional() }).safeParse({
    clientId: typeof req.query.clientId === "string" ? req.query.clientId : undefined,
    productId: typeof req.query.productId === "string" ? req.query.productId : undefined,
  });
  if (!scopeParsed.success) return validationError(res, scopeParsed.error.flatten());
  const { clientId: scopeClientId, productId: scopeProductId } = scopeParsed.data;

  const LEDGER_ROW_LIMIT = 50000;
  const entries = await prisma.returnableContainerLedger.findMany({
    where: { tenantId, ...(scopeClientId ? { clientId: scopeClientId } : {}), ...(scopeProductId ? { productId: scopeProductId } : {}) },
    orderBy: { createdAt: "asc" },
    include: { client: { select: { id: true, name: true, phone: true } } },
    // CORREÇÃO DE AUDITORIA (fa-liquor-ledger-truncated-fifo): o teto abaixo NUNCA
    // é tratado como um corte silencioso de relatório — o algoritmo FIFO depende da
    // ordem cronológica COMPLETA do(s) par(es) (cliente, produto) consultados para
    // calcular corretamente o saldo de cascos em aberto; um corte no meio da fila
    // apresentaria um saldo incorreto (subestimado) como se fosse definitivo. Se o
    // teto for atingido, a rota abaixo rejeita explicitamente o relatório (nunca
    // retorna um resultado parcial disfarçado de completo) e orienta a refinar o
    // filtro de cliente/produto.
    take: LEDGER_ROW_LIMIT,
  });

  if (entries.length >= LEDGER_ROW_LIMIT) {
    return res.status(422).json({
      success: false,
      data: null,
      error: {
        code: "LEDGER_HISTORY_TRUNCATED",
        message: `O histórico de lançamentos de cascos (${scopeClientId || scopeProductId ? "mesmo já filtrado" : "sem filtro"}) ultrapassa ${LEDGER_ROW_LIMIT} registros. O algoritmo FIFO exige o histórico cronológico completo do(s) par(es) cliente/produto consultado(s) — este relatório nunca apresenta um resultado truncado como se fosse completo. Refine a consulta informando clientId e/ou productId (query string) para reduzir o volume e tente novamente.`,
      },
    });
  }

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
      // CORREÇÃO DE AUDITORIA: cálculo monetário fazia `Number(product.unitPrice)
      // * outstandingQty` em ponto flutuante — trocado por `Prisma.Decimal` para
      // preservar a precisão decimal exata do preço (mesmo padrão usado no resto
      // do módulo financeiro).
      const replacementUnitPrice = product ? product.unitPrice : null;
      const suggestedReplacementCharge = replacementUnitPrice !== null ? replacementUnitPrice.mul(g.outstandingQty).toDecimalPlaces(2) : null;
      return {
        clientId: g.clientId,
        clientName: g.client.name,
        clientPhone: g.client.phone,
        productId: g.productId,
        productName: product?.name ?? "Produto não encontrado",
        outstandingQty: g.outstandingQty,
        oldestBorrowedAt: g.oldestCreatedAt,
        ageDays: g.ageDays,
        suggestedReplacementCharge,
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
  // CORREÇÃO DE AUDITORIA (fa-liquor-ledger-return-no-sale-validation): exigido
  // sempre que `saleId` não for informado — sem venda vinculada, este é um ajuste
  // administrativo puro (correção de erro, casco reencontrado etc.) e precisa de
  // uma justificativa auditável, nunca um número "solto" sem explicação.
  reasonCode: z.string().trim().min(3).max(200).optional(),
});

liquorLedgerRouter.post("/liquor-ledger/entries", requireAuth, requireModule("LIQUOR_LEDGER"), async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "liquor-ledger:ledger:write"))) {
    return forbidden(res, "Seu nível de acesso não permite lançar movimentos de casco.");
  }
  const parsed = entrySchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error.flatten());
  const { clientId, productId, direction, quantity, saleId, reasonCode } = parsed.data;

  // CORREÇÃO DE AUDITORIA (fa-liquor-ledger-return-no-sale-validation): sem venda
  // vinculada, não há como conferir de onde veio a dívida de casco — exige
  // justificativa explícita para criar trilha de auditoria do ajuste.
  if (!saleId && !reasonCode) {
    return res.status(400).json({
      success: false,
      data: null,
      error: { code: "REASON_REQUIRED", message: "Lançamento sem venda vinculada (saleId) é um ajuste administrativo e exige reasonCode explicando o motivo." },
    });
  }

  const client = await prisma.client.findFirst({ where: { id: clientId, tenantId }, select: { id: true } });
  if (!client) return notFound(res, "Cliente não encontrado.");
  const product = await prisma.product.findFirst({ where: { id: productId, tenantId }, select: { id: true, isReturnableContainer: true } });
  if (!product) return notFound(res, "Produto não encontrado.");
  // CORREÇÃO DE AUDITORIA: o lançamento manual aceitava QUALQUER produto, mesmo
  // sem `isReturnableContainer=true` — permitindo abrir conta-corrente de casco
  // para um produto que não é vasilhame retornável (dado sem sentido de negócio,
  // nunca teria devolução física correspondente).
  if (!product.isReturnableContainer) {
    return res.status(409).json({
      success: false,
      data: null,
      error: { code: "NOT_RETURNABLE_CONTAINER", message: "Este produto não está marcado como vasilhame retornável (isReturnableContainer=false)." },
    });
  }

  if (saleId) {
    const sale = await prisma.sale.findFirst({ where: { id: saleId, tenantId }, select: { id: true, clientId: true } });
    if (!sale) return notFound(res, "Venda informada não encontrada.");
    // CORREÇÃO DE AUDITORIA (fa-liquor-ledger-return-no-sale-validation): a venda
    // vinculada precisa pertencer ao MESMO cliente do lançamento — sem isso seria
    // possível "quitar" o casco de um cliente citando a venda de outro.
    if (sale.clientId !== clientId) {
      return res.status(409).json({
        success: false,
        data: null,
        error: { code: "SALE_CLIENT_MISMATCH", message: "A venda informada pertence a outro cliente — não pode ser usada para justificar este lançamento." },
      });
    }
  }

  try {
    // GAP DE AUDITORIA FECHADO (Rodada 6, ALTO) — o saldo de cascos emprestados era
    // calculado apenas em tempo de LEITURA (GET /liquor-ledger/overdue), nunca
    // validado/travado na ESCRITA: dois lançamentos RETURNED concorrentes para o
    // mesmo (tenantId, clientId, productId) podiam ambos "ter sucesso" e levar o
    // saldo de cascos emprestados abaixo de zero (devolução fantasma). O `SELECT ...
    // FOR UPDATE` abaixo bloqueia fisicamente TODAS as linhas existentes dessa chave
    // até o commit — a segunda transação concorrente só enxerga o saldo já
    // atualizado da primeira, nunca um saldo obsoleto.
    const entry = await prisma.$transaction(
      async (tx) => {
        if (direction === "RETURNED") {
          const rows = await tx.$queryRaw<{ direction: string; quantity: number }[]>`
            SELECT direction, quantity
            FROM returnable_container_ledger
            WHERE "tenantId" = ${tenantId} AND "clientId" = ${clientId} AND "productId" = ${productId}
            FOR UPDATE
          `;
          const outstanding = rows.reduce((sum, r) => (r.direction === "BORROWED" ? sum + r.quantity : sum - r.quantity), 0);
          if (quantity > outstanding) {
            throw new InsufficientBorrowedBalanceError(
              `Saldo emprestado insuficiente: cliente tem ${outstanding} casco(s) em aberto, não pode devolver ${quantity}.`,
            );
          }
        }
        // CORREÇÃO DE AUDITORIA (fa-liquor-ledger-return-no-sale-validation): quando
        // a devolução cita uma venda específica, a quantidade devolvida não pode
        // exceder o que foi emprestado NAQUELA venda (nunca apenas o saldo agregado
        // do cliente/produto, que pode incluir cascos de OUTRAS vendas/lançamentos).
        if (direction === "RETURNED" && saleId) {
          const saleEntries = await tx.returnableContainerLedger.findMany({
            where: { tenantId, saleId, productId },
            select: { direction: true, quantity: true },
          });
          const lentOnSale = saleEntries.reduce((sum, e) => (e.direction === "BORROWED" ? sum + e.quantity : sum), 0);
          const alreadyReturnedOnSale = saleEntries.reduce((sum, e) => (e.direction === "RETURNED" ? sum + e.quantity : sum), 0);
          const remainingOnSale = lentOnSale - alreadyReturnedOnSale;
          if (lentOnSale === 0) {
            throw new SaleContainerNotLentError(`A venda informada não tem nenhum casco deste produto emprestado — não pode ser usada para justificar a devolução.`);
          }
          if (quantity > remainingOnSale) {
            throw new SaleReturnExceedsLentQuantityError(
              `Quantidade a devolver (${quantity}) excede o que foi emprestado nesta venda específica (${remainingOnSale} ainda em aberto para esta venda).`,
            );
          }
        }
        return tx.returnableContainerLedger.create({
          data: { tenantId, clientId, productId, direction, quantity, saleId: saleId ?? null, reasonCode: reasonCode ?? null, createdByUserId: userId },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return res.status(201).json({ success: true, data: entry, error: null });
  } catch (err) {
    if (err instanceof InsufficientBorrowedBalanceError) {
      return res.status(409).json({ success: false, data: null, error: { code: "INSUFFICIENT_BORROWED_BALANCE", message: err.message } });
    }
    if (err instanceof SaleContainerNotLentError) {
      return res.status(409).json({ success: false, data: null, error: { code: "SALE_CONTAINER_NOT_LENT", message: err.message } });
    }
    if (err instanceof SaleReturnExceedsLentQuantityError) {
      return res.status(409).json({ success: false, data: null, error: { code: "SALE_RETURN_EXCEEDS_LENT_QUANTITY", message: err.message } });
    }
    throw err;
  }
});

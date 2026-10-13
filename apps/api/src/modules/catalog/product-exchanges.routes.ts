// apps/api/src/modules/catalog/product-exchanges.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 11.4 (Loja de Roupas/Moda) / 11.7 (Loja de
// Calçados): "troca por tamanho/defeito reentra automaticamente no estoque da
// variante correta (não do produto genérico) e gera crédito de loja ou nova venda
// vinculada à troca original, mantendo rastreabilidade fiscal completa."
// GAP DE AUDITORIA FECHADO: o único caminho de "desfazer" uma venda era o estorno
// total (Capítulo 6.8, `pdv/refund-sale.service.ts`), que não reflete o fluxo real de
// troca parcial de item por tamanho/numeração errada. Modelos novos (migration desta
// rodada): `ProductExchange` (o registro da troca em si) e `StoreCreditTransaction`
// (ledger imutável do crédito de loja, saldo materializado em `Client.storeCreditBalance`).
//
// DECISÃO DE ESCOPO (documentada): quando a troca gera diferença de preço A FAVOR DA
// LOJA (item novo mais caro que o devolvido), esta rota NÃO cria uma `Sale` completa
// por si — reaproveitar o pipeline fiscal/tributário real de `closeSale` (tax engine,
// fila de emissão, FEFO/serial) duplicando sua lógica aqui seria um risco de
// divergência fiscal sem necessidade. Em vez disso: a troca é resolvida
// imediatamente (reentrada de estoque + baixa do item novo), o valor da diferença é
// devolvido em `amountDue`, e o caixa fecha uma venda normal (`POST /sales`) só com
// a diferença; `PATCH /product-exchanges/:id/link-sale` grava o vínculo fiscal depois
// (`resultingSaleId`). Quando a diferença é a favor do CLIENTE (item novo mais
// barato, ou resolução STORE_CREDIT), o crédito é emitido automaticamente — nenhuma
// ação manual adicional é necessária.
import { Router, Request, Response } from "express";
import { z } from "zod";
import { Prisma, prismaUnscoped as prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";

export const productExchangesRouter = Router();

async function hasPermission(role: string, userId: string, permissionCode: string): Promise<boolean> {
  const [defaultGrant, override] = await Promise.all([
    prisma.roleDefaultPermission.findUnique({ where: { role_permissionCode: { role: role as any, permissionCode } } }),
    prisma.rolePermission.findUnique({ where: { userId_permission: { userId, permission: permissionCode } } }),
  ]);
  return override ? override.granted : Boolean(defaultGrant);
}

const fail = (res: Response, status: number, code: string, message: string, details?: unknown) =>
  res.status(status).json({ success: false, data: null, error: { code, message, ...(details ? { details } : {}) } });

async function guard(req: Request, res: Response, action: "read" | "write"): Promise<boolean> {
  const { userId, role } = req.session!;
  if (await hasPermission(role, userId, `catalog:exchange:${action}`)) return true;
  fail(res, 403, "FORBIDDEN", action === "read" ? "Seu nível de acesso não permite consultar trocas." : "Seu nível de acesso não permite registrar trocas.");
  return false;
}

class InsufficientNewVariantStockError extends Error {}

// ─────────────────────────────────────────────────────────────────────────
// TROCAS
// ─────────────────────────────────────────────────────────────────────────

const createExchangeSchema = z.object({
  originalSaleItemId: z.string().min(1),
  returnedQuantity: z.number().positive(),
  reasonCode: z.enum(["WRONG_SIZE", "WRONG_NUMBERING", "DEFECT", "CUSTOMER_REGRET", "OTHER"]),
  resolutionType: z.enum(["NEW_ITEM", "STORE_CREDIT"]),
  newVariantId: z.string().min(1).nullable().optional(),
  newQuantity: z.number().positive().nullable().optional(),
});

productExchangesRouter.post("/product-exchanges", requireAuth, async (req: Request, res: Response) => {
  if (!(await guard(req, res, "write"))) return;
  const { tenantId, userId } = req.session!;
  const parsed = createExchangeSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "VALIDATION_ERROR", "Dados inválidos.", parsed.error.flatten());
  const input = parsed.data;

  const originalSaleItem = await prisma.saleItem.findFirst({
    where: { id: input.originalSaleItemId, tenantId },
    include: { sale: { select: { id: true, status: true, clientId: true } } },
  });
  if (!originalSaleItem) return fail(res, 404, "NOT_FOUND", "Item de venda não encontrado.");
  if (originalSaleItem.sale.status !== "PAID") {
    return fail(res, 409, "SALE_NOT_PAID", "Só é possível trocar item de uma venda paga (estornos usam o fluxo de PIN do gerente).");
  }
  if (input.returnedQuantity > Number(originalSaleItem.quantity)) {
    return fail(res, 409, "QUANTITY_EXCEEDS_SALE_ITEM", "Quantidade da troca maior que a quantidade vendida neste item.");
  }
  if (!originalSaleItem.productId) {
    return fail(res, 409, "SERVICE_ITEM_NOT_EXCHANGEABLE", "Itens de serviço (não-produto) não podem ser trocados.");
  }

  const returnedVariantId = originalSaleItem.productVariantId;
  if (!returnedVariantId) {
    const product = await prisma.product.findFirst({ where: { id: originalSaleItem.productId, tenantId }, select: { trackingType: true } });
    if (product && product.trackingType !== "NONE") {
      return fail(
        res,
        409,
        "UNSUPPORTED_TRACKING_TYPE",
        "Troca automática só é suportada para produtos sem rastreio (NONE) ou com grade (VARIANT); lote/série exige seleção manual do lote/serial no estoque.",
      );
    }
  }

  const refundValue = Number(originalSaleItem.unitPrice) * input.returnedQuantity;

  let newVariant: { id: string; productId: string; priceOverride: Prisma.Decimal | null; product: { unitPrice: Prisma.Decimal } } | null = null;
  let newItemValue = 0;
  if (input.resolutionType === "NEW_ITEM") {
    if (!input.newVariantId || !input.newQuantity) {
      return fail(res, 400, "NEW_ITEM_REQUIRED", "Informe a variante e a quantidade do item novo da troca.");
    }
    newVariant = await prisma.productVariant.findFirst({
      where: { id: input.newVariantId, tenantId },
      include: { product: { select: { unitPrice: true } } },
    });
    if (!newVariant) return fail(res, 404, "NEW_VARIANT_NOT_FOUND", "Variante do item novo não encontrada.");
    newItemValue = Number(newVariant.priceOverride ?? newVariant.product.unitPrice) * input.newQuantity;
  }

  const priceDifference = input.resolutionType === "NEW_ITEM" ? newItemValue - refundValue : -refundValue;
  const creditOwedToClient = priceDifference < 0 ? Math.abs(priceDifference) : 0;
  if (creditOwedToClient > 0 && !originalSaleItem.sale.clientId) {
    return fail(res, 409, "CLIENT_REQUIRED_FOR_CREDIT", "A venda original não tem cliente identificado; não é possível emitir crédito de loja sem saber a quem creditar.");
  }

  const result = await prisma
    .$transaction(async (tx) => {
      // 1) Reentrada no estoque da variante (ou produto, se NONE) devolvida.
      if (returnedVariantId) {
        await tx.productVariant.update({ where: { id: returnedVariantId }, data: { stockQuantity: { increment: input.returnedQuantity } } });
      }
      await tx.product.update({ where: { id: originalSaleItem.productId! }, data: { stockQuantity: { increment: input.returnedQuantity } } });
      await tx.stockMovement.create({
        data: {
          tenantId,
          productId: originalSaleItem.productId!,
          type: "RETURN",
          quantity: input.returnedQuantity,
          reasonCode: `EXCHANGE_${input.reasonCode}`,
          referenceId: returnedVariantId ?? originalSaleItem.id,
        },
      });

      // 2) Baixa do item novo (resolução NEW_ITEM), com claim atômico de estoque.
      if (input.resolutionType === "NEW_ITEM" && newVariant) {
        const claimed = await tx.productVariant.updateMany({
          where: { id: newVariant.id, tenantId, stockQuantity: { gte: input.newQuantity! } },
          data: { stockQuantity: { decrement: input.newQuantity! } },
        });
        if (claimed.count === 0) {
          throw new InsufficientNewVariantStockError("Saldo insuficiente da variante escolhida para o item novo da troca.");
        }
        await tx.product.update({ where: { id: newVariant.productId }, data: { stockQuantity: { decrement: input.newQuantity! } } });
        await tx.stockMovement.create({
          data: {
            tenantId,
            productId: newVariant.productId,
            type: "SALE_OUT",
            quantity: new Prisma.Decimal(input.newQuantity!).neg(),
            reasonCode: "EXCHANGE_NEW_ITEM",
            referenceId: newVariant.id,
          },
        });
      }

      // 3) Crédito de loja, se a resolução gerar saldo a favor do cliente.
      if (creditOwedToClient > 0) {
        await tx.client.update({ where: { id: originalSaleItem.sale.clientId! }, data: { storeCreditBalance: { increment: creditOwedToClient } } });
      }

      const exchange = await tx.productExchange.create({
        data: {
          tenantId,
          originalSaleItemId: originalSaleItem.id,
          returnedVariantId,
          returnedQuantity: input.returnedQuantity,
          reasonCode: input.reasonCode,
          resolutionType: input.resolutionType,
          newVariantId: newVariant?.id ?? null,
          newQuantity: input.resolutionType === "NEW_ITEM" ? input.newQuantity : null,
          refundValue,
          priceDifference: input.resolutionType === "NEW_ITEM" ? priceDifference : null,
          storeCreditIssued: creditOwedToClient > 0 ? creditOwedToClient : null,
          processedByUserId: userId,
        },
      });

      if (creditOwedToClient > 0) {
        await tx.storeCreditTransaction.create({
          data: {
            tenantId,
            clientId: originalSaleItem.sale.clientId!,
            direction: "ISSUED",
            amount: creditOwedToClient,
            exchangeId: exchange.id,
            note: input.resolutionType === "STORE_CREDIT" ? "Crédito de loja por troca" : "Diferença a favor do cliente na troca",
            createdByUserId: userId,
          },
        });
      }

      return exchange;
    })
    .catch((e) => {
      if (e instanceof InsufficientNewVariantStockError) return null;
      throw e;
    });

  if (!result) return fail(res, 409, "INSUFFICIENT_STOCK", "Saldo insuficiente da variante escolhida para o item novo da troca.");

  const amountDue = priceDifference > 0 ? priceDifference : 0;
  return res.status(201).json({ success: true, data: { exchange: result, amountDue }, error: null });
});

const linkSaleSchema = z.object({ saleId: z.string().min(1) });

// Vincula a venda fechada à parte (cobrindo a diferença de preço positiva de uma
// troca NEW_ITEM) ao registro da troca, para rastreabilidade fiscal completa
// (Capítulo 11.4). Só preenche uma vez — nunca sobrescreve um vínculo já gravado.
productExchangesRouter.patch("/product-exchanges/:id/link-sale", requireAuth, async (req: Request, res: Response) => {
  if (!(await guard(req, res, "write"))) return;
  const { tenantId } = req.session!;
  const parsed = linkSaleSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "VALIDATION_ERROR", "Dados inválidos.", parsed.error.flatten());

  const exchange = await prisma.productExchange.findFirst({ where: { id: req.params.id, tenantId } });
  if (!exchange) return fail(res, 404, "NOT_FOUND", "Troca não encontrada.");
  if (exchange.resultingSaleId) return fail(res, 409, "ALREADY_LINKED", "Esta troca já está vinculada a uma venda.");

  const sale = await prisma.sale.findFirst({ where: { id: parsed.data.saleId, tenantId, status: "PAID" }, select: { id: true } });
  if (!sale) return fail(res, 404, "SALE_NOT_FOUND", "Venda não encontrada ou não está paga.");

  const updated = await prisma.productExchange.update({ where: { id: exchange.id }, data: { resultingSaleId: sale.id } });
  return res.json({ success: true, data: updated, error: null });
});

productExchangesRouter.get("/product-exchanges", requireAuth, async (req: Request, res: Response) => {
  if (!(await guard(req, res, "read"))) return;
  const { tenantId } = req.session!;
  const exchanges = await prisma.productExchange.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return res.json({ success: true, data: exchanges, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// CRÉDITO DE LOJA (saldo + extrato + resgate manual)
// ─────────────────────────────────────────────────────────────────────────

productExchangesRouter.get("/clients/:clientId/store-credit", requireAuth, async (req: Request, res: Response) => {
  if (!(await guard(req, res, "read"))) return;
  const { tenantId } = req.session!;
  const client = await prisma.client.findFirst({ where: { id: req.params.clientId, tenantId }, select: { id: true, name: true, storeCreditBalance: true } });
  if (!client) return fail(res, 404, "NOT_FOUND", "Cliente não encontrado.");
  const transactions = await prisma.storeCreditTransaction.findMany({
    where: { tenantId, clientId: client.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return res.json({ success: true, data: { client, transactions }, error: null });
});

const redeemSchema = z.object({
  amount: z.number().positive(),
  saleId: z.string().min(1).nullable().optional(),
  note: z.string().trim().max(200).nullable().optional(),
});

// Resgate hoje é lançado manualmente pelo caixa (desconto aplicado "de cabeça" na
// venda em andamento e confirmado aqui) — nenhuma UI de PDV aplica o crédito como
// forma de pagamento automaticamente ainda (gap documentado no fechamento desta
// rodada, mesmo precedente usado em farmácia/Rodada 5 para fluxo pós-venda real).
productExchangesRouter.post("/clients/:clientId/store-credit/redeem", requireAuth, async (req: Request, res: Response) => {
  if (!(await guard(req, res, "write"))) return;
  const { tenantId, userId } = req.session!;
  const parsed = redeemSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "VALIDATION_ERROR", "Dados inválidos.", parsed.error.flatten());

  const client = await prisma.client.findFirst({ where: { id: req.params.clientId, tenantId }, select: { id: true, storeCreditBalance: true } });
  if (!client) return fail(res, 404, "NOT_FOUND", "Cliente não encontrado.");

  const result = await prisma.$transaction(async (tx) => {
    const claimed = await tx.client.updateMany({
      where: { id: client.id, tenantId, storeCreditBalance: { gte: parsed.data.amount } },
      data: { storeCreditBalance: { decrement: parsed.data.amount } },
    });
    if (claimed.count === 0) return null;
    return tx.storeCreditTransaction.create({
      data: {
        tenantId,
        clientId: client.id,
        direction: "REDEEMED",
        amount: parsed.data.amount,
        redeemedInSaleId: parsed.data.saleId ?? null,
        note: parsed.data.note ?? null,
        createdByUserId: userId,
      },
    });
  });

  if (!result) return fail(res, 409, "INSUFFICIENT_BALANCE", "Saldo de crédito de loja insuficiente para este resgate.");
  return res.status(201).json({ success: true, data: result, error: null });
});

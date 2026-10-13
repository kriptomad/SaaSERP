// apps/api/src/modules/integrations/ifood-webhook.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 11.1 (Lanchonete/Restaurante com Delivery
// e iFood) + Capítulo 20 (padrão de integrações do tenant). GAP DE AUDITORIA FECHADO
// (Rodada 6): nenhum webhook de marketplace existia — pedidos do iFood precisavam
// ser lançados manualmente no PDV, quebrando a premissa do Bible de que "o pedido
// injetado via marketplace iFood" é um canal de venda automático (`SaleChannel.DELIVERY_IFOOD`,
// já existente no schema).
//
// Protocolo real de assinatura do iFood (Portal do Parceiro, Central de Webhooks):
// HMAC-SHA256 sobre o corpo BRUTO da requisição usando o `clientSecret` OAuth do
// aplicativo do lojista, hex-encoded, enviado no header `X-IFood-Signature` —
// mesmo mecanismo documentado publicamente em developer.ifood.com.br/webhooks
// (não é um mock: a verificação abaixo é a implementação real do protocolo).
//
// PENDÊNCIA DOCUMENTADA: o payload normalizado abaixo (`ifoodOrderWebhookSchema`)
// reflete os campos que o lojista precisa mapear do evento real `ORDER_PLACED` do
// iFood (que tem um schema mais rico, proprietário, e não publicamente replicável
// em detalhe sem uma conta de parceiro homologada — mesma limitação documentada
// para o TEF SiTef na Rodada 5, `tef.routes.ts`); a normalização de campo-a-campo do
// payload real do iFood para este formato é responsabilidade do app do lojista no
// Portal do Parceiro (ou de um adapter futuro), não deste endpoint.
import { Router, Request, Response } from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { Prisma, prismaUnscoped as prisma } from "@filitech/db";
import { decryptEnvelope } from "../../lib/envelope-crypto";
import { calculateTax } from "../fiscal/tax-engine.service";
import { resolveTaxReformPhase } from "../fiscal/tax-reform-phase.service";

export const ifoodWebhookRouter = Router();

const ifoodOrderItemSchema = z.object({
  sku: z.string().min(1),
  quantity: z.number().positive(),
  unitPrice: z.number().positive(),
});

const ifoodOrderWebhookSchema = z.object({
  orderId: z.string().min(1),
  totalAmount: z.number().positive(),
  // Comissão de marketplace retida pelo iFood neste pedido (Capítulo 11.1) — vira
  // uma AccountPayable já paga (o iFood desconta no repasse, nunca uma cobrança
  // futura em aberto), vinculada à Sale de origem via `AccountPayable.saleId`.
  commissionAmount: z.number().min(0),
  items: z.array(ifoodOrderItemSchema).min(1),
});

async function findOrCreateIfoodSupplier(tenantId: string) {
  const existing = await prisma.supplier.findFirst({ where: { tenantId, document: "IFOOD-MARKETPLACE" } });
  if (existing) return existing;
  return prisma.supplier.create({
    data: { tenantId, name: "iFood (Marketplace)", document: "IFOOD-MARKETPLACE" },
  });
}

ifoodWebhookRouter.post("/webhooks/ifood/:tenantId", async (req: Request, res: Response) => {
  const { tenantId } = req.params;

  const credential = await prisma.integrationCredential.findUnique({
    where: { tenantId_provider_environment: { tenantId, provider: "MARKETPLACE_IFOOD", environment: "PRODUCTION" } },
  });
  if (!credential || !credential.active) {
    return res.status(404).json({ success: false, data: null, error: { code: "INTEGRATION_NOT_CONFIGURED", message: "Integração iFood não configurada ou inativa para este tenant." } });
  }

  const signatureHeader = req.headers["x-ifood-signature"];
  if (!signatureHeader || typeof signatureHeader !== "string") {
    return res.status(401).json({ success: false, data: null, error: { code: "MISSING_SIGNATURE", message: "Header X-IFood-Signature ausente." } });
  }

  // req.body aqui é o Buffer bruto (express.raw, ver server.ts) — obrigatório para a
  // verificação HMAC, nunca o corpo já parseado em JSON (mesmo motivo do webhook Stripe).
  const rawBody = req.body as Buffer;
  const { clientSecret } = decryptEnvelope(credential.encryptedPayload, credential.encryptionKeyId) as { clientSecret: string };
  const expectedSignature = crypto.createHmac("sha256", clientSecret).update(rawBody).digest("hex");

  const receivedBuf = Buffer.from(signatureHeader, "hex");
  const expectedBuf = Buffer.from(expectedSignature, "hex");
  const isValid = receivedBuf.length === expectedBuf.length && crypto.timingSafeEqual(receivedBuf, expectedBuf);
  if (!isValid) {
    return res.status(401).json({ success: false, data: null, error: { code: "INVALID_SIGNATURE", message: "Assinatura HMAC inválida." } });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return res.status(400).json({ success: false, data: null, error: { code: "INVALID_JSON", message: "Corpo da requisição não é um JSON válido." } });
  }

  const parsed = ifoodOrderWebhookSchema.safeParse(payload);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }

  // Capítulo 6.6 — "o fechamento de caixa consolida os três canais": uma venda
  // automática do marketplace só pode nascer vinculada a um caixa efetivamente
  // aberto no momento, exatamente como qualquer outra Sale (`cashRegisterId` é FK
  // obrigatória). Pedido chega com o estabelecimento sem caixa aberto -> 409
  // documentado, nunca criamos um caixa "fantasma" sem um operador responsável.
  const openCashRegister = await prisma.cashRegister.findFirst({ where: { tenantId, status: "OPEN" }, orderBy: { openedAt: "desc" } });
  if (!openCashRegister) {
    return res.status(409).json({ success: false, data: null, error: { code: "NO_OPEN_CASH_REGISTER", message: "Nenhum caixa aberto para registrar o pedido do iFood." } });
  }

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { taxRegime: true } });

        let legacyIcmsTotal = new Prisma.Decimal(0);
        let legacyPisCofinsTotal = new Prisma.Decimal(0);
        let ibsTotal = new Prisma.Decimal(0);
        let cbsTotal = new Prisma.Decimal(0);
        let selectiveTaxTotal = new Prisma.Decimal(0);
        const saleItemsData: Prisma.SaleItemCreateManySaleInput[] = [];

        for (const item of parsed.data.items) {
          const product = await tx.product.findFirst({ where: { tenantId, sku: item.sku } });
          if (!product) throw new Error(`UNKNOWN_SKU:${item.sku}`);

          await tx.product.update({ where: { id: product.id }, data: { stockQuantity: { decrement: item.quantity } } });
          await tx.stockMovement.create({
            data: { tenantId, productId: product.id, type: "SALE_OUT", quantity: new Prisma.Decimal(item.quantity).negated(), referenceId: parsed.data.orderId },
          });

          const lineGross = new Prisma.Decimal(item.unitPrice).times(item.quantity);
          const taxResult = await calculateTax(tx, {
            tenantId,
            ncm: product.ncm ?? "00000000",
            uf: product.originUf ?? "SP",
            nicheCode: product.nicheCode ?? "RESTAURANT",
            grossAmount: lineGross,
          });
          legacyIcmsTotal = legacyIcmsTotal.plus(taxResult.legacyIcmsAmount);
          legacyPisCofinsTotal = legacyPisCofinsTotal.plus(taxResult.legacyPisCofinsAmount);
          ibsTotal = ibsTotal.plus(taxResult.ibsAmount);
          cbsTotal = cbsTotal.plus(taxResult.cbsAmount);
          selectiveTaxTotal = selectiveTaxTotal.plus(taxResult.selectiveTaxAmount);

          saleItemsData.push({
            tenantId,
            productId: product.id,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: lineGross,
          });
        }

        const sale = await tx.sale.create({
          data: {
            tenantId,
            cashierId: openCashRegister.openedById,
            cashRegisterId: openCashRegister.id,
            idempotencyKey: `ifood:${parsed.data.orderId}`,
            paymentMethod: "MARKETPLACE",
            status: "PAID",
            channel: "DELIVERY_IFOOD",
            totalAmount: parsed.data.totalAmount,
            items: { createMany: { data: saleItemsData } },
          },
        });

        await tx.payment.create({
          data: {
            tenantId,
            saleId: sale.id,
            method: "MARKETPLACE",
            status: "CONFIRMED",
            amount: parsed.data.totalAmount,
            changeDue: new Prisma.Decimal(0),
            idempotencyKey: `ifood:${parsed.data.orderId}:payment`,
          },
        });

        const fiscalDocument = await tx.fiscalDocument.create({
          data: {
            tenantId,
            type: "NFCE",
            status: "PENDING",
            saleId: sale.id,
            legacyIcmsAmount: legacyIcmsTotal,
            legacyPisCofinsAmount: legacyPisCofinsTotal,
            ibsAmount: ibsTotal,
            cbsAmount: cbsTotal,
            selectiveTaxAmount: selectiveTaxTotal,
            totalTaxesApprox: legacyIcmsTotal.plus(legacyPisCofinsTotal).plus(ibsTotal).plus(cbsTotal).plus(selectiveTaxTotal),
            taxRegimeSnapshot: tenant.taxRegime,
            faseReformaTributaria: resolveTaxReformPhase(new Date()),
          },
        });

        // Capítulo 11.1 — comissão de marketplace registrada como despesa financeira
        // vinculada à Sale de origem (para cálculo de margem líquida por canal,
        // Capítulo 17.9) — status PAID porque o iFood já desconta no repasse
        // consolidado, nunca gera um boleto/cobrança futura em aberto.
        let marketplaceExpense = null;
        if (parsed.data.commissionAmount > 0) {
          const ifoodSupplier = await findOrCreateIfoodSupplier(tenantId);
          marketplaceExpense = await tx.accountPayable.create({
            data: {
              tenantId,
              supplierId: ifoodSupplier.id,
              saleId: sale.id,
              description: `Comissão iFood — pedido ${parsed.data.orderId}`,
              amount: parsed.data.commissionAmount,
              dueDate: new Date(),
              status: "PAID",
              paidAt: new Date(),
            },
          });
        }

        return { sale, fiscalDocument, marketplaceExpense };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return res.status(201).json({ success: true, data: result, error: null });
  } catch (err: any) {
    // Idempotência: reentrega do mesmo pedido (orderId já processado) nunca deve
    // criar uma segunda Sale — @@unique([tenantId, idempotencyKey]) é quem garante
    // isso estruturalmente; aqui só traduzimos a violação em uma resposta 200
    // "duplicate" (webhooks de provedor tratam qualquer erro como motivo de retry).
    if (err?.code === "P2002") {
      return res.json({ success: true, data: { duplicate: true }, error: null });
    }
    if (typeof err?.message === "string" && err.message.startsWith("UNKNOWN_SKU:")) {
      return res.status(422).json({ success: false, data: null, error: { code: "UNKNOWN_SKU", message: `SKU não cadastrado neste tenant: ${err.message.split(":")[1]}` } });
    }
    throw err;
  }
});

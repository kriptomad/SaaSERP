// apps/api/src/services/production/produce-recipe-batch.service.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 6.3 — Baixa de Ficha Técnica (BOM),
// padaria/confeitaria. Diferente do FEFO (disparado na venda), a baixa de insumos é
// disparada no momento da PRODUÇÃO (criação de um ProductionBatch), refletindo a
// realidade operacional: os insumos são consumidos na fornada, e o produto final fica
// em estoque pronto para venda como qualquer outro item — nunca descontado duas vezes
// (uma na produção, outra na venda).
// GAP DE AUDITORIA ENCONTRADO E CORRIGIDO: `ProductionBatch.quantityLost` e
// `ProductionBatchStatus.PARTIALLY_LOST` já existiam no schema, mas esta função nunca
// os usava — toda fornada era sempre marcada como totalmente `PRODUCED`, sem nenhum
// `StockMovement` tipo `LOSS`. O Capítulo 4.4 do Bible é explícito: "controle de
// perdas/quebras... crítico para a margem real". Apenas a quantidade líquida
// (produzida - perdida) entra de fato no estoque vendável; a quantidade perdida é
// registrada como um movimento `LOSS` (negativo) para alimentar o relatório gerencial
// de perdas, nunca incrementada no estoque do produto final.
import { Prisma, TenantScopedPrismaClient } from "@filitech/db";

interface ProduceRecipeBatchInput {
  tenantId: string;
  finishedProductId: string;
  quantityProduced: Prisma.Decimal;
  quantityLost?: Prisma.Decimal;
  lossReasonCode?: string;
  producedByUserId: string;
}

export class MissingIngredientStockError extends Error {}
export class InvalidLossQuantityError extends Error {}

export async function produceRecipeBatch(prisma: TenantScopedPrismaClient, input: ProduceRecipeBatchInput) {
  const quantityLost = input.quantityLost ?? new Prisma.Decimal(0);
  if (quantityLost.lessThan(0) || quantityLost.greaterThan(input.quantityProduced)) {
    throw new InvalidLossQuantityError("A quantidade perdida deve estar entre 0 e a quantidade produzida.");
  }

  return prisma.$transaction(
    async (tx) => {
      const recipe = await tx.recipe.findFirstOrThrow({
        where: { productId: input.finishedProductId, tenantId: input.tenantId },
        include: { items: { include: { ingredient: true } } },
      });

      const productionRatio = input.quantityProduced.dividedBy(recipe.yieldQuantity);

      for (const item of recipe.items) {
        const requiredQuantity = item.quantityPerYield.times(productionRatio);

        // Lock pessimista no insumo para evitar sobre-consumo em produções paralelas
        // (duas fornadas do mesmo insumo iniciadas ao mesmo tempo por operadores
        // diferentes não podem ambas "ver" o mesmo estoque disponível).
        const ingredient = await tx.$queryRaw<{ id: string; stockQuantity: Prisma.Decimal }[]>`
          SELECT id, "stockQuantity" FROM products
          WHERE id = ${item.ingredientId} AND "tenantId" = ${input.tenantId}
          FOR UPDATE
        `;

        if (!ingredient[0] || ingredient[0].stockQuantity.lessThan(requiredQuantity)) {
          throw new MissingIngredientStockError(
            `Insumo ${item.ingredientId} insuficiente para a fornada (necessário ${requiredQuantity.toString()}).`,
          );
        }

        await tx.product.update({
          where: { id: item.ingredientId },
          data: { stockQuantity: { decrement: requiredQuantity } },
        });

        await tx.stockMovement.create({
          data: {
            tenantId: input.tenantId,
            productId: item.ingredientId,
            type: "RECIPE_CONSUMPTION",
            quantity: requiredQuantity.negated(),
          },
        });
      }

      // Estoque vendável só recebe a quantidade líquida (produzida - perdida): uma
      // fornada que queimou metade não pode aparecer como estoque disponível.
      const netSellableQuantity = input.quantityProduced.sub(quantityLost);

      const productionBatch = await tx.productionBatch.create({
        data: {
          tenantId: input.tenantId,
          finishedProductId: input.finishedProductId,
          quantityProduced: input.quantityProduced,
          quantityLost,
          producedByUserId: input.producedByUserId,
          status: quantityLost.gt(0) ? "PARTIALLY_LOST" : "PRODUCED",
        },
      });

      if (netSellableQuantity.gt(0)) {
        await tx.product.update({
          where: { id: input.finishedProductId },
          data: { stockQuantity: { increment: netSellableQuantity } },
        });

        await tx.stockMovement.create({
          data: {
            tenantId: input.tenantId,
            productId: input.finishedProductId,
            type: "PRODUCTION_CONSUMPTION",
            quantity: netSellableQuantity,
            referenceId: productionBatch.id,
          },
        });
      }

      if (quantityLost.gt(0)) {
        // Movimento de perda/quebra (Capítulo 4.4) — nunca incrementado no estoque
        // vendável, apenas registrado para o relatório gerencial de perdas sobre
        // produção (% perda = quantityLost / quantityProduced).
        await tx.stockMovement.create({
          data: {
            tenantId: input.tenantId,
            productId: input.finishedProductId,
            type: "LOSS",
            quantity: quantityLost.negated(),
            reasonCode: input.lossReasonCode ?? "QUEBRA_PRODUCAO",
            referenceId: productionBatch.id,
          },
        });
      }

      return productionBatch;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

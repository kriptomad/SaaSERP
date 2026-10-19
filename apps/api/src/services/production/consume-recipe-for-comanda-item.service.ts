// apps/api/src/services/production/consume-recipe-for-comanda-item.service.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 11.1 (Lanchonete/Restaurante com Delivery
// e iFood): "o insumo é consumido na produção do prato" — ou seja, a baixa de
// insumos da Ficha Técnica (Recipe/RecipeItem) de um item de COMANDA precisa
// disparar no LANÇAMENTO do item (quando o prato é enviado para produção/cozinha),
// nunca apenas no fechamento fiscal da comanda (`comanda.routes.ts` já baixa
// `Product.stockQuantity` do PRATO em si no fechamento — baixa fiscal/contábil do
// produto final vendido — isso é independente e não duplica a baixa de insumos
// feita aqui).
// GAP DE AUDITORIA FECHADO (Rodada 6): nenhuma baixa de ficha técnica existia no
// fluxo de comanda — `Recipe`/`RecipeItem` só eram consumidos via
// `produceRecipeBatch` (Capítulo 6.3, padaria/confeitaria, fornada planejada).
// Reaproveita o mesmo padrão transacional (lock pessimista via `FOR UPDATE`,
// Serializable) para evitar sobre-consumo em lançamentos concorrentes do mesmo
// insumo por operadores diferentes.
import { Prisma, TenantScopedPrismaClient, TenantScopedTransactionClient } from "@filitech/db";

export class MissingIngredientStockError extends Error {}

interface ConsumeRecipeForComandaItemInput {
  tenantId: string;
  comandaItemId: string;
}

/**
 * Núcleo real da baixa de ficha técnica — recebe um client de transação JÁ ABERTO
 * (`tx`) e nunca abre uma transação própria. Todo chamador que já está dentro de
 * uma transação (ex.: `comanda.routes.ts`, que precisa criar o `ComandaItem` e
 * baixar o insumo atomicamente) DEVE usar este núcleo diretamente, nunca o wrapper
 * autônomo abaixo (Prisma não permite transações aninhadas).
 */
export async function consumeRecipeForComandaItemWithinTx(tx: TenantScopedTransactionClient, input: ConsumeRecipeForComandaItemInput) {
  const item = await tx.comandaItem.findFirstOrThrow({ where: { id: input.comandaItemId, tenantId: input.tenantId } });
  if (item.recipeConsumedAt) return { consumed: false as const, reason: "ALREADY_CONSUMED" as const };
  if (!item.productId) return { consumed: false as const, reason: "NOT_A_PRODUCT_ITEM" as const };

  const recipe = await tx.recipe.findUnique({
    where: { productId: item.productId },
    include: { items: true },
  });
  if (!recipe) return { consumed: false as const, reason: "NO_RECIPE" as const };

  const productionRatio = item.quantity.dividedBy(recipe.yieldQuantity);

  for (const recipeItem of recipe.items) {
    const requiredQuantity = recipeItem.quantityPerYield.times(productionRatio);

    // Lock pessimista no insumo — mesmo padrão de produce-recipe-batch.service.ts.
    const ingredient = await tx.$queryRaw<{ id: string; stockQuantity: Prisma.Decimal }[]>`
      SELECT id, "stockQuantity" FROM products
      WHERE id = ${recipeItem.ingredientId} AND "tenantId" = ${input.tenantId}
      FOR UPDATE
    `;

    if (!ingredient[0] || ingredient[0].stockQuantity.lessThan(requiredQuantity)) {
      throw new MissingIngredientStockError(
        `Insumo ${recipeItem.ingredientId} insuficiente para lançar este item (necessário ${requiredQuantity.toString()}).`,
      );
    }

    await tx.product.update({
      where: { id: recipeItem.ingredientId },
      data: { stockQuantity: { decrement: requiredQuantity } },
    });

    await tx.stockMovement.create({
      data: {
        tenantId: input.tenantId,
        productId: recipeItem.ingredientId,
        type: "RECIPE_CONSUMPTION",
        quantity: requiredQuantity.negated(),
        referenceId: item.id,
      },
    });
  }

  await tx.comandaItem.update({ where: { id: item.id }, data: { recipeConsumedAt: new Date() } });

  return { consumed: true as const };
}

/**
 * Baixa os insumos da Ficha Técnica (se existir) do produto lançado em um item de
 * comanda. Produtos sem Recipe cadastrada (ex.: refrigerante de lata revendido
 * pronto, sem ficha técnica) são ignorados silenciosamente — nem todo item de
 * comanda é um "prato produzido". Idempotente por item: se `recipeConsumedAt` já
 * estiver preenchido, não baixa novamente (protege contra reenvio/retry do
 * mesmo lançamento).
 *
 * Wrapper autônomo — abre sua própria transação Serializable. Usado apenas por
 * chamadores que ainda não estão dentro de uma transação. `comanda.routes.ts`
 * (criação do item + baixa de insumo precisam ser atômicas) usa
 * `consumeRecipeForComandaItemWithinTx` diretamente.
 */
export async function consumeRecipeForComandaItem(prisma: TenantScopedPrismaClient, input: ConsumeRecipeForComandaItemInput) {
  return prisma.$transaction((tx) => consumeRecipeForComandaItemWithinTx(tx, input), {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  });
}

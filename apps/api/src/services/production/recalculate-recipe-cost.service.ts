// apps/api/src/services/production/recalculate-recipe-cost.service.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 4.4 (Padaria/Confeitaria) — "custo do
// produto final recalculado automaticamente quando o preço de um insumo muda" (CMV
// sempre atualizado).
// GAP DE AUDITORIA ENCONTRADO E CORRIGIDO: `Product.costPrice` já era mantido por
// custo médio ponderado móvel no recebimento de Pedido de Compra
// (purchase-orders.routes.ts) e podia ser editado diretamente (products.routes.ts
// PATCH), mas NENHUM dos dois pontos propagava o novo custo para o `costPrice` dos
// produtos finais que usam aquele insumo em uma `Recipe` — o CMV da padaria/
// confeitaria ficava desatualizado sempre que o preço de uma matéria-prima mudava.
// Hook aditivo: chamado depois que `Product.costPrice` de um insumo já foi
// persistido, nunca substitui a lógica de custeio existente.
import { Prisma, TenantScopedTransactionClient } from "@filitech/db";

type TxOrClient = TenantScopedTransactionClient;

/**
 * Recalcula `Product.costPrice` do produto final de uma ficha técnica a partir do
 * custo atual de cada insumo: soma(quantityPerYield * ingrediente.costPrice) /
 * yieldQuantity. Insumos sem `costPrice` cadastrado entram como custo zero (nunca
 * bloqueia o recálculo — é preferível um CMV subestimado e visível a travar a
 * operação da padaria).
 */
export async function recalculateRecipeCost(tx: TxOrClient, recipeId: string): Promise<Prisma.Decimal> {
  const recipe = await tx.recipe.findUniqueOrThrow({
    where: { id: recipeId },
    include: { items: { include: { ingredient: { select: { costPrice: true } } } } },
  });

  const totalCost = recipe.items.reduce(
    (sum, item) => sum.add(item.quantityPerYield.mul(item.ingredient.costPrice ?? new Prisma.Decimal(0))),
    new Prisma.Decimal(0),
  );
  const newCostPrice = recipe.yieldQuantity.gt(0) ? totalCost.div(recipe.yieldQuantity) : new Prisma.Decimal(0);

  await tx.product.update({ where: { id: recipe.productId }, data: { costPrice: newCostPrice } });
  return newCostPrice;
}

/**
 * Dispara o recálculo de todas as fichas técnicas que usam `ingredientId` como
 * insumo. Chame logo após persistir um novo `Product.costPrice` para esse insumo
 * (recebimento de compra, edição manual de custo, etc.).
 */
export async function recalculateRecipeCostsForIngredient(tx: TxOrClient, tenantId: string, ingredientId: string): Promise<void> {
  const affectedRecipes = await tx.recipeItem.findMany({
    where: { ingredientId, tenantId },
    select: { recipeId: true },
    distinct: ["recipeId"],
  });

  for (const { recipeId } of affectedRecipes) {
    await recalculateRecipeCost(tx, recipeId);
  }
}

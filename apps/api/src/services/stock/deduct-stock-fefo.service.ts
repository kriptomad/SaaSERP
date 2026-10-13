// apps/api/src/services/stock/deduct-stock-fefo.service.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 6.2 — Algoritmo FEFO (First-Expire-First-Out),
// farmácia/validade. Usa SELECT ... FOR UPDATE dentro de uma transação Serializable
// para bloquear fisicamente os lotes candidatos até o commit, evitando duas vendas
// simultâneas deduzirem do mesmo lote (race condition) e bloqueando qualquer lote
// já vencido (risco sanitário — compliance ANVISA).
import { Prisma, PrismaClient } from "@filitech/db";

interface DeductStockFefoInput {
  tenantId: string;
  productId: string;
  quantity: Prisma.Decimal;
  saleItemId: string;
}

export class ExpiredBatchBlockedError extends Error {}
export class InsufficientStockError extends Error {}

// Núcleo real da dedução FEFO — recebe um client de transação JÁ ABERTO (`tx`) e nunca
// abre uma transação própria (Prisma não permite transações aninhadas: `tx.$transaction`
// não existe no tipo do client interativo). Todo chamador que já está dentro de uma
// transação (como closeSale, Capítulo 6.6) DEVE usar este núcleo diretamente, nunca o
// wrapper autônomo abaixo.
export async function deductStockFefoWithinTx(tx: Prisma.TransactionClient, input: DeductStockFefoInput) {
  // Lock pessimista nos lotes candidatos, ordenados pela validade mais próxima.
  // Raw query necessária pois Prisma não expõe FOR UPDATE nativamente.
  const batches = await tx.$queryRaw<{ id: string; quantity: Prisma.Decimal; expirationDate: Date }[]>`
    SELECT id, quantity, "expirationDate"
    FROM product_batches
    WHERE "tenantId" = ${input.tenantId}
      AND "productId" = ${input.productId}
      AND quantity > 0
      AND "expirationDate" > NOW()
    ORDER BY "expirationDate" ASC
    FOR UPDATE
  `;

  let remaining = input.quantity;
  const movements: { batchId: string; quantityTaken: Prisma.Decimal }[] = [];

  for (const batch of batches) {
    if (remaining.lessThanOrEqualTo(0)) break;
    const quantityTaken = Prisma.Decimal.min(batch.quantity, remaining);

    await tx.productBatch.update({
      where: { id: batch.id },
      data: { quantity: { decrement: quantityTaken } },
    });

    await tx.stockMovement.create({
      data: {
        tenantId: input.tenantId,
        productId: input.productId,
        productBatchId: batch.id,
        type: "SALE_OUT",
        quantity: quantityTaken.negated(),
        referenceId: input.saleItemId,
      },
    });

    movements.push({ batchId: batch.id, quantityTaken });
    remaining = remaining.minus(quantityTaken);
  }

  if (remaining.greaterThan(0)) {
    // Rollback automático: nenhum lote vencido é considerado, mesmo que exista
    // fisicamente em prateleira. A exceção interrompe a transação inteira.
    throw new InsufficientStockError(
      `Estoque insuficiente dentro da validade para o produto ${input.productId}. Faltam ${remaining.toString()} unidades.`,
    );
  }

  await tx.product.update({
    where: { id: input.productId },
    data: { stockQuantity: { decrement: input.quantity } },
  });

  return movements;
}

// Wrapper autônomo — abre sua própria transação Serializable. Usado apenas por
// chamadores que ainda não estão dentro de uma transação (ex.: um ajuste manual de
// estoque disparado isoladamente pelo painel). Qualquer chamador já dentro de uma
// transação (como closeSale, Capítulo 6.6) usa deductStockFefoWithinTx diretamente.
export async function deductStockFefo(prisma: PrismaClient, input: DeductStockFefoInput) {
  return prisma.$transaction((tx) => deductStockFefoWithinTx(tx, input), {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  });
}

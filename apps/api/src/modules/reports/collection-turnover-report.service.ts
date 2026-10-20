// apps/api/src/modules/reports/collection-turnover-report.service.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 11.4 (Loja de Roupas/Moda) — "cada Product
// carrega uma tag de coleção/estação (ex.: 'Verão 2026'), permitindo relatórios de
// giro por coleção e disparo de liquidação automática para referências com baixo
// giro antes da troca de estação." GAP DE AUDITORIA FECHADO: nem o campo
// (`Product.collectionTag`, adicionado nesta mesma rodada) nem o relatório existiam.
// Reaproveita o mesmo padrão de agregação de `abc-curve-report.service.ts`
// (groupBy SaleItem→Product, filtrado por Sale.status=PAID/createdAt).
import { Prisma, TenantScopedPrismaClient } from "@filitech/db";

export interface CollectionProductRow {
  productId: string;
  productName: string;
  sku: string;
  collectionTag: string;
  quantitySold: string;
  revenue: string;
  currentStock: string;
  // Vendeu menos que CLEARANCE_RATIO da média de giro da própria coleção E ainda tem
  // saldo em estoque — candidato a liquidação antes da troca de estação (Cap. 11.4).
  isClearanceCandidate: boolean;
}

export interface CollectionSummaryRow {
  collectionTag: string;
  productCount: number;
  totalQuantitySold: string;
  totalRevenue: string;
  avgQuantitySoldPerProduct: number;
  clearanceCandidateCount: number;
}

export interface CollectionTurnoverReport {
  periodDays: number;
  since: string;
  collections: CollectionSummaryRow[];
  products: CollectionProductRow[];
}

// Produto vendeu menos de 40% da média de giro da própria coleção — limiar
// conservador (decisão de escopo documentada): sinaliza candidatos reais a
// liquidação sem gerar falso-positivo para itens só um pouco abaixo da média.
const CLEARANCE_RATIO = 0.4;

export async function buildCollectionTurnoverReport(
  prisma: TenantScopedPrismaClient,
  tenantId: string,
  days: number,
): Promise<CollectionTurnoverReport> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // fa-w6-di-reports-no-snapshot-isolation — o catálogo (`Product.findMany`) e as
  // vendas agregadas (`SaleItem.groupBy`) eram lidos em duas transações implícitas
  // separadas: um produto cujo estoque mudasse (ou que fosse desativado) entre as
  // duas leituras podia aparecer com `currentStock`/presença inconsistente com o que
  // `grouped` já capturou. `REPEATABLE READ` fixa um único snapshot para as duas
  // leituras deste relatório.
  const { products, soldById } = await prisma.$transaction(
    async (tx) => {
      const productRows = await tx.product.findMany({
        where: { tenantId, active: true, collectionTag: { not: null } },
        select: { id: true, name: true, sku: true, collectionTag: true, stockQuantity: true },
      });
      if (productRows.length === 0) {
        return { products: productRows, soldById: new Map<string, { productId: string | null; _sum: { totalPrice: Prisma.Decimal | null; quantity: Prisma.Decimal | null } }>() };
      }
      const productIds = productRows.map((p) => p.id);
      const groupedRows = await tx.saleItem.groupBy({
        by: ["productId"],
        where: {
          tenantId,
          productId: { in: productIds },
          sale: { status: "PAID", createdAt: { gte: since } },
        },
        _sum: { totalPrice: true, quantity: true },
      });
      return { products: productRows, soldById: new Map(groupedRows.map((g) => [g.productId!, g])) };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  if (products.length === 0) {
    return { periodDays: days, since: since.toISOString(), collections: [], products: [] };
  }

  // Primeira passada: acumula total vendido/faturado por coleção (necessário para
  // calcular a média ANTES de classificar cada produto individualmente na segunda).
  const byCollection = new Map<string, { qty: Prisma.Decimal; revenue: Prisma.Decimal; count: number }>();
  for (const p of products) {
    const tag = p.collectionTag!;
    const sold = soldById.get(p.id);
    const qty = sold?._sum.quantity ?? new Prisma.Decimal(0);
    const revenue = sold?._sum.totalPrice ?? new Prisma.Decimal(0);
    const entry = byCollection.get(tag) ?? { qty: new Prisma.Decimal(0), revenue: new Prisma.Decimal(0), count: 0 };
    entry.qty = entry.qty.plus(qty);
    entry.revenue = entry.revenue.plus(revenue);
    entry.count += 1;
    byCollection.set(tag, entry);
  }

  const avgByCollection = new Map<string, number>();
  for (const [tag, agg] of byCollection) {
    avgByCollection.set(tag, agg.count > 0 ? agg.qty.toNumber() / agg.count : 0);
  }

  const productRows: CollectionProductRow[] = products.map((p) => {
    const sold = soldById.get(p.id);
    const quantitySold = sold?._sum.quantity ?? new Prisma.Decimal(0);
    const revenue = sold?._sum.totalPrice ?? new Prisma.Decimal(0);
    const avg = avgByCollection.get(p.collectionTag!) ?? 0;
    const isClearanceCandidate = p.stockQuantity.gt(0) && avg > 0 && quantitySold.toNumber() < avg * CLEARANCE_RATIO;
    return {
      productId: p.id,
      productName: p.name,
      sku: p.sku,
      collectionTag: p.collectionTag!,
      quantitySold: quantitySold.toString(),
      revenue: revenue.toString(),
      currentStock: p.stockQuantity.toString(),
      isClearanceCandidate,
    };
  });

  const collections: CollectionSummaryRow[] = Array.from(byCollection.entries())
    .map(([tag, agg]) => ({
      collectionTag: tag,
      productCount: agg.count,
      totalQuantitySold: agg.qty.toString(),
      totalRevenue: agg.revenue.toString(),
      avgQuantitySoldPerProduct: avgByCollection.get(tag) ?? 0,
      clearanceCandidateCount: productRows.filter((r) => r.collectionTag === tag && r.isClearanceCandidate).length,
    }))
    .sort((a, b) => Number(b.totalRevenue) - Number(a.totalRevenue));

  productRows.sort(
    (a, b) => a.collectionTag.localeCompare(b.collectionTag) || Number(b.quantitySold) - Number(a.quantitySold),
  );

  return { periodDays: days, since: since.toISOString(), collections, products: productRows };
}

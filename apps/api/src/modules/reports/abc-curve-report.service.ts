// apps/api/src/modules/reports/abc-curve-report.service.ts
// Fonte: pesquisa de mercado (varejo de conveniência Brasil) complementar ao Bible —
// Capítulo 4.1/18 não cita literalmente "Curva ABC", mas é a régua gerencial mais
// citada no setor (classificação de produtos por participação acumulada no
// faturamento: Classe A ~20% dos itens / ~80% do faturamento, B ~15%, C os ~5%
// restantes) e complementa diretamente a dor de ruptura de estoque já endereçada em
// reorder-suggestions.ts. Implementado como relatório dedicado (não via
// DATASET_REGISTRY genérico) porque exige JOIN SaleItem→Product, que o motor
// self-service ainda não suporta (limitação documentada em dataset-registry.ts).
import { Prisma, PrismaClient } from "@filitech/db";

export interface AbcCurveRow {
  productId: string;
  productName: string;
  category: string | null;
  quantitySold: string;
  revenue: string;
  revenueShare: number; // participação deste produto no faturamento total do período (0–1)
  cumulativeShare: number; // participação acumulada até este produto, ordenado por faturamento desc
  abcClass: "A" | "B" | "C";
}

// Cortes clássicos da Curva ABC de varejo: A até 80% acumulado, B até 95%, C o restante.
const CLASS_A_CUTOFF = 0.8;
const CLASS_B_CUTOFF = 0.95;

export async function buildAbcCurveReport(prisma: PrismaClient, tenantId: string, days: number): Promise<AbcCurveRow[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const grouped = await prisma.saleItem.groupBy({
    by: ["productId"],
    where: {
      tenantId,
      productId: { not: null },
      sale: { status: "PAID", createdAt: { gte: since } },
    },
    _sum: { totalPrice: true, quantity: true },
  });

  if (grouped.length === 0) return [];

  const productIds = grouped.map((g) => g.productId!).filter(Boolean);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, tenantId },
    select: { id: true, name: true, category: true },
  });
  const productById = new Map(products.map((p) => [p.id, p]));

  const totalRevenue = grouped.reduce((sum, g) => sum.plus(g._sum.totalPrice ?? new Prisma.Decimal(0)), new Prisma.Decimal(0));

  const sorted = grouped
    .map((g) => ({
      productId: g.productId!,
      product: productById.get(g.productId!),
      revenue: g._sum.totalPrice ?? new Prisma.Decimal(0),
      quantitySold: g._sum.quantity ?? new Prisma.Decimal(0),
    }))
    .sort((a, b) => b.revenue.cmp(a.revenue));

  let cumulative = new Prisma.Decimal(0);
  return sorted.map((row) => {
    cumulative = cumulative.plus(row.revenue);
    const revenueShare = totalRevenue.gt(0) ? row.revenue.div(totalRevenue).toNumber() : 0;
    const cumulativeShare = totalRevenue.gt(0) ? cumulative.div(totalRevenue).toNumber() : 0;
    const abcClass: "A" | "B" | "C" = cumulativeShare <= CLASS_A_CUTOFF ? "A" : cumulativeShare <= CLASS_B_CUTOFF ? "B" : "C";
    return {
      productId: row.productId,
      productName: row.product?.name ?? "Produto removido",
      category: row.product?.category ?? null,
      quantitySold: row.quantitySold.toString(),
      revenue: row.revenue.toString(),
      revenueShare,
      cumulativeShare,
      abcClass,
    };
  });
}

// Capítulo 11.4 — Loja de Roupas/Moda: "a classificação ABC é calculada por
// combinação cor/tamanho, não pelo modelo agregado — permitindo identificar que 'a
// camisa X vende bem, mas só no tamanho M', informação perdida em sistemas que não
// controlam por grade." GAP DE AUDITORIA FECHADO: `buildAbcCurveReport` acima agrupa
// por `Product` (correto para nichos sem grade), mas para VARIANT a Curva ABC
// precisa agrupar por `ProductVariant` — função dedicada em vez de parametrizar a
// anterior, pois o JOIN/agregação muda de entidade (SaleItem.productVariantId em vez
// de SaleItem.productId), mesma decisão de design do `variant-turnover.routes.ts`.
export interface AbcCurveVariantRow {
  variantId: string;
  productId: string;
  productName: string;
  axis: string;
  axisValue: string;
  quantitySold: string;
  revenue: string;
  revenueShare: number;
  cumulativeShare: number;
  abcClass: "A" | "B" | "C";
}

export async function buildVariantAbcCurveReport(prisma: PrismaClient, tenantId: string, days: number): Promise<AbcCurveVariantRow[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const grouped = await prisma.saleItem.groupBy({
    by: ["productVariantId"],
    where: {
      tenantId,
      productVariantId: { not: null },
      sale: { status: "PAID", createdAt: { gte: since } },
    },
    _sum: { totalPrice: true, quantity: true },
  });

  if (grouped.length === 0) return [];

  const variantIds = grouped.map((g) => g.productVariantId!).filter(Boolean);
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: variantIds }, tenantId },
    select: { id: true, axisValue: true, productId: true, axis: { select: { name: true } }, product: { select: { name: true } } },
  });
  const variantById = new Map(variants.map((v) => [v.id, v]));

  const totalRevenue = grouped.reduce((sum, g) => sum.plus(g._sum.totalPrice ?? new Prisma.Decimal(0)), new Prisma.Decimal(0));

  const sorted = grouped
    .map((g) => ({
      variantId: g.productVariantId!,
      variant: variantById.get(g.productVariantId!),
      revenue: g._sum.totalPrice ?? new Prisma.Decimal(0),
      quantitySold: g._sum.quantity ?? new Prisma.Decimal(0),
    }))
    .sort((a, b) => b.revenue.cmp(a.revenue));

  let cumulative = new Prisma.Decimal(0);
  return sorted.map((row) => {
    cumulative = cumulative.plus(row.revenue);
    const revenueShare = totalRevenue.gt(0) ? row.revenue.div(totalRevenue).toNumber() : 0;
    const cumulativeShare = totalRevenue.gt(0) ? cumulative.div(totalRevenue).toNumber() : 0;
    const abcClass: "A" | "B" | "C" = cumulativeShare <= CLASS_A_CUTOFF ? "A" : cumulativeShare <= CLASS_B_CUTOFF ? "B" : "C";
    return {
      variantId: row.variantId,
      productId: row.variant?.productId ?? "",
      productName: row.variant?.product?.name ?? "Variante removida",
      axis: row.variant?.axis?.name ?? "—",
      axisValue: row.variant?.axisValue ?? "—",
      quantitySold: row.quantitySold.toString(),
      revenue: row.revenue.toString(),
      revenueShare,
      cumulativeShare,
      abcClass,
    };
  });
}

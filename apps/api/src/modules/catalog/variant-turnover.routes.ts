// apps/api/src/modules/catalog/variant-turnover.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 4.6 — Varejo Geral: "Grades de variação
// (Cor/Tamanho): cada ProductVariant tem seu próprio código de barras e saldo de
// estoque... permitindo relatórios agregados por produto-pai e detalhados por
// variante." GAP DE AUDITORIA ENCONTRADO: grades/variantes já tinham CRUD maduro
// (product-variants.routes.ts) e PDV já baixava o saldo por variante corretamente
// (close-sale.service.ts), mas o relatório gerencial citado explicitamente no
// enunciado do nicho — giro de estoque por grade/variante — nunca existiu.
//
// Pesquisa (Capítulo 4.6 prosa + Sebrae): giro de estoque "ideal" no varejo geral
// brasileiro varia muito por categoria (alta rotatividade: 8-12x/ano; bens
// duráveis/semiduráveis: 2-4x/ano) e é sempre lido junto da Curva ABC (20% dos SKUs
// = ~80% do valor movimentado). CORREÇÃO DE AUDITORIA (mocks/stubs round 2): a
// classificação ABC clássica por corte de percentual acumulado de faturamento
// (Pareto: A até 80%, B até 95%, C o restante) está implementada e calculada em
// tempo real a cada chamada — não há mais pendência de "classes A/B/C não
// implementadas". Variantes sem venda no período são sempre classe C.
//
// Fatos do schema REAL que moldam a query:
//   - `StockMovement` NÃO tem campo de variante (ver nota em product-variants.routes.ts)
//     — giro por variante não pode vir do ledger de estoque, só da baixa real em
//     `SaleItem.productVariantId` (gravada desde a correção de auditoria documentada
//     em close-sale.service.ts) comparada ao saldo atual em `ProductVariant.stockQuantity`.
//   - Período filtra por `Sale.createdAt` (SaleItem não tem campo de data próprio) e
//     por `Sale.status = "PAID"` (nunca inclui carrinho aberto/estornado no giro).
import { Router, Request, Response } from "express";
import { prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";
import { requireModule } from "../../middlewares/gatekeeper.middleware";

export const variantTurnoverRouter = Router();

async function hasPermission(role: string, userId: string, permissionCode: string): Promise<boolean> {
  const [defaultGrant, override] = await Promise.all([
    prisma.roleDefaultPermission.findUnique({ where: { role_permissionCode: { role: role as any, permissionCode } } }),
    prisma.rolePermission.findUnique({ where: { userId_permission: { userId, permission: permissionCode } } }),
  ]);
  return override ? override.granted : Boolean(defaultGrant);
}

const fail = (res: Response, status: number, code: string, message: string) =>
  res.status(status).json({ success: false, data: null, error: { code, message } });

variantTurnoverRouter.get("/product-variants/turnover-report", requireAuth, requireModule("FASHION_VARIANTS"), async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "stock:product:read"))) {
    return fail(res, 403, "FORBIDDEN", "Seu nível de acesso não permite consultar relatórios de estoque.");
  }

  const rawPeriodDays = Number(req.query.periodDays ?? 30);
  const periodDays = Number.isFinite(rawPeriodDays) && rawPeriodDays > 0 ? Math.min(Math.trunc(rawPeriodDays), 365) : 30;
  const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

  const variants = await prisma.productVariant.findMany({
    where: { tenantId },
    select: {
      id: true,
      axisValue: true,
      barcode: true,
      stockQuantity: true,
      axis: { select: { name: true } },
      product: { select: { id: true, name: true, sku: true } },
    },
  });

  // SaleItem não tem data própria — o período é filtrado pela Sale (venda) pai.
  const soldItems = await prisma.saleItem.findMany({
    where: {
      tenantId,
      productVariantId: { not: null },
      sale: { status: "PAID", createdAt: { gte: since } },
    },
    select: { productVariantId: true, quantity: true, totalPrice: true },
  });

  const soldByVariant = new Map<string, number>();
  const revenueByVariant = new Map<string, number>();
  for (const item of soldItems) {
    if (!item.productVariantId) continue;
    soldByVariant.set(item.productVariantId, (soldByVariant.get(item.productVariantId) ?? 0) + Number(item.quantity));
    revenueByVariant.set(item.productVariantId, (revenueByVariant.get(item.productVariantId) ?? 0) + Number(item.totalPrice));
  }

  const report = variants.map((variant) => {
    const quantitySold = soldByVariant.get(variant.id) ?? 0;
    const revenueSold = revenueByVariant.get(variant.id) ?? 0;
    const currentStock = Number(variant.stockQuantity);
    // Giro = vendido / estoque médio no período; sem histórico de saldo diário,
    // usa-se o saldo atual como proxy do estoque médio (mesma limitação documentada
    // no restante do módulo de estoque por variante — StockMovement não guarda
    // variante). Estoque zerado com venda no período → giro "infinito" sinalizado
    // como null (não representável), nunca uma divisão por zero silenciosa.
    const turnoverRatio = currentStock > 0 ? quantitySold / currentStock : quantitySold > 0 ? null : 0;
    return {
      variantId: variant.id,
      productId: variant.product.id,
      productName: variant.product.name,
      sku: variant.product.sku,
      axis: variant.axis.name,
      axisValue: variant.axisValue,
      barcode: variant.barcode,
      quantitySold,
      revenueSold,
      currentStock: variant.stockQuantity,
      turnoverRatio,
    };
  });

  // Ordenado por faturamento no período (desc) — base padrão da Curva ABC clássica
  // (Pareto: valor movimentado, não quantidade — dois itens podem vender a mesma
  // quantidade com tickets muito diferentes).
  report.sort((a, b) => b.revenueSold - a.revenueSold);

  // CORREÇÃO DE AUDITORIA (mocks/stubs round): a Curva ABC era apenas citada em texto
  // ("classes A/B/C ainda não implementadas") sem nenhuma classificação persistida ou
  // calculada. Implementa a classificação clássica por corte de percentual acumulado de
  // faturamento (Pareto): A = até 80% acumulado, B = até 95% acumulado, C = restante.
  // Variantes sem nenhuma venda no período (revenueSold = 0) são sempre classe C —
  // não participam do corte de Pareto, que só faz sentido sobre o que de fato vendeu.
  const totalRevenue = report.reduce((sum, row) => sum + row.revenueSold, 0);
  let cumulativeRevenue = 0;
  const classified = report.map((row) => {
    if (row.revenueSold <= 0 || totalRevenue <= 0) {
      return { ...row, abcClass: "C" as const, cumulativeRevenuePct: null as number | null };
    }
    cumulativeRevenue += row.revenueSold;
    const cumulativePct = cumulativeRevenue / totalRevenue;
    const abcClass: "A" | "B" | "C" = cumulativePct <= 0.8 ? "A" : cumulativePct <= 0.95 ? "B" : "C";
    return { ...row, abcClass, cumulativeRevenuePct: cumulativePct };
  });

  return res.json({
    success: true,
    data: { periodDays, since: since.toISOString(), variants: classified },
    error: null,
  });
});

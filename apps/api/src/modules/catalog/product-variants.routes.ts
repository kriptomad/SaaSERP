// apps/api/src/modules/catalog/product-variants.routes.ts
// GAP DE AUDITORIA: `ProductVariantAxis`/`ProductVariant` existiam no schema (e `SaleItem.productVariantId`),
// sem nenhuma rota de cadastro. Permissões reaproveitadas: stock:product:read/write.
//
// Fatos do schema REAL que moldam este módulo:
//   - `@@unique([tenantId, productId, axisValue])`: o `axisValue` é único POR PRODUTO (não por eixo). Para
//     combinações multi-eixo use o valor composto, ex. "Azul/G".
//   - `@@unique([tenantId, barcode])`: código de barras de variante é único no tenant.
//   - `StockMovement` NÃO tem campo de variante; o saldo por variante vive só em `ProductVariant.stockQuantity`.
//     O ajuste de estoque aqui grava `StockMovement` com `referenceId = variantId` para trilha de auditoria.
//   - `SaleItem.productVariantId` não tem onDelete → variante já vendida jamais é excluída.
import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";
import { requireModule } from "../../middlewares/gatekeeper.middleware";

export const productVariantsRouter = Router();

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
  if (await hasPermission(role, userId, `stock:product:${action}`)) return true;
  fail(res, 403, "FORBIDDEN", action === "read" ? "Seu nível de acesso não permite consultar produtos." : "Seu nível de acesso não permite alterar produtos.");
  return false;
}

const isUnique = (e: any) => e?.code === "P2002";

// ─────────────────────────────────────────────────────────────────────────
// EIXOS ("Cor", "Tamanho")
// ─────────────────────────────────────────────────────────────────────────

productVariantsRouter.get("/products/:productId/variant-axes", requireAuth, requireModule("FASHION_VARIANTS"), async (req: Request, res: Response) => {
  if (!(await guard(req, res, "read"))) return;
  const { tenantId } = req.session!;
  const product = await prisma.product.findFirst({ where: { id: req.params.productId, tenantId }, select: { id: true } });
  if (!product) return fail(res, 404, "NOT_FOUND", "Produto não encontrado.");
  const axes = await prisma.productVariantAxis.findMany({
    where: { tenantId, productId: product.id },
    include: { _count: { select: { variants: true } } },
    orderBy: { name: "asc" },
  });
  return res.json({ success: true, data: axes, error: null });
});

const axisSchema = z.object({ name: z.string().trim().min(1).max(60) });

productVariantsRouter.post("/products/:productId/variant-axes", requireAuth, requireModule("FASHION_VARIANTS"), async (req: Request, res: Response) => {
  if (!(await guard(req, res, "write"))) return;
  const { tenantId } = req.session!;
  const parsed = axisSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "VALIDATION_ERROR", "Dados inválidos.", parsed.error.flatten());
  const product = await prisma.product.findFirst({ where: { id: req.params.productId, tenantId }, select: { id: true } });
  if (!product) return fail(res, 404, "NOT_FOUND", "Produto não encontrado.");
  try {
    const axis = await prisma.productVariantAxis.create({ data: { tenantId, productId: product.id, name: parsed.data.name } });
    return res.status(201).json({ success: true, data: axis, error: null });
  } catch (e) {
    if (isUnique(e)) return fail(res, 409, "AXIS_NAME_TAKEN", "Este produto já possui um eixo com esse nome.");
    throw e;
  }
});

productVariantsRouter.patch("/variant-axes/:axisId", requireAuth, requireModule("FASHION_VARIANTS"), async (req: Request, res: Response) => {
  if (!(await guard(req, res, "write"))) return;
  const { tenantId } = req.session!;
  const parsed = axisSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "VALIDATION_ERROR", "Dados inválidos.", parsed.error.flatten());
  const axis = await prisma.productVariantAxis.findFirst({ where: { id: req.params.axisId, tenantId } });
  if (!axis) return fail(res, 404, "NOT_FOUND", "Eixo não encontrado.");
  try {
    const updated = await prisma.productVariantAxis.update({ where: { id: axis.id }, data: { name: parsed.data.name } });
    return res.json({ success: true, data: updated, error: null });
  } catch (e) {
    if (isUnique(e)) return fail(res, 409, "AXIS_NAME_TAKEN", "Este produto já possui um eixo com esse nome.");
    throw e;
  }
});

// A exclusão do eixo cascateia para as variantes (onDelete: Cascade) — só é seguro sem venda e sem saldo.
productVariantsRouter.delete("/variant-axes/:axisId", requireAuth, requireModule("FASHION_VARIANTS"), async (req: Request, res: Response) => {
  if (!(await guard(req, res, "write"))) return;
  const { tenantId } = req.session!;
  const axis = await prisma.productVariantAxis.findFirst({ where: { id: req.params.axisId, tenantId } });
  if (!axis) return fail(res, 404, "NOT_FOUND", "Eixo não encontrado.");

  const [sold, withStock] = await Promise.all([
    prisma.saleItem.count({ where: { tenantId, productVariant: { axisId: axis.id } } }),
    prisma.productVariant.count({ where: { tenantId, axisId: axis.id, stockQuantity: { not: 0 } } }),
  ]);
  if (sold > 0) return fail(res, 409, "AXIS_HAS_SALES", "Há variantes deste eixo já vendidas; o eixo não pode ser excluído.");
  if (withStock > 0) return fail(res, 409, "AXIS_HAS_STOCK", "Há variantes deste eixo com saldo em estoque; zere o estoque antes de excluir.");

  await prisma.productVariantAxis.delete({ where: { id: axis.id } });
  return res.json({ success: true, data: { id: axis.id }, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// VARIANTES (combinações)
// ─────────────────────────────────────────────────────────────────────────

productVariantsRouter.get("/products/:productId/variants", requireAuth, requireModule("FASHION_VARIANTS"), async (req: Request, res: Response) => {
  if (!(await guard(req, res, "read"))) return;
  const { tenantId } = req.session!;
  const product = await prisma.product.findFirst({ where: { id: req.params.productId, tenantId }, select: { id: true } });
  if (!product) return fail(res, 404, "NOT_FOUND", "Produto não encontrado.");
  const variants = await prisma.productVariant.findMany({
    where: { tenantId, productId: product.id },
    include: { axis: { select: { id: true, name: true } } },
    orderBy: [{ axis: { name: "asc" } }, { axisValue: "asc" }],
  });
  return res.json({ success: true, data: variants, error: null });
});

const variantCreateSchema = z.object({
  axisId: z.string().min(1),
  axisValue: z.string().trim().min(1).max(80),
  barcode: z.string().trim().min(1).nullable().optional(),
  priceOverride: z.number().nonnegative().nullable().optional(),
});

// Barcode de variante não pode colidir com o de um Product (a leitura no PDV ficaria ambígua).
async function barcodeClash(tenantId: string, barcode: string, exceptVariantId?: string): Promise<boolean> {
  const [product, variant] = await Promise.all([
    prisma.product.findFirst({ where: { tenantId, barcode }, select: { id: true } }),
    prisma.productVariant.findFirst({ where: { tenantId, barcode, ...(exceptVariantId ? { id: { not: exceptVariantId } } : {}) }, select: { id: true } }),
  ]);
  return Boolean(product || variant);
}

productVariantsRouter.post("/products/:productId/variants", requireAuth, requireModule("FASHION_VARIANTS"), async (req: Request, res: Response) => {
  if (!(await guard(req, res, "write"))) return;
  const { tenantId } = req.session!;
  const parsed = variantCreateSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "VALIDATION_ERROR", "Dados inválidos.", parsed.error.flatten());
  const input = parsed.data;

  const product = await prisma.product.findFirst({ where: { id: req.params.productId, tenantId }, select: { id: true } });
  if (!product) return fail(res, 404, "NOT_FOUND", "Produto não encontrado.");
  const axis = await prisma.productVariantAxis.findFirst({ where: { id: input.axisId, tenantId, productId: product.id }, select: { id: true } });
  if (!axis) return fail(res, 404, "AXIS_NOT_FOUND", "Eixo não pertence a este produto.");
  if (input.barcode && (await barcodeClash(tenantId, input.barcode))) {
    return fail(res, 409, "BARCODE_TAKEN", "Este código de barras já está em uso por outro produto/variante.");
  }
  try {
    // O saldo nasce em 0: entrada de estoque passa pelo ajuste auditado (POST /product-variants/:id/stock-adjust).
    const variant = await prisma.productVariant.create({
      data: { tenantId, productId: product.id, axisId: axis.id, axisValue: input.axisValue, barcode: input.barcode ?? null, priceOverride: input.priceOverride ?? null },
    });
    return res.status(201).json({ success: true, data: variant, error: null });
  } catch (e) {
    if (isUnique(e)) return fail(res, 409, "VARIANT_TAKEN", "Já existe uma variante com esse valor (ou código de barras) neste produto.");
    throw e;
  }
});

const variantPatchSchema = z.object({
  axisValue: z.string().trim().min(1).max(80).optional(),
  barcode: z.string().trim().min(1).nullable().optional(),
  priceOverride: z.number().nonnegative().nullable().optional(),
});

productVariantsRouter.patch("/product-variants/:variantId", requireAuth, requireModule("FASHION_VARIANTS"), async (req: Request, res: Response) => {
  if (!(await guard(req, res, "write"))) return;
  const { tenantId } = req.session!;
  const parsed = variantPatchSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "VALIDATION_ERROR", "Dados inválidos.", parsed.error.flatten());
  const variant = await prisma.productVariant.findFirst({ where: { id: req.params.variantId, tenantId } });
  if (!variant) return fail(res, 404, "NOT_FOUND", "Variante não encontrada.");
  if (parsed.data.barcode && (await barcodeClash(tenantId, parsed.data.barcode, variant.id))) {
    return fail(res, 409, "BARCODE_TAKEN", "Este código de barras já está em uso por outro produto/variante.");
  }
  try {
    const updated = await prisma.productVariant.update({ where: { id: variant.id }, data: parsed.data });
    return res.json({ success: true, data: updated, error: null });
  } catch (e) {
    if (isUnique(e)) return fail(res, 409, "VARIANT_TAKEN", "Já existe uma variante com esse valor (ou código de barras) neste produto.");
    throw e;
  }
});

productVariantsRouter.delete("/product-variants/:variantId", requireAuth, requireModule("FASHION_VARIANTS"), async (req: Request, res: Response) => {
  if (!(await guard(req, res, "write"))) return;
  const { tenantId } = req.session!;
  const variant = await prisma.productVariant.findFirst({ where: { id: req.params.variantId, tenantId } });
  if (!variant) return fail(res, 404, "NOT_FOUND", "Variante não encontrada.");
  if (!variant.stockQuantity.isZero()) return fail(res, 409, "VARIANT_HAS_STOCK", "A variante tem saldo em estoque; zere-o antes de excluir.");
  if ((await prisma.saleItem.count({ where: { tenantId, productVariantId: variant.id } })) > 0) {
    return fail(res, 409, "VARIANT_HAS_SALES", "A variante já foi vendida e não pode ser excluída (histórico fiscal/financeiro).");
  }
  await prisma.productVariant.delete({ where: { id: variant.id } });
  return res.json({ success: true, data: { id: variant.id }, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// ESTOQUE POR VARIANTE
// ─────────────────────────────────────────────────────────────────────────

// Capítulo 11.4 — "consulta rápida de saldo por variante diretamente no app do
// vendedor de chão de loja (não apenas no caixa), evitando levar ao provador uma
// peça sem estoque confirmado da cor/tamanho pedido." GAP DE AUDITORIA FECHADO:
// as rotas de saldo por variante já existiam, mas todas exigiam conhecer o
// `productId`/`variantId` de antemão (abrir o produto primeiro); esta rota busca
// direto por nome/SKU/EAN do produto OU pelo valor do eixo (ex.: "M", "40"),
// devolvendo o saldo de cada variante já no primeiro resultado — sem o dialog
// completo de edição de produto. Limitado a 20 produtos/80 variantes por busca.
productVariantsRouter.get("/product-variants/quick-search", requireAuth, requireModule("FASHION_VARIANTS"), async (req: Request, res: Response) => {
  if (!(await guard(req, res, "read"))) return;
  const { tenantId } = req.session!;
  const term = String(req.query.q ?? "").trim();
  if (term.length < 1) return fail(res, 400, "VALIDATION_ERROR", "Informe ao menos 1 caractere para buscar.");

  const products = await prisma.product.findMany({
    where: {
      tenantId,
      active: true,
      trackingType: "VARIANT",
      OR: [
        { name: { contains: term, mode: "insensitive" } },
        { sku: { contains: term, mode: "insensitive" } },
        { barcode: { contains: term, mode: "insensitive" } },
        { variants: { some: { axisValue: { contains: term, mode: "insensitive" } } } },
      ],
    },
    select: { id: true, name: true, sku: true },
    take: 20,
  });
  if (products.length === 0) return res.json({ success: true, data: [], error: null });

  const variants = await prisma.productVariant.findMany({
    where: { tenantId, productId: { in: products.map((p) => p.id) } },
    include: { axis: { select: { name: true } } },
    orderBy: { axisValue: "asc" },
    take: 80,
  });
  const productById = new Map(products.map((p) => [p.id, p]));

  const results = variants.map((v) => ({
    variantId: v.id,
    productId: v.productId,
    productName: productById.get(v.productId)?.name ?? "",
    sku: productById.get(v.productId)?.sku ?? "",
    axis: v.axis.name,
    axisValue: v.axisValue,
    barcode: v.barcode,
    stockQuantity: v.stockQuantity,
  }));

  return res.json({ success: true, data: results, error: null });
});

productVariantsRouter.get("/products/:productId/variants/stock", requireAuth, requireModule("FASHION_VARIANTS"), async (req: Request, res: Response) => {
  if (!(await guard(req, res, "read"))) return;
  const { tenantId } = req.session!;
  const product = await prisma.product.findFirst({
    where: { id: req.params.productId, tenantId },
    select: { id: true, name: true, sku: true, unitPrice: true, stockQuantity: true },
  });
  if (!product) return fail(res, 404, "NOT_FOUND", "Produto não encontrado.");
  const variants = await prisma.productVariant.findMany({
    where: { tenantId, productId: product.id },
    include: { axis: { select: { name: true } } },
    orderBy: { axisValue: "asc" },
  });
  const totalVariantStock = variants.reduce((acc, v) => acc + Number(v.stockQuantity), 0);
  return res.json({
    success: true,
    data: {
      product,
      totalVariantStock,
      variants: variants.map((v) => ({
        id: v.id,
        axis: v.axis.name,
        axisValue: v.axisValue,
        barcode: v.barcode,
        stockQuantity: v.stockQuantity,
        effectivePrice: v.priceOverride ?? product.unitPrice,
      })),
    },
    error: null,
  });
});

productVariantsRouter.get("/product-variants/:variantId/stock", requireAuth, requireModule("FASHION_VARIANTS"), async (req: Request, res: Response) => {
  if (!(await guard(req, res, "read"))) return;
  const { tenantId } = req.session!;
  const variant = await prisma.productVariant.findFirst({
    where: { id: req.params.variantId, tenantId },
    include: { axis: { select: { name: true } }, product: { select: { id: true, name: true, sku: true, unitPrice: true } } },
  });
  if (!variant) return fail(res, 404, "NOT_FOUND", "Variante não encontrada.");
  const recentMovements = await prisma.stockMovement.findMany({
    where: { tenantId, productId: variant.productId, referenceId: variant.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return res.json({
    success: true,
    data: {
      id: variant.id,
      product: variant.product,
      axis: variant.axis.name,
      axisValue: variant.axisValue,
      barcode: variant.barcode,
      stockQuantity: variant.stockQuantity,
      effectivePrice: variant.priceOverride ?? variant.product.unitPrice,
      recentMovements,
    },
    error: null,
  });
});

const stockAdjustSchema = z.object({
  quantityDelta: z.number().refine((n) => n !== 0, "O ajuste não pode ser zero."),
  reasonCode: z.string().trim().min(2).max(60),
});

// Só produtos sem rastreio (trackingType NONE): lote/serial têm saldo próprio e divergiriam do saldo da variante.
productVariantsRouter.post("/product-variants/:variantId/stock-adjust", requireAuth, requireModule("FASHION_VARIANTS"), async (req: Request, res: Response) => {
  const { tenantId } = req.session!;
  if (!(await hasPermission(req.session!.role, req.session!.userId, "stock:movement:write"))) {
    return fail(res, 403, "FORBIDDEN", "Seu nível de acesso não permite ajustar estoque.");
  }
  if (!(await guard(req, res, "write"))) return;
  const parsed = stockAdjustSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "VALIDATION_ERROR", "Dados inválidos.", parsed.error.flatten());
  const { quantityDelta, reasonCode } = parsed.data;

  const variant = await prisma.productVariant.findFirst({ where: { id: req.params.variantId, tenantId }, include: { product: { select: { trackingType: true } } } });
  if (!variant) return fail(res, 404, "NOT_FOUND", "Variante não encontrada.");
  if (variant.product.trackingType !== "NONE") {
    return fail(res, 409, "TRACKED_PRODUCT", "Produtos com rastreio de lote/serial não suportam saldo por variante.");
  }

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.productVariant.updateMany({
      where: { id: variant.id, tenantId, ...(quantityDelta < 0 ? { stockQuantity: { gte: -quantityDelta } } : {}) },
      data: { stockQuantity: { increment: quantityDelta } },
    });
    if (updated.count === 0) return null;
    await tx.product.update({ where: { id: variant.productId }, data: { stockQuantity: { increment: quantityDelta } } });
    await tx.stockMovement.create({
      data: {
        tenantId,
        productId: variant.productId,
        type: quantityDelta < 0 ? "LOSS" : "ADJUSTMENT",
        quantity: quantityDelta,
        reasonCode,
        referenceId: variant.id,
      },
    });
    return tx.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
  });

  if (!result) return fail(res, 409, "INSUFFICIENT_STOCK", "Saldo da variante insuficiente para este ajuste negativo.");
  return res.status(201).json({ success: true, data: result, error: null });
});

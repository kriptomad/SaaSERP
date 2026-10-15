// apps/api/src/modules/products/products.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 5 (schema `Product`) + Capítulo 8.3 (o PDV
// Offline-First precisa de uma fonte real de catálogo para materializar em Dexie).
// GAP DE AUDITORIA ENCONTRADO E CORRIGIDO: o `Product` existe no schema desde o
// início do projeto, mas nenhuma rota REST jamais foi escrita para ele — o PDV
// offline não tinha de onde sincronizar o catálogo. Esta é a implementação real,
// tenant-scoped, protegida por "stock:product:read"/"stock:product:write"
// (já existentes na matriz RBAC do seed, nunca usados por nenhuma rota até agora).
import { Router, Request, Response } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";
import { decodeScaleBarcode } from "../../lib/scale-barcode";
import { recalculateRecipeCostsForIngredient } from "../../services/production/recalculate-recipe-cost.service";

export const productsRouter = Router();

async function hasPermission(role: string, userId: string, permissionCode: string): Promise<boolean> {
  const [defaultGrant, override] = await Promise.all([
    prisma.roleDefaultPermission.findUnique({ where: { role_permissionCode: { role: role as any, permissionCode } } }),
    prisma.rolePermission.findUnique({ where: { userId_permission: { userId, permission: permissionCode } } }),
  ]);
  return override ? override.granted : Boolean(defaultGrant);
}

/**
 * Lista de produtos ativos — usada tanto pela tela de cadastro quanto pela
 * sincronização inicial/periódica do catálogo Dexie do PDV offline-first (Capítulo 8.3).
 * `updatedSince` permite sync incremental: o cliente guarda o timestamp da última
 * sincronização bem-sucedida e só baixa o delta, em vez de re-baixar o catálogo
 * inteiro a cada reconexão.
 */
productsRouter.get("/products", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "stock:product:read"))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite consultar produtos." } });
  }

  const updatedSince = typeof req.query.updatedSince === "string" ? new Date(req.query.updatedSince) : null;

  const products = await prisma.product.findMany({
    where: {
      tenantId,
      active: true,
      ...(updatedSince && !Number.isNaN(updatedSince.getTime()) ? { updatedAt: { gt: updatedSince } } : {}),
    },
    orderBy: { name: "asc" },
    select: {
      id: true,
      sku: true,
      barcode: true,
      name: true,
      description: true,
      category: true,
      unitPrice: true,
      wholesalePrice: true,
      wholesaleMinQty: true,
      stockQuantity: true,
      trackingType: true,
      isWeighted: true,
      ncm: true,
      collectionTag: true,
      saleUnit: true,
      purchaseUnit: true,
      unitConversionFactor: true,
      isKitComposition: true,
      requiresPrescriptionRetention: true,
      isControlledSubstance: true,
      updatedAt: true,
    },
  });

  return res.json({ success: true, data: products, error: null });
});

/**
 * Lookup de escaneamento do PDV (Capítulo 4.1/20.7 — balanças Toledo/Filizola): aceita
 * tanto um código de barras comum (match exato por `Product.barcode`) quanto um EAN-13
 * de peso variável (prefixo "2", payload de peso embutido). Quando o payload decodifica
 * com sucesso, o `internalCode` de 5 dígitos é usado para localizar o produto pesável e
 * o peso lido é devolvido como `scannedQuantityKg` — o PDV usa esse valor como
 * quantidade do item, nunca um preço eventualmente embutido no próprio código (o preço
 * final sempre vem de `Product.unitPrice`, já validado no catálogo do tenant).
 */
productsRouter.get("/products/scan/:barcode", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "stock:product:read"))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite consultar produtos." } });
  }

  const rawBarcode = req.params.barcode;
  const decoded = decodeScaleBarcode(rawBarcode);

  const product = await prisma.product.findFirst({
    where: { tenantId, active: true, barcode: decoded ? decoded.internalCode : rawBarcode },
  });

  if (!product) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Nenhum produto encontrado para este código de barras." } });
  }
  if (decoded && !product.isWeighted) {
    return res.status(409).json({ success: false, data: null, error: { code: "NOT_WEIGHTED_PRODUCT", message: "Código de balança lido, mas o produto correspondente não está marcado como pesável." } });
  }

  return res.json({ success: true, data: { product, scannedQuantityKg: decoded?.weightKg ?? null }, error: null });
});

productsRouter.get("/products/:id", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "stock:product:read"))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite consultar produtos." } });
  }

  const product = await prisma.product.findFirst({ where: { id: req.params.id, tenantId } });
  if (!product) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Produto não encontrado." } });
  }
  return res.json({ success: true, data: product, error: null });
});

const createProductSchema = z.object({
  sku: z.string().min(1),
  barcode: z.string().nullable().optional(),
  name: z.string().min(2),
  description: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  trackingType: z.enum(["NONE", "BATCH", "SERIAL", "VARIANT"]).default("NONE"),
  ncm: z.string().default("00000000"),
  originUf: z.string().length(2).nullable().optional(),
  // Tabela SEFAZ "Origem da Mercadoria" (Convênio ICMS 38/2013): "0" nacional, "1"/"2"
  // estrangeira, "3"-"8" conteúdo de importação — ver Product.icmsOrigin no schema.
  icmsOrigin: z.enum(["0", "1", "2", "3", "4", "5", "6", "7", "8"]).default("0"),
  nicheCode: z.string().nullable().optional(),
  // Capítulo 11.4 — Loja de Roupas/Moda: tag de coleção/estação (ex.: "Verão 2026").
  collectionTag: z.string().trim().min(1).max(60).nullable().optional(),
  unitPrice: z.number().positive(),
  wholesalePrice: z.number().positive().nullable().optional(),
  wholesaleMinQty: z.number().int().positive().nullable().optional(),
  costPrice: z.number().nonnegative().nullable().optional(),
  stockQuantity: z.number().nonnegative().default(0),
  minStockThreshold: z.number().nonnegative().nullable().optional(),
  isWeighted: z.boolean().default(false),
  supplierId: z.string().uuid().nullable().optional(),
  // Capítulo 11.8 — Material de Construção/Ferragens: unidade de compra (fechada) vs.
  // unidade de venda (fracionada) e fator de conversão entre as duas.
  saleUnit: z.enum(["UNIT", "KG", "METER", "SQUARE_METER", "CUBIC_METER", "LITER"]).optional(),
  purchaseUnit: z.string().trim().min(1).nullable().optional(),
  unitConversionFactor: z.number().positive().nullable().optional(),
  // Capítulo 11.5 — Papelaria/Presentes: kit escolar montado como composição de
  // outros produtos via Recipe/RecipeItem (PUT /products/:productId/recipe).
  isKitComposition: z.boolean().optional(),
});

productsRouter.post("/products", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "stock:product:write"))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite cadastrar produtos." } });
  }

  const parsed = createProductSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const input = parsed.data;

  const existingSku = await prisma.product.findFirst({ where: { tenantId, sku: input.sku } });
  if (existingSku) {
    return res.status(409).json({ success: false, data: null, error: { code: "SKU_TAKEN", message: "Já existe um produto com este SKU." } });
  }
  if (input.barcode) {
    const existingBarcode = await prisma.product.findFirst({ where: { tenantId, barcode: input.barcode } });
    if (existingBarcode) {
      return res.status(409).json({ success: false, data: null, error: { code: "BARCODE_TAKEN", message: "Já existe um produto com este código de barras." } });
    }
  }

  const product = await prisma.product.create({
    data: {
      tenantId,
      sku: input.sku,
      barcode: input.barcode ?? null,
      name: input.name,
      description: input.description ?? null,
      category: input.category ?? null,
      trackingType: input.trackingType,
      ncm: input.ncm,
      originUf: input.originUf ?? null,
      icmsOrigin: input.icmsOrigin,
      nicheCode: input.nicheCode ?? null,
      collectionTag: input.collectionTag ?? null,
      unitPrice: new Prisma.Decimal(input.unitPrice),
      wholesalePrice: input.wholesalePrice != null ? new Prisma.Decimal(input.wholesalePrice) : null,
      wholesaleMinQty: input.wholesaleMinQty ?? null,
      costPrice: input.costPrice != null ? new Prisma.Decimal(input.costPrice) : null,
      stockQuantity: new Prisma.Decimal(input.stockQuantity),
      minStockThreshold: input.minStockThreshold != null ? new Prisma.Decimal(input.minStockThreshold) : null,
      isWeighted: input.isWeighted,
      supplierId: input.supplierId ?? null,
      ...(input.saleUnit !== undefined ? { saleUnit: input.saleUnit } : {}),
      purchaseUnit: input.purchaseUnit ?? null,
      unitConversionFactor: input.unitConversionFactor != null ? new Prisma.Decimal(input.unitConversionFactor) : null,
      ...(input.isKitComposition !== undefined ? { isKitComposition: input.isKitComposition } : {}),
    },
  });

  return res.status(201).json({ success: true, data: product, error: null });
});

const updateProductSchema = createProductSchema.partial();

productsRouter.patch("/products/:id", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "stock:product:write"))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite editar produtos." } });
  }

  const existing = await prisma.product.findFirst({ where: { id: req.params.id, tenantId } });
  if (!existing) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Produto não encontrado." } });
  }

  const parsed = updateProductSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const input = parsed.data;

  const product = await prisma.$transaction(async (tx) => {
    const updated = await tx.product.update({
      where: { id: existing.id },
      data: {
        ...(input.sku !== undefined ? { sku: input.sku } : {}),
        ...(input.barcode !== undefined ? { barcode: input.barcode } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.trackingType !== undefined ? { trackingType: input.trackingType } : {}),
        ...(input.ncm !== undefined ? { ncm: input.ncm } : {}),
        ...(input.originUf !== undefined ? { originUf: input.originUf } : {}),
        ...(input.icmsOrigin !== undefined ? { icmsOrigin: input.icmsOrigin } : {}),
        ...(input.nicheCode !== undefined ? { nicheCode: input.nicheCode } : {}),
        ...(input.collectionTag !== undefined ? { collectionTag: input.collectionTag } : {}),
        ...(input.unitPrice !== undefined ? { unitPrice: new Prisma.Decimal(input.unitPrice) } : {}),
        ...(input.wholesalePrice !== undefined ? { wholesalePrice: input.wholesalePrice != null ? new Prisma.Decimal(input.wholesalePrice) : null } : {}),
        ...(input.wholesaleMinQty !== undefined ? { wholesaleMinQty: input.wholesaleMinQty } : {}),
        ...(input.costPrice !== undefined ? { costPrice: input.costPrice != null ? new Prisma.Decimal(input.costPrice) : null } : {}),
        ...(input.minStockThreshold !== undefined ? { minStockThreshold: input.minStockThreshold != null ? new Prisma.Decimal(input.minStockThreshold) : null } : {}),
        ...(input.isWeighted !== undefined ? { isWeighted: input.isWeighted } : {}),
        ...(input.supplierId !== undefined ? { supplierId: input.supplierId } : {}),
        ...(input.saleUnit !== undefined ? { saleUnit: input.saleUnit } : {}),
        ...(input.purchaseUnit !== undefined ? { purchaseUnit: input.purchaseUnit } : {}),
        ...(input.unitConversionFactor !== undefined
          ? { unitConversionFactor: input.unitConversionFactor != null ? new Prisma.Decimal(input.unitConversionFactor) : null }
          : {}),
        ...(input.isKitComposition !== undefined ? { isKitComposition: input.isKitComposition } : {}),
      },
    });

    // Padaria/Confeitaria (Capítulo 4.4) — edição manual do custo de um insumo
    // também precisa propagar para o CMV das fichas técnicas que o utilizam.
    if (input.costPrice !== undefined) {
      await recalculateRecipeCostsForIngredient(tx, tenantId, updated.id);
    }

    return updated;
  });

  return res.json({ success: true, data: product, error: null });
});

productsRouter.delete("/products/:id", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "stock:product:write"))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite remover produtos." } });
  }

  const existing = await prisma.product.findFirst({ where: { id: req.params.id, tenantId } });
  if (!existing) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Produto não encontrado." } });
  }

  // Nunca DELETE físico — um produto já vendido precisa permanecer referenciável por
  // SaleItem/StockMovement histórico (mesmo princípio de soft-delete do resto do
  // sistema). "Remover" aqui significa apenas sair da lista de produtos ativos/PDV.
  await prisma.product.update({ where: { id: existing.id }, data: { active: false } });

  return res.status(204).send();
});

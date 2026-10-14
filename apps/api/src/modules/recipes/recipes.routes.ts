// apps/api/src/modules/recipes/recipes.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 4.4 (Padaria/Confeitaria — Ficha
// Técnica/BOM) + Capítulo 6.3 (baixa transacional de insumos na produção).
// GAP DE AUDITORIA ENCONTRADO E CORRIGIDO: os modelos `Recipe`, `RecipeItem`,
// `ProductionBatch` existem no schema desde o início, e
// `apps/api/src/services/production/produce-recipe-batch.service.ts` já
// implementava a baixa transacional (lock pessimista + Serializable) dos
// insumos na produção, mas NENHUMA rota REST jamais existiu — o nicho de
// Padaria/Confeitaria inteiro (Capítulo 4.4) não tinha como cadastrar uma
// ficha técnica nem registrar uma fornada produzida.
// Reutiliza as permissões RBAC já seedadas "stock:product:read"/"write"
// (ficha técnica é uma propriedade do produto) para não introduzir um novo
// código de permissão não documentado em nenhum outro lugar do sistema.
import { Router, Request, Response } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";
import { produceRecipeBatch, MissingIngredientStockError, InvalidLossQuantityError } from "../../services/production/produce-recipe-batch.service";

export const recipesRouter = Router();

async function hasPermission(role: string, userId: string, permissionCode: string): Promise<boolean> {
  const [defaultGrant, override] = await Promise.all([
    prisma.roleDefaultPermission.findUnique({ where: { role_permissionCode: { role: role as any, permissionCode } } }),
    prisma.rolePermission.findUnique({ where: { userId_permission: { userId, permission: permissionCode } } }),
  ]);
  return override ? override.granted : Boolean(defaultGrant);
}

recipesRouter.get("/products/:productId/recipe", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "stock:product:read"))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite consultar fichas técnicas." } });
  }

  const recipe = await prisma.recipe.findFirst({
    where: { productId: req.params.productId, tenantId },
    include: { items: { include: { ingredient: true } } },
  });
  if (!recipe) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Este produto não possui ficha técnica cadastrada." } });
  }
  return res.json({ success: true, data: recipe, error: null });
});

const upsertRecipeSchema = z.object({
  yieldQuantity: z.number().positive(),
  items: z.array(
    z.object({
      ingredientId: z.string().uuid(),
      quantityPerYield: z.number().positive(),
    }),
  ).min(1),
});

/**
 * Substitui a ficha técnica inteira do produto (upsert + replace de itens).
 * Replace integral em vez de PATCH incremental: uma ficha técnica é sempre
 * editada como um todo pelo confeiteiro/gestor (ex.: tela única listando
 * todos os ingredientes), nunca item a item — evita o risco de o cliente
 * REST esquecer de remover um ingrediente antigo que não existe mais.
 */
recipesRouter.put("/products/:productId/recipe", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "stock:product:write"))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite editar fichas técnicas." } });
  }

  const product = await prisma.product.findFirst({ where: { id: req.params.productId, tenantId } });
  if (!product) {
    return res.status(404).json({ success: false, data: null, error: { code: "PRODUCT_NOT_FOUND", message: "Produto não encontrado." } });
  }

  const parsed = upsertRecipeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const input = parsed.data;

  const ingredientIds = input.items.map((item) => item.ingredientId);
  const ingredientCount = await prisma.product.count({ where: { id: { in: ingredientIds }, tenantId } });
  if (ingredientCount !== new Set(ingredientIds).size) {
    return res.status(400).json({ success: false, data: null, error: { code: "INVALID_INGREDIENT", message: "Um ou mais insumos informados não existem neste tenant." } });
  }

  const recipe = await prisma.$transaction(async (tx) => {
    const upserted = await tx.recipe.upsert({
      where: { productId: product.id },
      create: { tenantId, productId: product.id, yieldQuantity: input.yieldQuantity },
      update: { yieldQuantity: input.yieldQuantity },
    });

    await tx.recipeItem.deleteMany({ where: { recipeId: upserted.id } });
    await tx.recipeItem.createMany({
      data: input.items.map((item) => ({
        tenantId,
        recipeId: upserted.id,
        ingredientId: item.ingredientId,
        quantityPerYield: item.quantityPerYield,
      })),
    });

    return tx.recipe.findUniqueOrThrow({ where: { id: upserted.id }, include: { items: { include: { ingredient: true } } } });
  });

  return res.json({ success: true, data: recipe, error: null });
});

recipesRouter.get("/production-batches", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "stock:movement:read"))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite consultar fornadas de produção." } });
  }

  const finishedProductId = typeof req.query.finishedProductId === "string" ? req.query.finishedProductId : null;
  const batches = await prisma.productionBatch.findMany({
    where: { tenantId, ...(finishedProductId ? { finishedProductId } : {}) },
    include: { finishedProduct: true },
    orderBy: { producedAt: "desc" },
    take: 100,
  });

  return res.json({ success: true, data: batches, error: null });
});

const produceBatchSchema = z.object({
  finishedProductId: z.string().uuid(),
  quantityProduced: z.number().positive(),
  quantityLost: z.number().nonnegative().optional(),
  lossReasonCode: z.string().min(1).optional(),
});

/**
 * Registra uma fornada produzida: dispara a baixa transacional dos insumos
 * proporcional à ficha técnica (Capítulo 6.3) e incrementa o estoque do
 * produto acabado apenas com a quantidade líquida (produzida - perdida) — nunca
 * descontado de novo na venda (o produto acabado passa a se comportar como
 * qualquer item de catálogo normal a partir daqui). `quantityLost` registra
 * perdas/quebras (Capítulo 4.4) via `StockMovement` tipo `LOSS`.
 */
recipesRouter.post("/production-batches", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "stock:movement:write"))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite registrar produção." } });
  }

  const parsed = produceBatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const input = parsed.data;

  try {
    const batch = await produceRecipeBatch(prisma, {
      tenantId,
      finishedProductId: input.finishedProductId,
      quantityProduced: new Prisma.Decimal(input.quantityProduced),
      quantityLost: input.quantityLost != null ? new Prisma.Decimal(input.quantityLost) : undefined,
      lossReasonCode: input.lossReasonCode,
      producedByUserId: userId,
    });
    return res.status(201).json({ success: true, data: batch, error: null });
  } catch (error) {
    if (error instanceof MissingIngredientStockError) {
      return res.status(409).json({ success: false, data: null, error: { code: "MISSING_INGREDIENT_STOCK", message: error.message } });
    }
    if (error instanceof InvalidLossQuantityError) {
      return res.status(400).json({ success: false, data: null, error: { code: "INVALID_LOSS_QUANTITY", message: error.message } });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return res.status(404).json({ success: false, data: null, error: { code: "RECIPE_NOT_FOUND", message: "Este produto não possui ficha técnica cadastrada." } });
    }
    throw error;
  }
});

/**
 * Relatório gerencial de perdas/quebras sobre produção (Capítulo 4.4 — "crítico
 * para a margem real"): agrega, por produto acabado, o total produzido, o total
 * perdido e o percentual de perda no período. Pesquisa de mercado (CMV de
 * padaria 30%-38%, confeitaria 25%-33%, perda operacional saudável < 5%-6%)
 * confirma que este indicador não tinha nenhuma tela até aqui.
 */
recipesRouter.get("/production-batches/loss-report", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "stock:movement:read"))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite consultar o relatório de perdas." } });
  }

  const from = typeof req.query.from === "string" ? new Date(req.query.from) : null;
  const to = typeof req.query.to === "string" ? new Date(req.query.to) : null;

  const batches = await prisma.productionBatch.findMany({
    where: {
      tenantId,
      ...(from && !Number.isNaN(from.getTime()) ? { producedAt: { gte: from } } : {}),
      ...(to && !Number.isNaN(to.getTime()) ? { producedAt: { lte: to } } : {}),
    },
    include: { finishedProduct: { select: { id: true, name: true, sku: true } } },
  });

  const byProduct = new Map<string, { productId: string; productName: string; sku: string; totalProduced: Prisma.Decimal; totalLost: Prisma.Decimal; batchCount: number }>();
  for (const batch of batches) {
    const entry = byProduct.get(batch.finishedProductId) ?? {
      productId: batch.finishedProductId,
      productName: batch.finishedProduct.name,
      sku: batch.finishedProduct.sku,
      totalProduced: new Prisma.Decimal(0),
      totalLost: new Prisma.Decimal(0),
      batchCount: 0,
    };
    entry.totalProduced = entry.totalProduced.add(batch.quantityProduced);
    entry.totalLost = entry.totalLost.add(batch.quantityLost);
    entry.batchCount += 1;
    byProduct.set(batch.finishedProductId, entry);
  }

  const rows = Array.from(byProduct.values())
    .map((entry) => ({
      ...entry,
      totalProduced: entry.totalProduced.toString(),
      totalLost: entry.totalLost.toString(),
      lossPercentage: entry.totalProduced.gt(0) ? entry.totalLost.div(entry.totalProduced).mul(100).toNumber() : 0,
    }))
    .sort((a, b) => b.lossPercentage - a.lossPercentage);

  return res.json({ success: true, data: rows, error: null });
});

// apps/api/src/modules/stock/stock.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 4.5/6.1 (Farmácia — FEFO rigoroso,
// controle de Lote/Validade, compliance ANVISA) e Capítulo 4.2 (Assistência
// Técnica — controle por IMEI/Serial).
// GAP DE AUDITORIA ENCONTRADO E CORRIGIDO: os modelos `ProductBatch`,
// `ProductSerial` e `StockMovement` existem no schema desde o início, e
// `deduct-stock-fefo.service.ts` já implementava a DEDUÇÃO de lotes na venda
// (Capítulo 6.2), mas NENHUMA rota REST jamais existiu para a ENTRADA de
// lote/serial (recebimento de mercadoria) nem para consultar o histórico de
// movimentações — a farmácia não tinha como cadastrar um lote com validade
// recebido do fornecedor, e a assistência técnica não tinha como registrar
// o IMEI de um aparelho recebido.
// Reutiliza as permissões RBAC já seedadas "stock:product:read"/"write" para
// lote/serial (são propriedades físicas de um produto) e
// "stock:movement:read"/"write" (já seedadas e nunca usadas) para o
// extrato de movimentações.
import { Router, Request, Response } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";

export const stockRouter = Router();

async function hasPermission(role: string, userId: string, permissionCode: string): Promise<boolean> {
  const [defaultGrant, override] = await Promise.all([
    prisma.roleDefaultPermission.findUnique({ where: { role_permissionCode: { role: role as any, permissionCode } } }),
    prisma.rolePermission.findUnique({ where: { userId_permission: { userId, permission: permissionCode } } }),
  ]);
  return override ? override.granted : Boolean(defaultGrant);
}

stockRouter.get("/product-batches", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "stock:product:read"))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite consultar lotes." } });
  }

  const productId = typeof req.query.productId === "string" ? req.query.productId : null;
  const expiringOnly = req.query.expiringOnly === "true";

  const batches = await prisma.productBatch.findMany({
    where: {
      tenantId,
      ...(productId ? { productId } : {}),
      quantity: { gt: 0 },
      ...(expiringOnly ? { expirationDate: { lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) } } : {}),
    },
    orderBy: { expirationDate: "asc" },
    take: 200,
  });

  return res.json({ success: true, data: batches, error: null });
});

const createBatchSchema = z.object({
  productId: z.string().uuid(),
  batchNumber: z.string().min(1),
  manufacturingDate: z.string().datetime().nullable().optional(),
  expirationDate: z.string().datetime(),
  quantity: z.number().positive(),
  costPrice: z.number().nonnegative().nullable().optional(),
});

/**
 * Entrada de mercadoria em lote (compliance ANVISA, Capítulo 4.5): o lote só
 * passa a existir e contribuir para o estoque total do produto neste exato
 * momento, nunca retroativamente — espelha o recebimento físico real.
 * Transacional: cria o lote e incrementa `Product.stockQuantity` e o extrato
 * `StockMovement` atomicamente, para o total do produto nunca divergir da
 * soma dos lotes.
 */
stockRouter.post("/product-batches", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "stock:product:write"))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite registrar entrada de lote." } });
  }

  const parsed = createBatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const input = parsed.data;

  const product = await prisma.product.findFirst({ where: { id: input.productId, tenantId } });
  if (!product) {
    return res.status(404).json({ success: false, data: null, error: { code: "PRODUCT_NOT_FOUND", message: "Produto não encontrado." } });
  }
  if (new Date(input.expirationDate) <= new Date()) {
    return res.status(400).json({ success: false, data: null, error: { code: "EXPIRED_BATCH", message: "Não é possível registrar entrada de um lote já vencido." } });
  }

  try {
    const batch = await prisma.$transaction(async (tx) => {
      const created = await tx.productBatch.create({
        data: {
          tenantId,
          productId: input.productId,
          batchNumber: input.batchNumber,
          manufacturingDate: input.manufacturingDate ?? null,
          expirationDate: input.expirationDate,
          quantity: input.quantity,
          costPrice: input.costPrice ?? null,
        },
      });

      await tx.product.update({ where: { id: input.productId }, data: { stockQuantity: { increment: input.quantity } } });

      await tx.stockMovement.create({
        data: {
          tenantId,
          productId: input.productId,
          productBatchId: created.id,
          type: "PURCHASE_IN",
          quantity: input.quantity,
          referenceId: created.id,
        },
      });

      return created;
    });

    return res.status(201).json({ success: true, data: batch, error: null });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return res.status(409).json({ success: false, data: null, error: { code: "DUPLICATE_BATCH_NUMBER", message: "Já existe um lote com este número para este produto." } });
    }
    throw error;
  }
});

stockRouter.get("/product-serials", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "stock:product:read"))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite consultar números de série." } });
  }

  const productId = typeof req.query.productId === "string" ? req.query.productId : null;
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const imei = typeof req.query.imei === "string" ? req.query.imei : null;

  const serials = await prisma.productSerial.findMany({
    where: {
      tenantId,
      ...(productId ? { productId } : {}),
      ...(status ? { status } : {}),
      ...(imei ? { imei } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return res.json({ success: true, data: serials, error: null });
});

const createSerialSchema = z.object({
  productId: z.string().uuid(),
  serialNumber: z.string().min(1),
  imei: z.string().nullable().optional(),
});

/**
 * Registra um aparelho/item individual por número de série (ex.: celular
 * usado recebido na assistência técnica, Capítulo 4.2). Incrementa o estoque
 * em 1 unidade — cada registro é fisicamente uma única peça rastreável.
 */
stockRouter.post("/product-serials", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "stock:product:write"))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite registrar números de série." } });
  }

  const parsed = createSerialSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const input = parsed.data;

  const product = await prisma.product.findFirst({ where: { id: input.productId, tenantId } });
  if (!product) {
    return res.status(404).json({ success: false, data: null, error: { code: "PRODUCT_NOT_FOUND", message: "Produto não encontrado." } });
  }

  try {
    const serial = await prisma.$transaction(async (tx) => {
      const created = await tx.productSerial.create({
        data: {
          tenantId,
          productId: input.productId,
          serialNumber: input.serialNumber,
          imei: input.imei ?? null,
          status: "IN_STOCK",
        },
      });

      await tx.product.update({ where: { id: input.productId }, data: { stockQuantity: { increment: 1 } } });

      await tx.stockMovement.create({
        data: { tenantId, productId: input.productId, type: "PURCHASE_IN", quantity: 1, referenceId: created.id },
      });

      return created;
    });

    return res.status(201).json({ success: true, data: serial, error: null });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return res.status(409).json({ success: false, data: null, error: { code: "DUPLICATE_SERIAL", message: "Já existe um item com este número de série." } });
    }
    throw error;
  }
});

stockRouter.get("/stock-movements", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "stock:movement:read"))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite consultar o extrato de movimentações." } });
  }

  const productId = typeof req.query.productId === "string" ? req.query.productId : null;
  const typeRaw = typeof req.query.type === "string" ? req.query.type : null;
  const allowedTypes = new Set(["PURCHASE_IN", "SALE_OUT", "ADJUSTMENT", "RECIPE_CONSUMPTION", "PRODUCTION_CONSUMPTION", "LOSS", "RETURN"]);
  const type = typeRaw && allowedTypes.has(typeRaw) ? typeRaw : null;
  const page = Math.max(1, Number.parseInt(String(req.query.page ?? "1"), 10) || 1);
  const pageSize = Math.min(200, Math.max(1, Number.parseInt(String(req.query.pageSize ?? "50"), 10) || 50));

  const where = {
    tenantId,
    ...(productId ? { productId } : {}),
    ...(type ? { type: type as any } : {}),
  };

  const [movements, total] = await prisma.$transaction([
    prisma.stockMovement.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.stockMovement.count({ where }),
  ]);

  return res.json({ success: true, data: movements, error: null, meta: { page, pageSize, total } });
});

const adjustmentSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().refine((v) => v !== 0, "A quantidade do ajuste não pode ser zero."),
  reasonCode: z.string().min(1),
  productBatchId: z.string().uuid().optional(), // obrigatório para produtos com trackingType BATCH
});

/**
 * Ajuste manual de estoque (perda, quebra, inventário divergente) — exige
 * `reasonCode` obrigatório conforme o próprio comentário do schema
 * (`StockMovement.reasonCode`: "obrigatório para ADJUSTMENT e LOSS").
 * Quantidade positiva = entrada de ajuste; negativa = saída/perda.
 */
stockRouter.post("/stock-movements/adjustment", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "stock:movement:write"))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite lançar ajustes de estoque." } });
  }

  const parsed = adjustmentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const input = parsed.data;

  const product = await prisma.product.findFirst({ where: { id: input.productId, tenantId } });
  if (!product) {
    return res.status(404).json({ success: false, data: null, error: { code: "PRODUCT_NOT_FOUND", message: "Produto não encontrado." } });
  }

  // Produto rastreado por lote: o ajuste precisa incidir sobre um lote, senão Product.stockQuantity diverge da soma dos ProductBatch (consumida pelo FEFO).
  let batchId: string | undefined;
  if (product.trackingType === "BATCH") {
    if (!input.productBatchId) {
      return res.status(400).json({ success: false, data: null, error: { code: "BATCH_REQUIRED", message: "Informe productBatchId para ajustar estoque de produto controlado por lote." } });
    }
    const batch = await prisma.productBatch.findFirst({ where: { id: input.productBatchId, productId: product.id, tenantId } });
    if (!batch) {
      return res.status(404).json({ success: false, data: null, error: { code: "BATCH_NOT_FOUND", message: "Lote não encontrado." } });
    }
    batchId = batch.id;
  } else if (input.productBatchId) {
    return res.status(400).json({ success: false, data: null, error: { code: "BATCH_NOT_APPLICABLE", message: "Este produto não é controlado por lote." } });
  }

  let movement;
  try {
  movement = await prisma.$transaction(async (tx) => {
    if (batchId) {
      if (input.quantity < 0) {
        const claimed = await tx.productBatch.updateMany({ where: { id: batchId, tenantId, quantity: { gte: -input.quantity } }, data: { quantity: { decrement: -input.quantity } } });
        if (claimed.count === 0) throw new Error("BATCH_INSUFFICIENT_QUANTITY");
      } else {
        await tx.productBatch.update({ where: { id: batchId }, data: { quantity: { increment: input.quantity } } });
      }
    }
    const created = await tx.stockMovement.create({
      data: {
        tenantId,
        productId: input.productId,
        productBatchId: batchId,
        type: input.quantity < 0 ? "LOSS" : "ADJUSTMENT",
        quantity: input.quantity,
        reasonCode: input.reasonCode,
      },
    });
    await tx.product.update({ where: { id: input.productId }, data: { stockQuantity: { increment: input.quantity } } });
    return created;
  });
  } catch (error) {
    if (error instanceof Error && error.message === "BATCH_INSUFFICIENT_QUANTITY") {
      return res.status(409).json({ success: false, data: null, error: { code: "BATCH_INSUFFICIENT_QUANTITY", message: "O lote não possui saldo suficiente para esta baixa." } });
    }
    throw error;
  }

  return res.status(201).json({ success: true, data: movement, error: null });
});

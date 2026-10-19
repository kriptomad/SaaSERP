// apps/api/src/modules/purchasing/inventory-count.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 17.9 (Contagem Física de Estoque /
// Inventário / Balanço e Reconciliação de Divergências — fluxo de Contagem
// Cega, Blind Count).
// GAP DE AUDITORIA ENCONTRADO E CORRIGIDO: `InventoryCount`/`InventoryCountItem`
// existiam no schema com `approveInventoryCount()` detalhado em pseudocódigo,
// mas nenhuma rota REST jamais existiu.
// BUG DO PSEUDOCÓDIGO CORRIGIDO: o Capítulo 17.9.1 grava
// `StockMovement.reason`/`referenceType`, campos que não existem no model real
// (Capítulo 5) — corrigido usando apenas `reasonCode`/`referenceId`, mesma
// correção já aplicada em `purchase-orders.routes.ts`.
// Reaproveita "stock:product:read"/"stock:product:write".
import { Router, Request, Response } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";
import { readEnumQuery } from "../../lib/query-enum";

export const inventoryCountRouter = Router();

async function hasPermission(role: string, userId: string, permissionCode: string): Promise<boolean> {
  const [defaultGrant, override] = await Promise.all([
    prisma.roleDefaultPermission.findUnique({ where: { role_permissionCode: { role: role as any, permissionCode } } }),
    prisma.rolePermission.findUnique({ where: { userId_permission: { userId, permission: permissionCode } } }),
  ]);
  return override ? override.granted : Boolean(defaultGrant);
}

async function requireStockRead(req: Request, res: Response): Promise<boolean> {
  const { userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "stock:product:read"))) {
    res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite consultar contagens de estoque." } });
    return false;
  }
  return true;
}

async function requireStockWrite(req: Request, res: Response): Promise<boolean> {
  const { userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "stock:product:write"))) {
    res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite iniciar/aprovar contagens de estoque." } });
    return false;
  }
  return true;
}

inventoryCountRouter.get("/inventory-counts", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireStockRead(req, res))) return;
  const { tenantId } = req.session!;
  const statusParsed = readEnumQuery(res, req.query.status, ["OPEN", "RECONCILING", "APPROVED", "CANCELLED"] as const, "status");
  if (!statusParsed.ok) return;
  const counts = await prisma.inventoryCount.findMany({
    where: { tenantId, ...(statusParsed.value ? { status: statusParsed.value } : {}) },
    orderBy: { startedAt: "desc" },
  });
  return res.json({ success: true, data: counts, error: null });
});

// Capítulo 17.9.1 — fluxo de Contagem Cega: a listagem de itens de uma
// contagem em andamento NUNCA retorna `expectedQuantity` ao operador de campo
// (apenas depois de salvo/aprovado) — controle antifraude padrão de auditoria
// de estoque. Por isso este detalhe tem dois formatos de resposta distintos.
inventoryCountRouter.get("/inventory-counts/:id", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireStockRead(req, res))) return;
  const { tenantId } = req.session!;
  const count = await prisma.inventoryCount.findFirst({
    where: { id: req.params.id, tenantId },
    include: { items: { include: { product: { select: { id: true, name: true } }, productBatch: true } } },
  });
  if (!count) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Contagem de inventário não encontrada." } });
  }
  const revealExpected = count.status === "APPROVED" || req.query.revealExpected === "true" && (await hasPermission(req.session!.role, req.session!.userId, "stock:product:write"));
  const items = count.items.map((item) => (revealExpected ? item : { ...item, expectedQuantity: undefined }));
  return res.json({ success: true, data: { ...count, items }, error: null });
});

const startCountSchema = z.object({
  scope: z.string().min(1), // "FULL" | "CATEGORY:{id}" | "LOCATION:{id}"
  notes: z.string().optional(),
  productIds: z.array(z.string()).optional(), // quando omitido, inclui todos os produtos ativos do tenant (escopo FULL)
});

// Inicia a contagem: grava o saldo teórico (`expectedQuantity`) como SNAPSHOT no
// momento do início — nunca recalculado depois, senão uma venda concorrente
// mascararia a divergência real (regra explícita do schema, Capítulo 17.9).
inventoryCountRouter.post("/inventory-counts", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireStockWrite(req, res))) return;
  const parsed = startCountSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const { tenantId, userId } = req.session!;

  const products = await prisma.product.findMany({
    where: { tenantId, active: true, ...(parsed.data.productIds ? { id: { in: parsed.data.productIds } } : {}) },
    include: { batches: { where: { quantity: { gt: 0 } } } },
  });

  // O código sequencial (count+1) pode colidir em início concorrente; @@unique([tenantId, code]) garante a integridade e aqui a transação é repetida.
  let count: Awaited<ReturnType<typeof prisma.inventoryCount.create>> | undefined;
  for (let attempt = 1; attempt <= 5 && !count; attempt++) {
   try {
    count = await prisma.$transaction(async (tx) => {
    const lastCount = await tx.inventoryCount.count({ where: { tenantId } });
    const code = `INV-${new Date().getFullYear()}-${String(lastCount + 1).padStart(3, "0")}`;
    const created = await tx.inventoryCount.create({ data: { tenantId, code, scope: parsed.data.scope, notes: parsed.data.notes, startedByUserId: userId } });

    const itemsData: Prisma.InventoryCountItemCreateManyInput[] = [];
    for (const product of products) {
      if (product.trackingType === "BATCH" && product.batches.length > 0) {
        for (const batch of product.batches) {
          itemsData.push({ inventoryCountId: created.id, productId: product.id, productBatchId: batch.id, expectedQuantity: batch.quantity });
        }
      } else {
        itemsData.push({ inventoryCountId: created.id, productId: product.id, expectedQuantity: product.stockQuantity });
      }
    }
    if (itemsData.length > 0) {
      await tx.inventoryCountItem.createMany({ data: itemsData });
    }
    return created;
    });
   } catch (err: any) {
    if (err?.code !== "P2002" || attempt === 5) throw err;
   }
  }

  return res.status(201).json({ success: true, data: count, error: null });
});

const submitCountSchema = z.object({
  countedQuantity: z.number().nonnegative(),
  divergenceReason: z.string().optional(),
});

// Lançamento de campo: um item por vez (leitor de código de barras). Exige
// divergenceReason quando |counted - expected| > 0 — nunca opcional.
inventoryCountRouter.patch("/inventory-counts/:countId/items/:itemId", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireStockWrite(req, res))) return;
  const parsed = submitCountSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const { tenantId, userId } = req.session!;
  const count = await prisma.inventoryCount.findFirst({ where: { id: req.params.countId, tenantId } });
  if (!count) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Contagem de inventário não encontrada." } });
  }
  if (count.status !== "OPEN") {
    return res.status(409).json({ success: false, data: null, error: { code: "INVALID_STATUS", message: "Só é possível lançar contagens em uma contagem com status OPEN." } });
  }
  const item = await prisma.inventoryCountItem.findFirst({ where: { id: req.params.itemId, inventoryCountId: count.id } });
  if (!item) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Item de contagem não encontrado." } });
  }
  const divergence = new Prisma.Decimal(parsed.data.countedQuantity).sub(item.expectedQuantity);
  if (!divergence.isZero() && !parsed.data.divergenceReason) {
    return res.status(400).json({ success: false, data: null, error: { code: "DIVERGENCE_REASON_REQUIRED", message: "Motivo da divergência é obrigatório quando a quantidade contada difere do saldo teórico." } });
  }
  const updated = await prisma.inventoryCountItem.update({
    where: { id: item.id },
    data: { countedQuantity: parsed.data.countedQuantity, countedAt: new Date(), countedByUserId: userId, divergenceReason: parsed.data.divergenceReason },
  });
  return res.json({ success: true, data: updated, error: null });
});

// Transiciona OPEN → RECONCILING depois que todos os itens foram contados —
// portão antes da aprovação final, que é irreversível (aplica ajustes reais).
inventoryCountRouter.patch("/inventory-counts/:id/submit-for-reconciliation", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireStockWrite(req, res))) return;
  const { tenantId } = req.session!;
  const count = await prisma.inventoryCount.findFirst({ where: { id: req.params.id, tenantId }, include: { items: true } });
  if (!count) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Contagem de inventário não encontrada." } });
  }
  if (count.status !== "OPEN") {
    return res.status(409).json({ success: false, data: null, error: { code: "INVALID_STATUS", message: "Apenas contagens OPEN podem ser submetidas para reconciliação." } });
  }
  if (count.status !== "OPEN") {
    return res.status(409).json({ success: false, data: null, error: { code: "INVALID_STATUS", message: "Apenas contagens OPEN podem ser submetidas para reconciliação." } });
  }
  if (count.items.some((i) => i.countedQuantity === null)) {
    return res.status(409).json({ success: false, data: null, error: { code: "INVENTORY_COUNT_HAS_UNCOUNTED_ITEMS", message: "Existem itens ainda não contados — um balanço parcial nunca pode ser submetido para reconciliação." } });
  }
  const updated = await prisma.inventoryCount.update({ where: { id: count.id }, data: { status: "RECONCILING" } });
  return res.json({ success: true, data: updated, error: null });
});

// Aprovação final — aplica cada divergência como StockMovement(ADJUSTMENT),
// reaproveitando o mesmo motor central de estoque do Capítulo 6, nunca um
// caminho de ajuste paralelo.
inventoryCountRouter.patch("/inventory-counts/:id/approve", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireStockWrite(req, res))) return;
  const { tenantId, userId } = req.session!;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const count = await tx.inventoryCount.findFirst({ where: { id: req.params.id, tenantId }, include: { items: true } });
      if (!count) throw new Error("NOT_FOUND");
      if (count.status !== "RECONCILING") throw new Error("INVENTORY_COUNT_NOT_READY_FOR_APPROVAL");
      // Claim atômico: duas aprovações concorrentes não podem aplicar os ajustes duas vezes.
      const claimed = await tx.inventoryCount.updateMany({ where: { id: count.id, tenantId, status: "RECONCILING" }, data: { status: "APPROVED", approvedAt: new Date(), approvedByUserId: userId } });
      if (claimed.count !== 1) throw new Error("INVENTORY_COUNT_NOT_READY_FOR_APPROVAL");

      for (const item of count.items) {
        if (item.countedQuantity === null) throw new Error("INVENTORY_COUNT_HAS_UNCOUNTED_ITEMS");
        const divergence = item.countedQuantity.sub(item.expectedQuantity);
        if (!divergence.isZero()) {
          if (!item.divergenceReason) throw new Error(`DIVERGENCE_REASON_REQUIRED:${item.id}`);
          await tx.stockMovement.create({
            data: { tenantId, productId: item.productId, productBatchId: item.productBatchId, type: "ADJUSTMENT", quantity: divergence, reasonCode: item.divergenceReason, referenceId: count.id },
          });
          if (item.productBatchId) {
            await tx.productBatch.update({ where: { id: item.productBatchId }, data: { quantity: { increment: divergence } } });
          }
          await tx.product.update({ where: { id: item.productId }, data: { stockQuantity: { increment: divergence } } });
        }
      }

      return tx.inventoryCount.findFirstOrThrow({ where: { id: count.id, tenantId } });
    });
    return res.json({ success: true, data: result, error: null });
  } catch (err: any) {
    const code = err?.message ?? "APPROVE_FAILED";
    const status = code === "NOT_FOUND" ? 404 : 409;
    return res.status(status).json({ success: false, data: null, error: { code, message: code } });
  }
});

inventoryCountRouter.patch("/inventory-counts/:id/cancel", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireStockWrite(req, res))) return;
  const { tenantId } = req.session!;
  const count = await prisma.inventoryCount.findFirst({ where: { id: req.params.id, tenantId } });
  if (!count) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Contagem de inventário não encontrada." } });
  }
  if (count.status === "APPROVED") {
    return res.status(409).json({ success: false, data: null, error: { code: "INVALID_STATUS", message: "Contagens já aprovadas já aplicaram ajustes reais de estoque e não podem ser canceladas." } });
  }
  const updated = await prisma.inventoryCount.update({ where: { id: count.id }, data: { status: "CANCELLED" } });
  return res.json({ success: true, data: updated, error: null });
});

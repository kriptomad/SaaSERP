// apps/api/src/modules/purchasing/purchase-orders.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 17.8 (Módulo de Compras — Pedido de
// Compra, Recebimento de Mercadoria, Sugestão Automática de Reposição).
// GAP DE AUDITORIA ENCONTRADO E CORRIGIDO: `PurchaseOrder`/`PurchaseOrderItem`
// existiam no schema com uma transação de recebimento (`receivePurchaseOrderItems`)
// detalhada em pseudocódigo, mas nenhuma rota REST jamais existiu.
// BUG DO PSEUDOCÓDIGO CORRIGIDO: o Capítulo 17.8.2 grava `StockMovement.reason`
// e `StockMovement.referenceType`, mas o model real (Capítulo 5) só tem
// `reasonCode` (sem `reason`) e não possui nenhum campo `referenceType` —
// corrigido abaixo usando apenas `reasonCode`/`referenceId`.
// Reaproveita as permissões já seedadas "stock:product:read"/"stock:product:write"
// (mesmo domínio RBAC do cadastro de produtos — compras afeta diretamente
// Product.stockQuantity/costPrice).
import { Router, Request, Response } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";
import { recalculateRecipeCostsForIngredient } from "../../services/production/recalculate-recipe-cost.service";
import { manifestRecipientOperation, RecipientManifestationAlreadyFinalError } from "../fiscal/manifest-recipient.service";
import { createModuleLogger } from "../../lib/logger";

const log = createModuleLogger("purchase-orders.routes");

export const purchaseOrdersRouter = Router();

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
    res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite consultar compras/estoque." } });
    return false;
  }
  return true;
}

async function requireStockWrite(req: Request, res: Response): Promise<boolean> {
  const { userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "stock:product:write"))) {
    res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite lançar compras/ajustes de estoque." } });
    return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────
// PEDIDOS DE COMPRA
// ─────────────────────────────────────────────────────────────────────────

purchaseOrdersRouter.get("/purchase-orders", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireStockRead(req, res))) return;
  const { tenantId } = req.session!;
  const status = req.query.status as string | undefined;
  const orders = await prisma.purchaseOrder.findMany({
    where: { tenantId, ...(status ? { status: status as any } : {}) },
    include: { items: true, supplier: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });
  return res.json({ success: true, data: orders, error: null });
});

// Rota estática registrada ANTES de "/purchase-orders/:id" — Express resolve
// rotas na ordem de registro, e "reorder-suggestions" não pode ser capturado
// pelo parâmetro dinâmico ":id" do detalhe abaixo.
//
// GAP DE AUDITORIA FECHADO: o Capítulo 4.1 exige que a sugestão considere também a
// "velocidade de giro histórica (média móvel de 30 dias)", não apenas
// `minStockThreshold` estático. Sem isso, um produto com giro acelerado (ex.:
// vendeu o dobro do normal numa promoção) receberia a mesma sugestão fixa de um
// produto parado, gerando ruptura mesmo após o pedido de reposição ser atendido.
// `REORDER_LEAD_TIME_DAYS` é o horizonte de cobertura assumido entre o disparo da
// sugestão e o próximo recebimento de mercadoria deste fornecedor — 15 dias é um
// prazo conservador e configurável no futuro por fornecedor (Capítulo 17.8), não
// implementado nesta passada para não arriscar uma regra sem cobertura de teste.
// GAP DE AUDITORIA FECHADO (Capítulo 11.5 — Papelaria/Presentes, "Sazonalidade
// planejada"): quando o produto está dentro de uma `SeasonalityWindow` ativa cuja
// categoria bate com `Product.category` E a data atual está a até
// `SEASONALITY_ANTICIPATION_DAYS` dias ANTES do início da janela (startMonth/startDay),
// a sugestão de reposição é multiplicada por um fator de antecipação calculado a
// partir do volume de SALE_OUT vendido no MESMO PERÍODO (start→end da janela) do ANO
// PASSADO para produtos da mesma categoria: `fator = max(1, vendidoNoPeríodoAnoPassado /
// Math.max(1, vendidoÚltimos30Dias * (duraçãoDaJanelaEmDias/30)))`. Em palavras: se o
// volume vendido durante a janela do ano passado foi maior do que o giro recente
// projetado para o mesmo número de dias, o sistema entende que o pico sazonal
// historicamente supera o ritmo atual e aumenta a sugestão proporcionalmente — nunca
// reduz (o fator nunca é menor que 1). `SEASONALITY_ANTICIPATION_DAYS=30` é o mesmo
// tipo de constante configurável-no-futuro que `REORDER_LEAD_TIME_DAYS` já documenta
// acima.
const SEASONALITY_ANTICIPATION_DAYS = 30;

function daysUntilNextOccurrence(now: Date, month: number, day: number): number {
  const candidateThisYear = new Date(now.getFullYear(), month - 1, day);
  const target = candidateThisYear >= now ? candidateThisYear : new Date(now.getFullYear() + 1, month - 1, day);
  return Math.round((target.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
}

function windowDurationDays(startMonth: number, startDay: number, endMonth: number, endDay: number): number {
  // Ano de referência arbitrário (não-bissexto) só para medir a duração em dias,
  // respeitando o wraparound quando a janela cruza o ano-novo (ex.: out→fev).
  const start = new Date(2001, startMonth - 1, startDay);
  let end = new Date(2001, endMonth - 1, endDay);
  if (end < start) end = new Date(2002, endMonth - 1, endDay);
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)));
}

purchaseOrdersRouter.get("/purchase-orders/reorder-suggestions", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireStockRead(req, res))) return;
  const { tenantId } = req.session!;
  const REORDER_LEAD_TIME_DAYS = 15;
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const products = await prisma.product.findMany({ where: { tenantId, minStockThreshold: { not: null } } });
  const belowThreshold = products.filter((p) => p.stockQuantity.lte(p.minStockThreshold!));
  if (belowThreshold.length === 0) {
    return res.json({ success: true, data: [], error: null });
  }

  // Janelas de sazonalidade ativas cujo início cai dentro de SEASONALITY_ANTICIPATION_DAYS
  // a partir de hoje — candidatas a antecipar a sugestão de compra.
  const activeWindows = await prisma.seasonalityWindow.findMany({ where: { tenantId, active: true } });
  const upcomingWindowByCategory = new Map<string, (typeof activeWindows)[number]>();
  for (const w of activeWindows) {
    const daysUntilStart = daysUntilNextOccurrence(now, w.startMonth, w.startDay);
    if (daysUntilStart >= 0 && daysUntilStart <= SEASONALITY_ANTICIPATION_DAYS) {
      upcomingWindowByCategory.set(w.category, w);
    }
  }

  // SALE_OUT é gravado com quantidade negativa (Capítulo 6.6) — soma e inverte o
  // sinal para obter o volume total vendido nos últimos 30 dias por produto.
  const velocityByProduct = await prisma.stockMovement.groupBy({
    by: ["productId"],
    where: {
      tenantId,
      type: "SALE_OUT",
      productId: { in: belowThreshold.map((p) => p.id) },
      createdAt: { gte: thirtyDaysAgo },
    },
    _sum: { quantity: true },
  });
  const velocityMap = new Map(velocityByProduct.map((v) => [v.productId, v._sum.quantity?.abs() ?? new Prisma.Decimal(0)]));

  // Para cada produto cuja categoria tem uma janela sazonal prestes a começar, soma
  // o volume de SALE_OUT vendido no MESMO INTERVALO de mês/dia (start→end) do ANO
  // PASSADO, por produto — base do fator de antecipação documentado acima.
  const productsWithUpcomingWindow = belowThreshold.filter((p) => p.category && upcomingWindowByCategory.has(p.category));
  const lastYearSeasonalVolumeByProduct = new Map<string, Prisma.Decimal>();
  for (const p of productsWithUpcomingWindow) {
    const w = upcomingWindowByCategory.get(p.category!)!;
    const lastYear = now.getFullYear() - 1;
    const periodStart = new Date(lastYear, w.startMonth - 1, w.startDay);
    let periodEnd = new Date(lastYear, w.endMonth - 1, w.endDay, 23, 59, 59, 999);
    if (periodEnd < periodStart) periodEnd = new Date(lastYear + 1, w.endMonth - 1, w.endDay, 23, 59, 59, 999);

    const movements = await prisma.stockMovement.aggregate({
      where: { tenantId, type: "SALE_OUT", productId: p.id, createdAt: { gte: periodStart, lte: periodEnd } },
      _sum: { quantity: true },
    });
    lastYearSeasonalVolumeByProduct.set(p.id, movements._sum.quantity?.abs() ?? new Prisma.Decimal(0));
  }

  const suggestions = belowThreshold.map((p) => {
    const soldLast30Days = velocityMap.get(p.id) ?? new Prisma.Decimal(0);
    const avgDailySalesVelocity = soldLast30Days.div(30);

    // Duas regras concorrentes, vence a maior: o alvo configurado estaticamente
    // (reorderTargetQuantity/minStockThreshold*2) vs. o que a velocidade de giro
    // real projeta consumir até o próximo recebimento — nunca sugerir menos do que
    // o giro histórico indica que vai faltar.
    const staticTarget = (p.reorderTargetQuantity ?? p.minStockThreshold!.mul(2)).sub(p.stockQuantity);
    const velocityBasedTarget = avgDailySalesVelocity.mul(REORDER_LEAD_TIME_DAYS).sub(p.stockQuantity);
    let suggestedQuantity = Prisma.Decimal.max(staticTarget, velocityBasedTarget, new Prisma.Decimal(0));

    let seasonalityAnticipationFactor: number | null = null;
    const upcomingWindow = p.category ? upcomingWindowByCategory.get(p.category) : undefined;
    if (upcomingWindow) {
      const durationDays = windowDurationDays(upcomingWindow.startMonth, upcomingWindow.startDay, upcomingWindow.endMonth, upcomingWindow.endDay);
      const soldLastYearInWindow = lastYearSeasonalVolumeByProduct.get(p.id) ?? new Prisma.Decimal(0);
      // Giro recente projetado para a mesma duração da janela (mínimo 1 para nunca
      // dividir por zero) — comparado contra o que de fato vendeu no pico do ano
      // passado. O fator nunca é menor que 1 (nunca reduz a sugestão base).
      const projectedAtCurrentPace = Prisma.Decimal.max(avgDailySalesVelocity.mul(durationDays), new Prisma.Decimal(1));
      const rawFactor = soldLastYearInWindow.div(projectedAtCurrentPace);
      seasonalityAnticipationFactor = Prisma.Decimal.max(rawFactor, new Prisma.Decimal(1)).toNumber();
      suggestedQuantity = suggestedQuantity.mul(seasonalityAnticipationFactor);
    }

    return {
      productId: p.id,
      productName: p.name,
      currentStock: p.stockQuantity,
      avgDailySalesVelocity,
      suggestedQuantity,
      preferredSupplierId: p.preferredSupplierId,
      seasonalityWindowName: upcomingWindow?.name ?? null,
      seasonalityAnticipationFactor,
    };
  });

  return res.json({ success: true, data: suggestions, error: null });
});

// Capítulo 11.7 — Loja de Calçados: "sugestão de reposição deve priorizar as
// numerações centrais (38-40 feminino, 40-42 masculino), que historicamente giram
// mais rápido que as numerações de ponta (extremos pequenos/grandes)." GAP DE
// AUDITORIA FECHADO: a sugestão acima (`/reorder-suggestions`) é inteiramente
// product-level — nunca soube que um Product com trackingType VARIANT tem saldo
// por numeração, e muito menos giro por numeração.
//
// `StockMovement` não tem coluna de variante (mesma limitação documentada em
// `variant-turnover.routes.ts`), então a velocidade de giro por variante vem da
// baixa real em `SaleItem.productVariantId`, não do ledger de estoque.
//
// Heurística de detecção de eixo "numeração" (documentada, não é uma regra de
// negócio perfeita): `ProductVariantAxis.name` é texto livre no cadastro — não há
// um campo estruturado "tipo de eixo" no schema. Considera-se eixo de numeração
// todo eixo cujo nome contenha "numera" (cobre "Numeração", "numeracao") OU cujo
// `axisValue` seja inteiramente numérico (cobre tenants que nomeiam o eixo
// "Tamanho" mas usam numeração calçadista, ex. 34-44). Heurística de gênero: lida
// do `Product.category` (texto livre) por "feminin"/"masculin"; quando nenhum dos
// dois aparece, usa a faixa central combinada 38-42 (união dos dois intervalos do
// Bible) para não deixar de priorizar nada por falta de categoria cadastrada.
const FEMININE_CENTRAL_RANGE: [number, number] = [38, 40];
const MASCULINE_CENTRAL_RANGE: [number, number] = [40, 42];
const COMBINED_CENTRAL_RANGE: [number, number] = [38, 42];

function isCentralShoeSize(size: number, category: string | null): boolean {
  const normalizedCategory = (category ?? "").toLowerCase();
  const [min, max] = normalizedCategory.includes("feminin")
    ? FEMININE_CENTRAL_RANGE
    : normalizedCategory.includes("masculin")
      ? MASCULINE_CENTRAL_RANGE
      : COMBINED_CENTRAL_RANGE;
  return size >= min && size <= max;
}

purchaseOrdersRouter.get("/purchase-orders/reorder-suggestions-by-variant", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireStockRead(req, res))) return;
  const { tenantId } = req.session!;
  const REORDER_LEAD_TIME_DAYS = 15;
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  // Pequena margem de prioridade para numeração central — não é uma meta
  // adicional, é um desempate: entre duas variantes com a mesma velocidade de
  // giro projetada, a central soma 30% à quantidade sugerida (Capítulo 11.7: o
  // giro histórico real de numerações centrais já tende a ser maior, então esta
  // margem cobre apenas a diferença entre "média móvel de 30 dias" e sazonalidade
  // de curto prazo, sem exagerar na reposição do extremo).
  const CENTRAL_SIZE_PRIORITY_MULTIPLIER = 1.3;

  const variants = await prisma.productVariant.findMany({
    where: {
      tenantId,
      axis: { name: { contains: "numera", mode: "insensitive" } },
    },
    select: {
      id: true,
      axisValue: true,
      stockQuantity: true,
      productId: true,
      product: { select: { name: true, category: true, preferredSupplierId: true } },
    },
  });

  // Fallback: eixos chamados "Tamanho"/outros nomes, mas com axisValue 100% numérico
  // (ex.: "36", "37"...) dentro da faixa calçadista plausível (30-48).
  const otherVariants = await prisma.productVariant.findMany({
    where: {
      tenantId,
      NOT: { axis: { name: { contains: "numera", mode: "insensitive" } } },
    },
    select: {
      id: true,
      axisValue: true,
      stockQuantity: true,
      productId: true,
      product: { select: { name: true, category: true, preferredSupplierId: true } },
    },
  });
  const numericFallback = otherVariants.filter((v) => {
    const n = Number(v.axisValue);
    return Number.isInteger(n) && n >= 30 && n <= 48;
  });

  const allVariants = [...variants, ...numericFallback];
  if (allVariants.length === 0) {
    return res.json({ success: true, data: [], error: null });
  }

  const soldItems = await prisma.saleItem.findMany({
    where: {
      tenantId,
      productVariantId: { in: allVariants.map((v) => v.id) },
      sale: { status: "PAID", createdAt: { gte: thirtyDaysAgo } },
    },
    select: { productVariantId: true, quantity: true },
  });
  const soldByVariant = new Map<string, number>();
  for (const item of soldItems) {
    if (!item.productVariantId) continue;
    soldByVariant.set(item.productVariantId, (soldByVariant.get(item.productVariantId) ?? 0) + Number(item.quantity));
  }

  const suggestions = allVariants
    .map((v) => {
      const soldLast30Days = soldByVariant.get(v.id) ?? 0;
      const avgDailySalesVelocity = soldLast30Days / 30;
      const currentStock = Number(v.stockQuantity);
      const sizeNumber = Number(v.axisValue);
      const isCentral = Number.isFinite(sizeNumber) && isCentralShoeSize(sizeNumber, v.product.category);

      const velocityBasedTarget = avgDailySalesVelocity * REORDER_LEAD_TIME_DAYS - currentStock;
      const prioritized = isCentral ? velocityBasedTarget * CENTRAL_SIZE_PRIORITY_MULTIPLIER : velocityBasedTarget;
      const suggestedQuantity = Math.max(prioritized, 0);

      return {
        variantId: v.id,
        productId: v.productId,
        productName: v.product.name,
        axisValue: v.axisValue,
        isCentralSize: isCentral,
        currentStock: v.stockQuantity,
        avgDailySalesVelocity,
        suggestedQuantity,
        preferredSupplierId: v.product.preferredSupplierId,
      };
    })
    // Só reporta quem realmente precisa de reposição — evita poluir a sugestão
    // com todo o catálogo de numerações só porque algumas delas giram.
    .filter((s) => s.suggestedQuantity > 0);

  suggestions.sort((a, b) => b.suggestedQuantity - a.suggestedQuantity);

  return res.json({ success: true, data: suggestions, error: null });
});

purchaseOrdersRouter.get("/purchase-orders/:id", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireStockRead(req, res))) return;
  const { tenantId } = req.session!;
  const order = await prisma.purchaseOrder.findFirst({
    where: { id: req.params.id, tenantId },
    include: { items: { include: { product: { select: { id: true, name: true, trackingType: true } } } }, supplier: true, accountsPayable: true },
  });
  if (!order) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Pedido de compra não encontrado." } });
  }
  return res.json({ success: true, data: order, error: null });
});

const createPurchaseOrderItemSchema = z.object({
  productId: z.string(),
  quantityOrdered: z.number().positive(),
  unitCost: z.number().positive(),
});

const createPurchaseOrderSchema = z.object({
  supplierId: z.string(),
  expectedAt: z.coerce.date().optional(),
  notes: z.string().optional(),
  items: z.array(createPurchaseOrderItemSchema).min(1),
});

purchaseOrdersRouter.post("/purchase-orders", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireStockWrite(req, res))) return;
  const parsed = createPurchaseOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const { tenantId, userId } = req.session!;

  const supplier = await prisma.supplier.findFirst({ where: { id: parsed.data.supplierId, tenantId }, select: { id: true } });
  if (!supplier) {
    return res.status(404).json({ success: false, data: null, error: { code: "SUPPLIER_NOT_FOUND", message: "Fornecedor não encontrado neste tenant." } });
  }
  const productIds = [...new Set(parsed.data.items.map((i) => i.productId))];
  const ownedProducts = await prisma.product.count({ where: { id: { in: productIds }, tenantId } });
  if (ownedProducts !== productIds.length) {
    return res.status(404).json({ success: false, data: null, error: { code: "PRODUCT_NOT_FOUND", message: "Um ou mais produtos não foram encontrados neste tenant." } });
  }

  const order = await prisma.$transaction(async (tx) => {
    // Sequencial amigável por tenant ("Pedido #142") — nunca reaproveitado mesmo
    // após cancelamento, para preservar o histórico de numeração junto ao fornecedor.
    const lastOrder = await tx.purchaseOrder.findFirst({ where: { tenantId }, orderBy: { orderNumber: "desc" }, select: { orderNumber: true } });
    const orderNumber = (lastOrder?.orderNumber ?? 0) + 1;
    return tx.purchaseOrder.create({
      data: {
        tenantId, supplierId: parsed.data.supplierId, orderNumber, expectedAt: parsed.data.expectedAt, notes: parsed.data.notes, createdById: userId,
        items: { create: parsed.data.items.map((i) => ({ tenantId, productId: i.productId, quantityOrdered: i.quantityOrdered, unitCost: i.unitCost })) },
      },
      include: { items: true },
    });
  }, { isolationLevel: "Serializable" });

  return res.status(201).json({ success: true, data: order, error: null });
});

purchaseOrdersRouter.patch("/purchase-orders/:id/send", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireStockWrite(req, res))) return;
  const { tenantId } = req.session!;
  const order = await prisma.purchaseOrder.findFirst({ where: { id: req.params.id, tenantId } });
  if (!order) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Pedido de compra não encontrado." } });
  }
  if (order.status !== "DRAFT") {
    return res.status(409).json({ success: false, data: null, error: { code: "INVALID_STATUS", message: "Apenas pedidos em DRAFT podem ser enviados ao fornecedor." } });
  }
  const updated = await prisma.purchaseOrder.update({ where: { id: order.id }, data: { status: "SENT" } });
  return res.json({ success: true, data: updated, error: null });
});

purchaseOrdersRouter.patch("/purchase-orders/:id/cancel", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireStockWrite(req, res))) return;
  const { tenantId } = req.session!;
  const order = await prisma.purchaseOrder.findFirst({ where: { id: req.params.id, tenantId } });
  if (!order) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Pedido de compra não encontrado." } });
  }
  // Só DRAFT/SENT cancelam: em RECEIVED/PARTIALLY_RECEIVED já existem estoque e AccountPayable gerados — cancelar deixaria o pedido inconsistente com eles.
  if (order.status !== "DRAFT" && order.status !== "SENT") {
    return res.status(409).json({ success: false, data: null, error: { code: "INVALID_STATUS", message: "Apenas pedidos DRAFT ou SENT (sem recebimento) podem ser cancelados." } });
  }
  const claimed = await prisma.purchaseOrder.updateMany({ where: { id: order.id, tenantId, status: { in: ["DRAFT", "SENT"] } }, data: { status: "CANCELLED" } });
  if (claimed.count === 0) {
    return res.status(409).json({ success: false, data: null, error: { code: "INVALID_STATUS", message: "O pedido mudou de status; recarregue." } });
  }
  const updated = await prisma.purchaseOrder.findFirstOrThrow({ where: { id: order.id, tenantId } });
  return res.json({ success: true, data: updated, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// RECEBIMENTO DE MERCADORIA (Capítulo 17.8.2) — transação atômica, nunca gera
// estoque sem o AccountPayable correspondente, nem vice-versa.
// ─────────────────────────────────────────────────────────────────────────

const receiveItemSchema = z.object({
  purchaseOrderItemId: z.string(),
  quantityReceivedNow: z.number().positive(),
  batchNumber: z.string().optional(),
  expirationDate: z.coerce.date().optional(),
});

const receivePurchaseOrderSchema = z.object({
  receivedItems: z.array(receiveItemSchema).min(1),
  dueDate: z.coerce.date(),
});

purchaseOrdersRouter.post("/purchase-orders/:id/receive", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireStockWrite(req, res))) return;
  const parsed = receivePurchaseOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const { tenantId } = req.session!;

  // Retry automático e limitado em caso de conflito de serialização (P2034): a
  // isolação Serializable já impede fisicamente o double-increment de estoque entre
  // dois recebimentos concorrentes do mesmo pedido (um deles é abortado pelo
  // próprio Postgres), mas sem retry o operador recebia um 500 genérico por um
  // conflito transitório e tinha que reenviar manualmente o mesmo formulário.
  const MAX_SERIALIZATION_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_SERIALIZATION_RETRIES; attempt += 1) {
    try {
      const result = await prisma.$transaction(
      async (tx) => {
        const purchaseOrder = await tx.purchaseOrder.findFirst({ where: { id: req.params.id, tenantId }, include: { items: { include: { product: true } } } });
        if (!purchaseOrder) throw new Error("PURCHASE_ORDER_NOT_FOUND");
        if (purchaseOrder.status !== "SENT" && purchaseOrder.status !== "PARTIALLY_RECEIVED") throw new Error("PURCHASE_ORDER_NOT_RECEIVABLE");

        let totalReceivedValue = new Prisma.Decimal(0);
        const receivedSoFar = new Map<string, Prisma.Decimal>();
        // Capítulo 11.2 — Ótica: armações/lentes em consignação (`Product.isConsignment`)
        // entram em estoque normalmente, mas NÃO geram `AccountPayable` agora — a
        // obrigação só nasce na venda efetiva (close-sale.service.ts). Por isso o
        // valor desses itens é rastreado separadamente e excluído de `totalReceivedValue`.
        let consignmentExcludedValue = new Prisma.Decimal(0);

        for (const receivedItem of parsed.data.receivedItems) {
          const orderItem = purchaseOrder.items.find((i) => i.id === receivedItem.purchaseOrderItemId);
          if (!orderItem) throw new Error("PURCHASE_ORDER_ITEM_NOT_FOUND");

          const alreadyReceived = orderItem.quantityReceived.add(receivedSoFar.get(orderItem.id) ?? 0);
          const remaining = orderItem.quantityOrdered.sub(alreadyReceived);
          // `quantityNow` permanece em unidade de COMPRA (`quantityOrdered`/
          // `quantityReceived` do PurchaseOrderItem nunca mudam de unidade — mesmo
          // significado de sempre). `stockQuantityNow`, abaixo, é o que efetivamente
          // afeta o estoque físico (unidade de VENDA/estoque fracionado — Capítulo
          // 11.8/11.3): 1 unidade de compra = `unitConversionFactor` unidades de
          // estoque (default 1, preservando 100% do comportamento pré-existente para
          // qualquer produto sem fracionamento).
          const quantityNow = new Prisma.Decimal(receivedItem.quantityReceivedNow);
          if (quantityNow.gt(remaining)) throw new Error("RECEIVED_QUANTITY_EXCEEDS_ORDERED");
          const conversionFactor = orderItem.product.unitConversionFactor ?? new Prisma.Decimal(1);
          const stockQuantityNow = quantityNow.mul(conversionFactor);

          let productBatchId: string | undefined;
          if (orderItem.product.trackingType === "BATCH") {
            if (!receivedItem.batchNumber || !receivedItem.expirationDate) throw new Error("BATCH_AND_EXPIRATION_REQUIRED_FOR_TRACKED_PRODUCT");
            const batch = await tx.productBatch.create({
              data: { tenantId, productId: orderItem.productId, batchNumber: receivedItem.batchNumber, expirationDate: receivedItem.expirationDate, quantity: stockQuantityNow, costPrice: orderItem.unitCost.div(conversionFactor) },
            });
            productBatchId = batch.id;
          }

          await tx.stockMovement.create({
            data: { tenantId, productId: orderItem.productId, productBatchId, type: "PURCHASE_IN", quantity: stockQuantityNow, referenceId: purchaseOrder.id },
          });

          // Custo médio ponderado móvel (Capítulo 17.2) — nunca apenas substituído
          // pelo último preço de compra. `costPrice` é sempre por unidade de ESTOQUE
          // (mesma unidade de `stockQuantity`), então o custo de compra (por unidade
          // de COMPRA) é dividido por `conversionFactor` antes de entrar na média.
          // Relê o produto: linhas repetidas do mesmo produto no pedido tornariam o snapshot do include obsoleto.
          const freshProduct = await tx.product.findFirstOrThrow({ where: { id: orderItem.productId, tenantId }, select: { stockQuantity: true, costPrice: true } });
          const currentStockQty = freshProduct.stockQuantity;
          const currentStockValue = currentStockQty.mul(freshProduct.costPrice ?? new Prisma.Decimal(0));
          const incomingValue = quantityNow.mul(orderItem.unitCost);
          const incomingStockCost = orderItem.unitCost.div(conversionFactor).mul(stockQuantityNow);
          const newTotalQty = currentStockQty.add(stockQuantityNow);
          const newWeightedAverageCost = newTotalQty.gt(0) ? currentStockValue.add(incomingStockCost).div(newTotalQty) : orderItem.unitCost.div(conversionFactor);

          await tx.product.update({ where: { id: orderItem.productId }, data: { costPrice: newWeightedAverageCost, stockQuantity: { increment: stockQuantityNow } } });
          // Padaria/Confeitaria (Capítulo 4.4) — se este insumo compõe alguma ficha
          // técnica, propaga o novo custo médio para o CMV do produto final.
          await recalculateRecipeCostsForIngredient(tx, tenantId, orderItem.productId);
          await tx.purchaseOrderItem.update({ where: { id: orderItem.id }, data: { quantityReceived: { increment: quantityNow } } });
          receivedSoFar.set(orderItem.id, (receivedSoFar.get(orderItem.id) ?? new Prisma.Decimal(0)).add(quantityNow));

          if (orderItem.product.isConsignment) {
            consignmentExcludedValue = consignmentExcludedValue.add(incomingValue);
          } else {
            totalReceivedValue = totalReceivedValue.add(incomingValue);
          }
        }

        const refreshedItems = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: purchaseOrder.id } });
        const fullyReceived = refreshedItems.every((i) => i.quantityReceived.gte(i.quantityOrdered));

        const updatedOrder = await tx.purchaseOrder.update({ where: { id: purchaseOrder.id }, data: { status: fullyReceived ? "RECEIVED" : "PARTIALLY_RECEIVED" } });

        // Capítulo 11.2 — Ótica (consignação): só cria a AccountPayable se sobrar
        // valor não-consignado — um recebimento 100% de armações consignadas não
        // gera conta a pagar nenhuma agora (a obrigação nasce na venda efetiva).
        const accountPayable = totalReceivedValue.gt(0)
          ? await tx.accountPayable.create({
              data: { tenantId, supplierId: purchaseOrder.supplierId, description: `Pedido de Compra #${purchaseOrder.orderNumber}`, amount: totalReceivedValue, dueDate: parsed.data.dueDate, status: "PENDING", purchaseOrderId: purchaseOrder.id },
            })
          : null;

        return { purchaseOrder: updatedOrder, accountPayable, consignmentExcludedValue };
      },
      { isolationLevel: "Serializable" }, // mesmo nível do Capítulo 6.3 — concorrência de recebimento simultâneo do mesmo pedido
      );

      // BIBLE_ENGINEERING_V2.md Capítulo 21.19.4 — ao confirmar o recebimento físico
      // da mercadoria, o sistema dispara CONFIRMACAO_DA_OPERACAO automaticamente para
      // toda NF-e de entrada vinculada a este pedido. Chamada de rede à SEFAZ feita
      // DEPOIS da transação Serializable commitada (nunca dentro dela) — falha aqui
      // nunca derruba o recebimento de mercadoria em si, só fica registrada no log.
      const linkedIncomingNotes = await prisma.fiscalDocument.findMany({
        where: { tenantId, type: "NFE_ENTRADA", purchaseOrderId: result.purchaseOrder.id },
        select: { id: true },
      });
      for (const note of linkedIncomingNotes) {
        try {
          await manifestRecipientOperation(prisma, { tenantId, fiscalDocumentId: note.id, manifestationType: "CONFIRMACAO_DA_OPERACAO" });
        } catch (manifestErr) {
          if (!(manifestErr instanceof RecipientManifestationAlreadyFinalError)) {
            // GAP DE AUDITORIA FECHADO (mega-audit rodada 9): apenas logar em
            // console.error escondia a falha — o evento de manifestação fica
            // persistido em status PENDING (nunca AUTHORIZED/terminal), então a
            // nota permanece elegível para nova tentativa manual via
            // `/fiscal/notas-recebidas/:id/manifestar` (ManifestacaoRecipienteDialog
            // no painel fiscal). Logger estruturado garante que a falha apareça nos
            // dashboards de observabilidade em produção, não só no stdout local.
            log.error({ err: manifestErr, fiscalDocumentId: note.id, tenantId }, "falha ao manifestar CONFIRMACAO_DA_OPERACAO após recebimento de pedido de compra");
          }
        }
      }

      return res.status(200).json({ success: true, data: result, error: null });
    } catch (err: any) {
      const isSerializationConflict = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034";
      if (isSerializationConflict && attempt < MAX_SERIALIZATION_RETRIES) {
      continue; // outro recebimento concorrente venceu a corrida nesta tentativa — tenta de novo com os dados já atualizados.
      }
      const code = isSerializationConflict ? "CONCURRENT_RECEIVE_CONFLICT" : (err?.message ?? "RECEIVE_FAILED");
      const knownErrors = ["PURCHASE_ORDER_NOT_FOUND", "PURCHASE_ORDER_NOT_RECEIVABLE", "PURCHASE_ORDER_ITEM_NOT_FOUND", "RECEIVED_QUANTITY_EXCEEDS_ORDERED", "BATCH_AND_EXPIRATION_REQUIRED_FOR_TRACKED_PRODUCT"];
      const status = code === "PURCHASE_ORDER_NOT_FOUND" || code === "PURCHASE_ORDER_ITEM_NOT_FOUND" ? 404 : knownErrors.includes(code) || isSerializationConflict ? 409 : 500;
      return res.status(status).json({ success: false, data: null, error: { code, message: isSerializationConflict ? "Outro recebimento concorrente para este pedido está em andamento. Tente novamente." : code } });
    }
  }
});

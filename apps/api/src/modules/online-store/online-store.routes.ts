// apps/api/src/modules/online-store/online-store.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 8.5 — Vitrine Virtual / Loja Online.
// GAP DE AUDITORIA FECHADO (Mega-Audit Rodada 2, item 11): o schema já tinha
// `OnlineStoreSettings` por tenant (criado especulativamente em rodada anterior),
// mas nenhuma rota/tela jamais usou o modelo — zero código de produção o
// referenciava. Este arquivo cobre o lado AUTENTICADO (configuração da loja,
// alternância de visibilidade de produto, gestão dos pedidos recebidos). O lado
// PÚBLICO (catálogo e checkout do cliente final, sem login) fica em
// `public-online-store.routes.ts`, seguindo o mesmo padrão de slug público já
// usado por `public-booking.routes.ts`.
import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";
import { requireModule } from "../../middlewares/gatekeeper.middleware";

export const onlineStoreRouter = Router();

const settingsSchema = z.object({
  isActive: z.boolean(),
  customSlug: z
    .string()
    .min(3)
    .max(60)
    .regex(/^[a-z0-9-]+$/, "O slug deve conter apenas letras minúsculas, números e hífen."),
  primaryColorHex: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Cor deve estar no formato #RRGGBB."),
  logoStorageKey: z.string().nullish(),
  deliveryEnabled: z.boolean(),
  deliveryFee: z.number().nonnegative().nullish(),
  minOrderAmount: z.number().nonnegative().nullish(),
});

onlineStoreRouter.get("/online-store/settings", requireAuth, requireModule("ONLINE_STORE"), async (req: Request, res: Response) => {
  const { tenantId } = req.session!;
  const settings = await prisma.onlineStoreSettings.findUnique({ where: { tenantId } });
  return res.json({ success: true, data: settings, error: null });
});

onlineStoreRouter.put("/online-store/settings", requireAuth, requireModule("ONLINE_STORE"), async (req: Request, res: Response) => {
  const { tenantId } = req.session!;
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: "Dados inválidos.", details: parsed.error.flatten() } });
  }

  try {
    const settings = await prisma.onlineStoreSettings.upsert({
      where: { tenantId },
      create: { tenantId, ...parsed.data },
      update: { ...parsed.data },
    });
    return res.json({ success: true, data: settings, error: null });
  } catch (err: any) {
    // @@unique([customSlug]) — slug global entre todos os tenants, assim como `Tenant.slug`.
    if (err?.code === "P2002") {
      return res.status(409).json({ success: false, data: null, error: { code: "SLUG_ALREADY_TAKEN", message: "Este endereço da loja já está em uso. Escolha outro." } });
    }
    throw err;
  }
});

const toggleVisibilitySchema = z.object({ showInOnlineStore: z.boolean() });

onlineStoreRouter.patch(
  "/online-store/products/:productId/visibility",
  requireAuth,
  requireModule("ONLINE_STORE"),
  async (req: Request, res: Response) => {
    const { tenantId } = req.session!;
    const parsed = toggleVisibilitySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: "Dados inválidos." } });
    }
    const product = await prisma.product.findFirst({ where: { id: req.params.productId, tenantId } });
    if (!product) return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Produto não encontrado." } });

    const updated = await prisma.product.update({
      where: { id: product.id },
      data: { showInOnlineStore: parsed.data.showInOnlineStore },
    });
    return res.json({ success: true, data: updated, error: null });
  },
);

onlineStoreRouter.get("/online-store/orders", requireAuth, requireModule("ONLINE_STORE"), async (req: Request, res: Response) => {
  const { tenantId } = req.session!;
  const statusFilter = typeof req.query.status === "string" ? req.query.status : undefined;
  const orders = await prisma.onlineOrder.findMany({
    where: { tenantId, ...(statusFilter ? { status: statusFilter as any } : {}) },
    include: { items: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return res.json({ success: true, data: orders, error: null });
});

onlineStoreRouter.get("/online-store/orders/:id", requireAuth, requireModule("ONLINE_STORE"), async (req: Request, res: Response) => {
  const { tenantId } = req.session!;
  const order = await prisma.onlineOrder.findFirst({ where: { id: req.params.id, tenantId }, include: { items: true } });
  if (!order) return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Pedido não encontrado." } });
  return res.json({ success: true, data: order, error: null });
});

const VALID_TRANSITIONS: Record<string, string[]> = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PREPARING", "CANCELLED"],
  PREPARING: ["OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"],
  OUT_FOR_DELIVERY: ["DELIVERED", "CANCELLED"],
  DELIVERED: [],
  CANCELLED: [],
};

const updateOrderStatusSchema = z.object({
  status: z.enum(["CONFIRMED", "PREPARING", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"]),
  cancelReason: z.string().min(1).max(500).optional(),
});

// Máquina de estados explícita — nunca aceita um "pulo" arbitrário de status (ex.:
// PENDING direto para DELIVERED), mesma filosofia de `VALID_TRANSITIONS` já usada
// em outros fluxos de status do sistema (O.S., Comanda).
onlineStoreRouter.patch("/online-store/orders/:id/status", requireAuth, requireModule("ONLINE_STORE"), async (req: Request, res: Response) => {
  const { tenantId } = req.session!;
  const parsed = updateOrderStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: "Dados inválidos." } });
  }

  const order = await prisma.onlineOrder.findFirst({ where: { id: req.params.id, tenantId } });
  if (!order) return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Pedido não encontrado." } });

  const allowed = VALID_TRANSITIONS[order.status] ?? [];
  if (!allowed.includes(parsed.data.status)) {
    return res.status(409).json({
      success: false,
      data: null,
      error: { code: "INVALID_STATUS_TRANSITION", message: `Não é possível mudar de "${order.status}" para "${parsed.data.status}".` },
    });
  }
  if (parsed.data.status === "CANCELLED" && !parsed.data.cancelReason) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: "Informe o motivo do cancelamento." } });
  }

  const updated = await prisma.onlineOrder.update({
    where: { id: order.id },
    data: {
      status: parsed.data.status,
      ...(parsed.data.status === "CANCELLED" ? { cancelReason: parsed.data.cancelReason } : {}),
    },
    include: { items: true },
  });
  return res.json({ success: true, data: updated, error: null });
});

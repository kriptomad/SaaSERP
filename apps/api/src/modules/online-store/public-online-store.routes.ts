// apps/api/src/modules/online-store/public-online-store.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 8.5 — Vitrine Virtual / Loja Online.
// Rotas deliberadamente SEM requireAuth/tenantContextMiddleware: o tenant é
// resolvido pelo `:customSlug` da própria URL, mesmo padrão de
// `public-booking.routes.ts`. O "produto anônimo da internet" NUNCA decrementa
// estoque nem gera `Sale` diretamente — cria apenas um `OnlineOrder` pendente de
// confirmação humana (ver comentário no model `OnlineOrder`, schema.prisma).
import { Router, Request, Response } from "express";
import { z } from "zod";
import { prismaUnscoped as prisma } from "@filitech/db";
import { presignObjectDownload } from "../../lib/object-storage";
import { isTenantLocked } from "../../middlewares/tenant-lockout.middleware";

export const publicOnlineStoreRouter = Router();

async function resolveActiveStoreBySlug(customSlug: string) {
  const settings = await prisma.onlineStoreSettings.findUnique({
    where: { customSlug },
    include: { tenant: { select: { id: true, tradeName: true, status: true, gracePeriodEndsAt: true } } },
  });
  // Loja desativada pelo lojista ou tenant bloqueado por inadimplência (SUSPENDED/
  // CANCELLED/PAST_DUE fora do grace period — GAP DE AUDITORIA FECHADO na Rodada 6:
  // antes só checava SUSPENDED, nunca CANCELLED nem PAST_DUE vencido, deixando a
  // vitrine pública aceitando pedidos novos indefinidamente para tenants bloqueados
  // em qualquer uma dessas duas outras situações) -> mesmo tratamento de "não
  // encontrada" (nunca revela que o slug existe mas está bloqueado, evitando
  // enumeração de tenants inadimplentes).
  if (!settings || !settings.isActive || isTenantLocked(settings.tenant)) return null;
  return settings;
}

function notFoundStore(res: Response) {
  return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Loja não encontrada ou indisponível." } });
}

publicOnlineStoreRouter.get("/loja/:customSlug", async (req: Request, res: Response) => {
  const store = await resolveActiveStoreBySlug(req.params.customSlug);
  if (!store) return notFoundStore(res);

  let logoUrl: string | null = null;
  if (store.logoStorageKey) {
    try {
      logoUrl = (await presignObjectDownload(store.tenantId, store.logoStorageKey)).downloadUrl;
    } catch {
      logoUrl = null; // chave inválida/corrompida nunca derruba a página da loja
    }
  }

  return res.json({
    success: true,
    data: {
      tenantName: store.tenant.tradeName,
      primaryColorHex: store.primaryColorHex,
      logoUrl,
      deliveryEnabled: store.deliveryEnabled,
      deliveryFee: store.deliveryFee,
      minOrderAmount: store.minOrderAmount,
    },
    error: null,
  });
});

publicOnlineStoreRouter.get("/loja/:customSlug/products", async (req: Request, res: Response) => {
  const store = await resolveActiveStoreBySlug(req.params.customSlug);
  if (!store) return notFoundStore(res);

  const products = await prisma.product.findMany({
    where: { tenantId: store.tenantId, showInOnlineStore: true, active: true },
    select: { id: true, name: true, description: true, unitPrice: true },
    orderBy: { name: "asc" },
  });
  return res.json({ success: true, data: products, error: null });
});

const orderItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().positive(),
});

const createPublicOrderSchema = z.object({
  customerName: z.string().min(1).max(200),
  customerPhone: z.string().min(8).max(20),
  customerEmail: z.string().email().optional(),
  isDelivery: z.boolean().default(false),
  deliveryAddress: z.string().min(1).max(500).optional(),
  customerNotes: z.string().max(1000).optional(),
  items: z.array(orderItemSchema).min(1),
});

publicOnlineStoreRouter.post("/loja/:customSlug/orders", async (req: Request, res: Response) => {
  const store = await resolveActiveStoreBySlug(req.params.customSlug);
  if (!store) return notFoundStore(res);

  const parsed = createPublicOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const input = parsed.data;

  if (input.isDelivery && !store.deliveryEnabled) {
    return res.status(422).json({ success: false, data: null, error: { code: "DELIVERY_NOT_AVAILABLE", message: "Esta loja não realiza entrega." } });
  }
  if (input.isDelivery && !input.deliveryAddress) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: "Informe o endereço de entrega." } });
  }

  // Preço e nome sempre lidos do banco no momento do pedido (nunca confiamos no
  // valor enviado pelo cliente final) — depois congelados como snapshot no
  // `OnlineOrderItem`, para o histórico do pedido nunca mudar mesmo que o produto
  // seja reprecificado/renomeado depois.
  const productIds = [...new Set(input.items.map((item) => item.productId))];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, tenantId: store.tenantId, showInOnlineStore: true, active: true },
  });
  const productById = new Map(products.map((product) => [product.id, product]));

  const missing = productIds.filter((id) => !productById.has(id));
  if (missing.length > 0) {
    return res.status(422).json({ success: false, data: null, error: { code: "PRODUCT_UNAVAILABLE", message: "Um ou mais produtos não estão mais disponíveis nesta loja." } });
  }

  let itemsTotalAmount = 0;
  const itemsData = input.items.map((item) => {
    const product = productById.get(item.productId)!;
    const unitPrice = Number(product.unitPrice);
    itemsTotalAmount += unitPrice * item.quantity;
    return {
      productId: product.id,
      productName: product.name,
      quantity: item.quantity,
      unitPrice,
    };
  });

  const deliveryFee = input.isDelivery && store.deliveryFee ? Number(store.deliveryFee) : 0;
  const totalAmount = itemsTotalAmount + deliveryFee;

  if (store.minOrderAmount && itemsTotalAmount < Number(store.minOrderAmount)) {
    return res.status(422).json({
      success: false,
      data: null,
      error: { code: "BELOW_MIN_ORDER_AMOUNT", message: `O pedido mínimo desta loja é de R$ ${Number(store.minOrderAmount).toFixed(2)}.` },
    });
  }

  const order = await prisma.onlineOrder.create({
    data: {
      tenantId: store.tenantId,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      customerEmail: input.customerEmail,
      isDelivery: input.isDelivery,
      deliveryAddress: input.deliveryAddress,
      customerNotes: input.customerNotes,
      itemsTotalAmount,
      deliveryFee: input.isDelivery ? deliveryFee : null,
      totalAmount,
      items: { create: itemsData },
    },
    include: { items: true },
  });

  return res.status(201).json({ success: true, data: order, error: null });
});

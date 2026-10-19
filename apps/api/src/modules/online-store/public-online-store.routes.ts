// apps/api/src/modules/online-store/public-online-store.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 8.5 — Vitrine Virtual / Loja Online.
// Rotas deliberadamente SEM requireAuth/tenantContextMiddleware: o tenant é
// resolvido pelo `:customSlug` da própria URL, mesmo padrão de
// `public-booking.routes.ts`. O "produto anônimo da internet" NUNCA decrementa
// estoque nem gera `Sale` diretamente — cria apenas um `OnlineOrder` pendente de
// confirmação humana (ver comentário no model `OnlineOrder`, schema.prisma).
import { Router, Request, Response } from "express";
import { z } from "zod";
import { Prisma, prismaUnscoped as prisma } from "@filitech/db";
import { presignObjectDownload } from "../../lib/object-storage";
import { isTenantLocked } from "../../middlewares/tenant-lockout.middleware";
import { enforceRateLimit, RateLimitExceededError } from "../../lib/rate-limit";

// GAP DE AUDITORIA FECHADO: criação de pedido na vitrine pública não tinha
// nenhum rate limiting — mesmo padrão de lookup.routes.ts/public-booking.routes.ts.
const PUBLIC_STORE_ORDER_RATE_LIMIT_MAX = 10;
const PUBLIC_STORE_ORDER_RATE_LIMIT_WINDOW_SECONDS = 60;
// GAP DE AUDITORIA FECHADO (Rodada 12): catálogo público não tinha NENHUM rate
// limit — scraping/refresh em loop batia direto no banco sem nenhuma barreira,
// mesmo padrão do `/slots` de public-booking.routes.ts antes da Rodada 11.
const PUBLIC_STORE_READ_RATE_LIMIT_MAX = 60;
const PUBLIC_STORE_READ_RATE_LIMIT_WINDOW_SECONDS = 60;

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
  // GAP DE AUDITORIA FECHADO (Rodada 13): a landing/metadata da loja fazia
  // lookup no banco + presign de objeto no R2 por requisição anônima, sem
  // NENHUM rate limit — era o único endpoint público deste arquivo que ainda
  // não reutilizava o mesmo teto de leitura aplicado em `/products` na Rodada 12.
  try {
    await enforceRateLimit(`public-store:${req.params.customSlug}:landing:${req.ip}`, PUBLIC_STORE_READ_RATE_LIMIT_MAX, PUBLIC_STORE_READ_RATE_LIMIT_WINDOW_SECONDS);
  } catch (err) {
    if (err instanceof RateLimitExceededError) {
      return res.status(429).json({ success: false, data: null, error: { code: "RATE_LIMITED", message: err.message } });
    }
    throw err;
  }
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
  // GAP DE AUDITORIA FECHADO (Rodada 12): rota pública anônima sem rate limit e
  // sem teto de resultados — um catálogo com centenas de milhares de produtos
  // (real ou forjado) podia ser solicitado repetidamente, esgotando CPU/memória
  // da API e conexões do Postgres.
  try {
    await enforceRateLimit(`public-store:${req.params.customSlug}:read:${req.ip}`, PUBLIC_STORE_READ_RATE_LIMIT_MAX, PUBLIC_STORE_READ_RATE_LIMIT_WINDOW_SECONDS);
  } catch (err) {
    if (err instanceof RateLimitExceededError) {
      return res.status(429).json({ success: false, data: null, error: { code: "RATE_LIMITED", message: err.message } });
    }
    throw err;
  }
  const store = await resolveActiveStoreBySlug(req.params.customSlug);
  if (!store) return notFoundStore(res);

  const products = await prisma.product.findMany({
    where: { tenantId: store.tenantId, showInOnlineStore: true, active: true },
    select: { id: true, name: true, description: true, unitPrice: true },
    orderBy: { name: "asc" },
    take: 500,
  });
  return res.json({ success: true, data: products, error: null });
});

const orderItemSchema = z.object({
  productId: z.string().min(1),
  // GAP DE AUDITORIA FECHADO (Rodada 12): `.positive()` sozinho aceitava
  // quantidades absurdamente grandes sem teto superior. Produtos pesáveis
  // (`Product.isWeighted`, ex. padaria por peso) legitimamente usam fração
  // (0.750kg) — por isso o teto superior continua aceitando decimais aqui;
  // a exigência de número inteiro para produtos NÃO pesáveis é validada
  // abaixo, já com o produto carregado do banco (único lugar que sabe se é
  // pesável ou não).
  quantity: z.number().positive().finite().max(10_000),
});

const createPublicOrderSchema = z.object({
  customerName: z.string().min(1).max(200),
  customerPhone: z.string().min(8).max(20),
  customerEmail: z.string().email().optional(),
  isDelivery: z.boolean().default(false),
  deliveryAddress: z.string().min(1).max(500).optional(),
  customerNotes: z.string().max(1000).optional(),
  // GAP DE AUDITORIA FECHADO (Rodada 12): array de itens sem teto superior —
  // um payload com dezenas de milhares de itens inflava o `$in` da query de
  // produtos e o cálculo de total em memória sem limite nenhum.
  items: z.array(orderItemSchema).min(1).max(100),
});

publicOnlineStoreRouter.post("/loja/:customSlug/orders", async (req: Request, res: Response) => {
  try {
    // GAP DE AUDITORIA FECHADO (Rodada 12): chave sem o slug da loja — mesmo
    // problema corrigido em public-booking.routes.ts na Rodada 11: um único IP
    // (NAT/torre de celular compartilhada) esgotava o balde de pedidos para
    // TODAS as lojas da plataforma, não só a que estava realmente sendo abusada.
    await enforceRateLimit(`public-store:${req.params.customSlug}:order:${req.ip}`, PUBLIC_STORE_ORDER_RATE_LIMIT_MAX, PUBLIC_STORE_ORDER_RATE_LIMIT_WINDOW_SECONDS);
  } catch (err) {
    if (err instanceof RateLimitExceededError) {
      return res.status(429).json({ success: false, data: null, error: { code: "RATE_LIMITED", message: err.message } });
    }
    throw err;
  }
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

  // GAP DE AUDITORIA FECHADO (Rodada 13): linhas duplicadas do mesmo produto
  // (ex.: cliente clicou "adicionar" várias vezes gerando itens separados em
  // vez de incrementar a quantidade) não eram mescladas — o pedido persistia
  // N `OnlineOrderItem` redundantes para o mesmo produto, inflando o registro
  // e confundindo a conferência do lojista. Mesclamos por `productId` somando
  // as quantidades antes de qualquer cálculo/validação.
  const mergedItemsByProductId = new Map<string, number>();
  for (const item of input.items) {
    mergedItemsByProductId.set(item.productId, (mergedItemsByProductId.get(item.productId) ?? 0) + item.quantity);
  }
  const mergedItems = [...mergedItemsByProductId.entries()].map(([productId, quantity]) => ({ productId, quantity }));
  // Teto por produto também vale após a mesclagem — sem isso, um cliente podia
  // contornar o `.max(10_000)` do schema por item enviando várias linhas do
  // mesmo produto que juntas ultrapassam o limite.
  if (mergedItems.some((item) => item.quantity > 10_000)) {
    return res.status(422).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: "Quantidade total por produto excede o limite permitido." } });
  }

  // Preço e nome sempre lidos do banco no momento do pedido (nunca confiamos no
  // valor enviado pelo cliente final) — depois congelados como snapshot no
  // `OnlineOrderItem`, para o histórico do pedido nunca mudar mesmo que o produto
  // seja reprecificado/renomeado depois.
  const productIds = [...mergedItemsByProductId.keys()];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, tenantId: store.tenantId, showInOnlineStore: true, active: true },
  });
  const productById = new Map(products.map((product) => [product.id, product]));

  const missing = productIds.filter((id) => !productById.has(id));
  if (missing.length > 0) {
    return res.status(422).json({ success: false, data: null, error: { code: "PRODUCT_UNAVAILABLE", message: "Um ou mais produtos não estão mais disponíveis nesta loja." } });
  }

  // GAP DE AUDITORIA FECHADO (Rodada 12): produto NÃO pesável vendido em
  // fração (ex.: "0.5 unidade" de um item unitário) é sempre erro de
  // cadastro/abuso de cliente, nunca uma venda real — só `isWeighted` legitima
  // quantidade fracionária.
  const invalidFractional = mergedItems.find((item) => {
    const product = productById.get(item.productId)!;
    return !product.isWeighted && !Number.isInteger(item.quantity);
  });
  if (invalidFractional) {
    return res.status(422).json({ success: false, data: null, error: { code: "INVALID_QUANTITY", message: "Quantidade deve ser um número inteiro para este produto." } });
  }

  // GAP DE AUDITORIA FECHADO (Rodada 13): o total do pedido era somado com
  // `Number` (ponto flutuante binário) em vez de `Prisma.Decimal`, podendo
  // divergir em centavos do valor realmente persistido pelo Postgres
  // (`Decimal(12,2)`). Toda a soma agora usa aritmética decimal exata.
  let itemsTotalAmount = new Prisma.Decimal(0);
  const itemsData = mergedItems.map((item) => {
    const product = productById.get(item.productId)!;
    const unitPrice = new Prisma.Decimal(product.unitPrice);
    const lineTotal = unitPrice.mul(item.quantity);
    itemsTotalAmount = itemsTotalAmount.add(lineTotal);
    return {
      productId: product.id,
      productName: product.name,
      quantity: item.quantity,
      unitPrice,
    };
  });

  const deliveryFee = input.isDelivery && store.deliveryFee ? new Prisma.Decimal(store.deliveryFee) : new Prisma.Decimal(0);
  const totalAmount = itemsTotalAmount.add(deliveryFee);

  if (store.minOrderAmount && itemsTotalAmount.lessThan(new Prisma.Decimal(store.minOrderAmount))) {
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

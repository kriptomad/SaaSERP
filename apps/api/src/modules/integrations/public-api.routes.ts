// apps/api/src/modules/integrations/public-api.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 15.4 — fecha o gap explicitamente
// documentado no próprio capítulo ("nenhuma rota ainda consome de fato uma
// TenantApiKey para autenticar uma requisição externa... fica para uma
// iteração futura"). Esta é essa iteração: API REST pública (fora do cookie/
// JWT de sessão do SPA) consumida por integrações programáticas de terceiros
// do próprio tenant (e-commerce, ERP contábil parceiro) usando a API key
// emitida em /integrations/api-keys (tenant-integrations.routes.ts).
//
// Montada em server.ts ANTES de authMiddleware/tenantContextMiddleware/
// tenantLockoutMiddleware globais (mesmo ponto de public-booking.routes.ts/
// public-online-store.routes.ts) porque usa autenticação própria
// (requireApiKey) — nunca cookie/JWT de usuário. Cada grupo de rotas aplica,
// nesta ordem, EXATAMENTE a mesma blindagem multi-tenant que uma sessão
// comum: requireApiKey (popula req.session) -> tenantContextMiddleware
// (Capítulo 7.1, injeta tenantId em toda query via Prisma Client Extension)
// -> tenantLockoutMiddleware (Capítulo 2, 402 se inadimplente).
import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@filitech/db";
import { requireApiKey } from "../../middlewares/api-key-auth.middleware";
import { tenantContextMiddleware } from "../../middlewares/tenant-context.middleware";
import { tenantLockoutMiddleware } from "../../middlewares/tenant-lockout.middleware";
import { enforceRateLimit, RateLimitExceededError } from "../../lib/rate-limit";

export const publicApiRouter = Router();

// GAP DE AUDITORIA FECHADO: `requireApiKey` já aplica um rate limit genérico por
// IP (ver `api-key-auth.middleware.ts`), mas isso sozinho não escopa por API
// key/tenant — várias integrações de tenants diferentes atrás do mesmo IP
// (gateway/proxy corporativo) dividiam o mesmo balde, e uma única API key
// comprometida usando múltiplos IPs nunca era limitada por tenant. Aplicado
// DEPOIS de `requireApiKey` (que já populou `req.apiKeyAuth`) em toda rota desta
// API pública (sales/products/stock-adjust), reaproveitando o MESMO helper
// `enforceRateLimit` (Redis INCR+TTL) de todo o resto do projeto.
const PUBLIC_API_RATE_LIMIT_MAX = 120;
const PUBLIC_API_RATE_LIMIT_WINDOW_SECONDS = 60;

async function rateLimitByApiKey(req: Request, res: Response, next: NextFunction) {
  try {
    await enforceRateLimit(`public-api:${req.apiKeyAuth!.apiKeyId}`, PUBLIC_API_RATE_LIMIT_MAX, PUBLIC_API_RATE_LIMIT_WINDOW_SECONDS);
    next();
  } catch (err) {
    if (err instanceof RateLimitExceededError) {
      return res.status(429).json({ success: false, data: null, error: { code: "RATE_LIMITED", message: err.message } });
    }
    next(err);
  }
}

const PAGE_SIZE_MAX = 100;

function parsePageSize(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 25;
  return Math.min(Math.floor(n), PAGE_SIZE_MAX);
}

// GAP DE AUDITORIA FECHADO (Rodada 13): `new Date(from)`/`new Date(to)` eram
// usados direto numa query Prisma sem checar `isNaN` — uma integração externa
// enviando uma string de data malformada produzia um `Date` inválido que o
// Prisma só rejeitava em runtime com um 500 genérico, em vez de um 400 claro.
function parseValidDate(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new InvalidDateRangeError(`Data inválida: "${raw}".`);
  }
  return parsed;
}

class InvalidDateRangeError extends Error {}

// ─────────────────────────────────────────────────────────────────────────
// VENDAS (escopo "sales:read")
// ─────────────────────────────────────────────────────────────────────────

const salesReadChain = [requireApiKey("sales:read"), rateLimitByApiKey, tenantContextMiddleware, tenantLockoutMiddleware];

const salesQuerySchema = z.object({
  cashRegisterId: z.string().uuid().optional(),
  from: z.string().trim().min(1).optional(),
  to: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).optional(),
});

publicApiRouter.get("/api/public/v1/sales", ...salesReadChain, async (req: Request, res: Response) => {
  const { tenantId } = req.session!;
  // CORREÇÃO DE AUDITORIA (fa-w6-api-public-api-query-unvalidated): endpoint
  // externamente alcançável (autenticado por API key, não por sessão de usuário)
  // sem um schema Zod explícito — só validação manual pontual (`parsePageSize`/
  // `parseValidDate`). Formaliza com Zod, mantendo o `limit` sempre limitado a
  // `PAGE_SIZE_MAX` e as datas validadas abaixo.
  const parsedQuery = salesQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: "Dados inválidos.", details: parsedQuery.error.flatten() } });
  }
  const take = parsePageSize(parsedQuery.data.limit);
  const { from, to, cashRegisterId } = parsedQuery.data;
  let fromDate: Date | undefined;
  let toDate: Date | undefined;
  try {
    fromDate = parseValidDate(from);
    toDate = parseValidDate(to);
  } catch (err) {
    if (err instanceof InvalidDateRangeError) {
      return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: err.message } });
    }
    throw err;
  }
  const where: Prisma.SaleWhereInput = {
    tenantId,
    ...(cashRegisterId ? { cashRegisterId } : {}),
    ...(fromDate || toDate ? { createdAt: { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) } } : {}),
  };
  const sales = await prisma.sale.findMany({
    where,
    select: {
      id: true,
      status: true,
      channel: true,
      paymentMethod: true,
      totalAmount: true,
      discountAmount: true,
      clientId: true,
      createdAt: true,
      refundedAt: true,
    },
    orderBy: { createdAt: "desc" },
    take,
  });
  return res.json({ success: true, data: sales, error: null });
});

publicApiRouter.get("/api/public/v1/sales/:id", ...salesReadChain, async (req: Request, res: Response) => {
  const { tenantId } = req.session!;
  const sale = await prisma.sale.findFirst({
    where: { id: req.params.id, tenantId },
    include: {
      items: { select: { id: true, productId: true, serviceId: true, quantity: true, unitPrice: true, totalPrice: true } },
      fiscalDocuments: { select: { id: true, type: true, status: true, accessKey: true, focusNfeNumero: true } },
    },
  });
  if (!sale) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Venda não encontrada." } });
  }
  return res.json({ success: true, data: sale, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// PRODUTOS/ESTOQUE (escopos "stock:read"/"stock:write")
// ─────────────────────────────────────────────────────────────────────────

const stockReadChain = [requireApiKey("stock:read"), rateLimitByApiKey, tenantContextMiddleware, tenantLockoutMiddleware];
const stockWriteChain = [requireApiKey("stock:write"), rateLimitByApiKey, tenantContextMiddleware, tenantLockoutMiddleware];

const productsQuerySchema = z.object({
  sku: z.string().trim().min(1).max(100).optional(),
  barcode: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).optional(),
});

publicApiRouter.get("/api/public/v1/products", ...stockReadChain, async (req: Request, res: Response) => {
  const { tenantId } = req.session!;
  // CORREÇÃO DE AUDITORIA (fa-w6-api-public-api-query-unvalidated): mesma falta
  // de schema Zod explícito do /sales acima, endpoint externamente alcançável.
  const parsedQuery = productsQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: "Dados inválidos.", details: parsedQuery.error.flatten() } });
  }
  const take = parsePageSize(parsedQuery.data.limit);
  const { sku, barcode } = parsedQuery.data;
  const products = await prisma.product.findMany({
    where: { tenantId, ...(sku ? { sku } : {}), ...(barcode ? { barcode } : {}) },
    select: { id: true, sku: true, barcode: true, name: true, trackingType: true, unitPrice: true, stockQuantity: true, updatedAt: true },
    orderBy: { name: "asc" },
    take,
  });
  return res.json({ success: true, data: products, error: null });
});

publicApiRouter.get("/api/public/v1/products/:id", ...stockReadChain, async (req: Request, res: Response) => {
  const { tenantId } = req.session!;
  const product = await prisma.product.findFirst({
    where: { id: req.params.id, tenantId },
    select: { id: true, sku: true, barcode: true, name: true, trackingType: true, unitPrice: true, costPrice: true, stockQuantity: true, updatedAt: true },
  });
  if (!product) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Produto não encontrado." } });
  }
  return res.json({ success: true, data: product, error: null });
});

const stockAdjustSchema = z.object({
  // GAP DE AUDITORIA FECHADO (Rodada 13): só rejeitava zero — nenhum teto de
  // magnitude nem exigência de número finito. Uma integração externa
  // comprometida/com bug podia enviar uma quantidade absurda (ou não-finita)
  // e corromper `stockQuantity` em um único ajuste. `stockQuantity` é
  // Decimal(12,3) no schema; nenhum ajuste individual real passa de 6 dígitos.
  quantity: z.number().finite().refine((v) => v !== 0, "A quantidade do ajuste não pode ser zero.").refine((v) => Math.abs(v) <= 999_999, "A quantidade do ajuste excede o limite permitido (999999)."),
  reasonCode: z.string().min(1),
});

// Ajuste simples de estoque via integração externa (ex.: sincronização de
// marketplace) — restrito a produtos SEM rastreio por lote/série, que exigem
// escolha manual de qual lote/série é afetado (fluxo coberto por
// stock.routes.ts/POST /stock-movements/adjustment, nunca duplicado aqui).
publicApiRouter.patch("/api/public/v1/products/:id/stock-adjust", ...stockWriteChain, async (req: Request, res: Response) => {
  const { tenantId } = req.session!;
  const parsed = stockAdjustSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const product = await prisma.product.findFirst({ where: { id: req.params.id, tenantId } });
  if (!product) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Produto não encontrado." } });
  }
  if (product.trackingType !== "NONE") {
    return res.status(400).json({
      success: false,
      data: null,
      error: { code: "TRACKING_TYPE_NOT_SUPPORTED", message: "Produtos controlados por lote/série exigem ajuste manual pela tela do sistema (POST /stock-movements/adjustment)." },
    });
  }

  const movement = await prisma.$transaction(async (tx) => {
    const created = await tx.stockMovement.create({
      data: {
        tenantId,
        productId: product.id,
        type: parsed.data.quantity < 0 ? "LOSS" : "ADJUSTMENT",
        quantity: parsed.data.quantity,
        reasonCode: parsed.data.reasonCode,
      },
    });
    await tx.product.update({ where: { id: product.id }, data: { stockQuantity: { increment: parsed.data.quantity } } });
    return created;
  });

  return res.status(201).json({ success: true, data: movement, error: null });
});

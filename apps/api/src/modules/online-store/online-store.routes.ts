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
import { Prisma, prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";
import { requireModule } from "../../middlewares/gatekeeper.middleware";
import { isTenantStorageKey } from "../../lib/storage-key";
import { readEnumQuery } from "../../lib/query-enum";

export const onlineStoreRouter = Router();

// GAP DE AUDITORIA FECHADO (fa-online-store-missing-rbac): antes deste fix,
// qualquer usuário autenticado (TECHNICIAN, HOUSEHOLD_MEMBER etc.) conseguia
// reconfigurar a vitrine pública (slug/cor/logo/entrega) ou alterar pedidos —
// `requireAuth`/`requireModule` sozinhos só garantem autenticação e contratação
// do módulo, nunca autorização granular por papel. Mesmo padrão de
// `hasPermission`/`hasManageUsersPermission` já usado em stock.routes.ts e
// users.routes.ts: checa override por usuário (`RolePermission`) e, na
// ausência dele, o default por papel (`RoleDefaultPermission`).
async function hasPermission(role: string, userId: string, permissionCode: string): Promise<boolean> {
  const [defaultGrant, override] = await Promise.all([
    prisma.roleDefaultPermission.findUnique({ where: { role_permissionCode: { role: role as any, permissionCode } } }),
    prisma.rolePermission.findUnique({ where: { userId_permission: { userId, permission: permissionCode } } }),
  ]);
  return override ? override.granted : Boolean(defaultGrant);
}

function forbidden(res: Response, message: string) {
  return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message } });
}

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
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "online-store:settings:manage"))) {
    return forbidden(res, "Seu nível de acesso não permite configurar a loja online.");
  }
  const settings = await prisma.onlineStoreSettings.findUnique({ where: { tenantId } });
  return res.json({ success: true, data: settings, error: null });
});

onlineStoreRouter.put("/online-store/settings", requireAuth, requireModule("ONLINE_STORE"), async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "online-store:settings:manage"))) {
    return forbidden(res, "Seu nível de acesso não permite configurar a loja online.");
  }
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: "Dados inválidos.", details: parsed.error.flatten() } });
  }

  // GAP DE AUDITORIA FECHADO (fa-online-store-logo-storage-key-unvalidated): o
  // ponteiro de logo vinha do body sem validar o prefixo `tenants/<tenantId>/` —
  // um tenant podia gravar a chave de um objeto de OUTRO tenant e, na vitrine
  // pública, gerar uma URL assinada de leitura para um arquivo alheio. Mesma
  // trava usada em work-orders.routes.ts/car-wash-service.routes.ts.
  if (parsed.data.logoStorageKey && !isTenantStorageKey(parsed.data.logoStorageKey, tenantId)) {
    return res.status(400).json({ success: false, data: null, error: { code: "INVALID_STORAGE_KEY", message: "A chave de armazenamento do logo deve pertencer ao tenant autenticado (tenants/<tenantId>/...)." } });
  }

  // GAP DE AUDITORIA FECHADO (fa-online-store-money-as-number): `deliveryFee`/
  // `minOrderAmount` chegam do body como `number` (limite do JSON), mas são
  // convertidos explicitamente para `Prisma.Decimal` ANTES de persistir — mesmo
  // padrão usado no restante do fluxo de dinheiro deste módulo
  // (public-online-store.routes.ts) e do resto do sistema (financial/*).
  const { deliveryFee, minOrderAmount, ...rest } = parsed.data;
  const data = {
    ...rest,
    deliveryFee: deliveryFee != null ? new Prisma.Decimal(deliveryFee) : deliveryFee,
    minOrderAmount: minOrderAmount != null ? new Prisma.Decimal(minOrderAmount) : minOrderAmount,
  };

  try {
    const settings = await prisma.onlineStoreSettings.upsert({
      where: { tenantId },
      create: { tenantId, ...data },
      update: { ...data },
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
    const { tenantId, userId, role } = req.session!;
    if (!(await hasPermission(role, userId, "online-store:settings:manage"))) {
      return forbidden(res, "Seu nível de acesso não permite configurar a loja online.");
    }
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

const ONLINE_ORDER_STATUSES = ["PENDING", "CONFIRMED", "PREPARING", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"] as const;

onlineStoreRouter.get("/online-store/orders", requireAuth, requireModule("ONLINE_STORE"), async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "online-store:order:read"))) {
    return forbidden(res, "Seu nível de acesso não permite consultar os pedidos da loja online.");
  }
  // GAP DE AUDITORIA FECHADO (fa-online-store-status-unsafe-cast): `status as any`
  // aceitava qualquer string sem validação, quebrando com 500 (Prisma
  // ValidationError) em vez de um 400 claro. Reusa o helper já estabelecido em
  // prior fix round (query-enum.ts), mesmo padrão de outras rotas com filtro por
  // enum.
  const statusParsed = readEnumQuery(res, req.query.status, ONLINE_ORDER_STATUSES, "status");
  if (!statusParsed.ok) return;

  const orders = await prisma.onlineOrder.findMany({
    where: { tenantId, ...(statusParsed.value ? { status: statusParsed.value } : {}) },
    include: { items: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return res.json({ success: true, data: orders, error: null });
});

onlineStoreRouter.get("/online-store/orders/:id", requireAuth, requireModule("ONLINE_STORE"), async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "online-store:order:read"))) {
    return forbidden(res, "Seu nível de acesso não permite consultar os pedidos da loja online.");
  }
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
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "online-store:order:write"))) {
    return forbidden(res, "Seu nível de acesso não permite alterar o status dos pedidos da loja online.");
  }
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

  // GAP DE AUDITORIA FECHADO (fa-online-store-order-status-race): o
  // `findFirst` + `update` acima tem uma janela entre ler o status e escrever o
  // novo — duas requisições concorrentes (ex.: dois atendentes clicando ao
  // mesmo tempo) podiam ambas passar pela checagem de transição válida com o
  // MESMO `order.status` antigo e aplicar transições incompatíveis em sequência
  // (ex.: PREPARING→CANCELLED e, na mesma janela, PREPARING→DELIVERED, uma
  // sobrescrevendo silenciosamente a outra). `updateMany` com `status: order.status`
  // no `where` faz da transição uma operação condicional atômica no banco: só
  // aplica se o status ainda for o mesmo lido; caso contrário, 0 linhas afetadas.
  const updateResult = await prisma.onlineOrder.updateMany({
    where: { id: order.id, tenantId, status: order.status as any },
    data: {
      status: parsed.data.status,
      ...(parsed.data.status === "CANCELLED" ? { cancelReason: parsed.data.cancelReason } : {}),
    },
  });
  if (updateResult.count === 0) {
    return res.status(409).json({
      success: false,
      data: null,
      error: { code: "CONCURRENT_STATUS_CHANGE", message: "O status deste pedido mudou nesse meio tempo. Recarregue e tente novamente." },
    });
  }

  const updated = await prisma.onlineOrder.findFirst({ where: { id: order.id, tenantId }, include: { items: true } });
  return res.json({ success: true, data: updated, error: null });
});


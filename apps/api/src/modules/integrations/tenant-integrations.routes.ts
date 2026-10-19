// apps/api/src/modules/integrations/tenant-integrations.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 8 (emissão self-service, citada em
// prosa) + Capítulo 15.4 (modelos `TenantApiKey`/`TenantWebhookEndpoint`,
// oversight do painel global). GAP DE AUDITORIA ENCONTRADO E CORRIGIDO: o
// Capítulo 15.4 deixa explícito que "a emissão inicial ocorre no app do
// tenant (Capítulo 8)", mas nenhuma rota self-service de criação jamais
// existiu — só o oversight do painel global foi coberto
// (`platform-admin.routes.ts`, que só lista/revoga, nunca cria).
// Reaproveita a permissão já seedada `settings:integrations:manage`.
import { Router, Request, Response } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import { prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";
import { hashApiKey } from "../platform-admin/platform-admin.routes";
import { encryptEnvelope } from "../../lib/envelope-crypto";

export const tenantIntegrationsRouter = Router();

async function hasPermission(role: string, userId: string, permissionCode: string): Promise<boolean> {
  const [defaultGrant, override] = await Promise.all([
    prisma.roleDefaultPermission.findUnique({ where: { role_permissionCode: { role: role as any, permissionCode } } }),
    prisma.rolePermission.findUnique({ where: { userId_permission: { userId, permission: permissionCode } } }),
  ]);
  return override ? override.granted : Boolean(defaultGrant);
}

async function requireIntegrationsManage(req: Request, res: Response): Promise<boolean> {
  const { userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "settings:integrations:manage"))) {
    res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite gerenciar integrações." } });
    return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────
// API KEYS
// ─────────────────────────────────────────────────────────────────────────

// Nunca retorna `keyHash` — apenas `keyPrefix`, suficiente para identificação
// sem reexpor o segredo (igual ao comentário do schema).
const API_KEY_LIST_SELECT = {
  id: true,
  tenantId: true,
  label: true,
  keyPrefix: true,
  scopes: true,
  lastUsedAt: true,
  revokedAt: true,
  createdAt: true,
} as const;

tenantIntegrationsRouter.get("/integrations/api-keys", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireIntegrationsManage(req, res))) return;
  const { tenantId } = req.session!;
  const keys = await prisma.tenantApiKey.findMany({ where: { tenantId }, select: API_KEY_LIST_SELECT, orderBy: { createdAt: "desc" } });
  return res.json({ success: true, data: keys, error: null });
});

const createApiKeySchema = z.object({
  label: z.string().min(1),
  scopes: z.array(z.string()).min(1),
});

tenantIntegrationsRouter.post("/integrations/api-keys", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireIntegrationsManage(req, res))) return;
  const parsed = createApiKeySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const { tenantId } = req.session!;

  // Chave gerada com prefixo identificável + corpo aleatório criptograficamente
  // seguro — exibida em claro apenas nesta resposta, nunca mais recuperável.
  const rawBody = crypto.randomBytes(24).toString("hex");
  const keyPrefix = `fltk_live_${rawBody.slice(0, 8)}`;
  const rawKey = `${keyPrefix}_${rawBody}`;

  const apiKey = await prisma.tenantApiKey.create({
    data: {
      tenantId,
      label: parsed.data.label,
      scopes: parsed.data.scopes,
      keyHash: hashApiKey(rawKey),
      keyPrefix,
    },
  });

  return res.status(201).json({
    success: true,
    data: { id: apiKey.id, label: apiKey.label, scopes: apiKey.scopes, keyPrefix: apiKey.keyPrefix, rawKey, createdAt: apiKey.createdAt },
    error: null,
  });
});

tenantIntegrationsRouter.post("/integrations/api-keys/:id/revoke", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireIntegrationsManage(req, res))) return;
  const { tenantId } = req.session!;
  const key = await prisma.tenantApiKey.findFirst({ where: { id: req.params.id, tenantId } });
  if (!key) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Chave de API não encontrada." } });
  }
  const updated = await prisma.tenantApiKey.update({ where: { id: key.id }, data: { revokedAt: new Date() }, select: API_KEY_LIST_SELECT });
  return res.json({ success: true, data: updated, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// WEBHOOK ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────

tenantIntegrationsRouter.get("/integrations/webhook-endpoints", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireIntegrationsManage(req, res))) return;
  const { tenantId } = req.session!;
  const endpoints = await prisma.tenantWebhookEndpoint.findMany({
    where: { tenantId },
    select: { id: true, tenantId: true, url: true, eventTypes: true, active: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  return res.json({ success: true, data: endpoints, error: null });
});

const createWebhookEndpointSchema = z.object({
  url: z.string().url(),
  eventTypes: z.array(z.string()).min(1),
});

// CORREÇÃO DE AUDITORIA: a URL de webhook era aceita sem nenhuma checagem de
// destino, permitindo SSRF (o backend faria POST para IP interno/metadata da
// nuvem a partir de uma URL cadastrada pelo próprio tenant). Bloqueia protocolo
// não-HTTPS (exceto localhost em dev) e hosts/IPs privados conhecidos LITERAIS
// nesta validação de CADASTRO (feedback rápido ao usuário, sem round-trip de DNS
// na rota HTTP). A proteção DEFINITIVA contra DNS rebinding/redirecionamento —
// que esta checagem literal sozinha não cobre — está em
// `lib/ssrf-safe-fetch.ts`, usado pelo worker de ENTREGA real
// (`webhook-delivery.worker.ts`), que resolve e valida o IP no exato momento da
// conexão TCP e nunca segue 3xx (mega-audit rodada 10).
const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./, /^0\.0\.0\.0$/, /^::1$/,
  /^10\./, /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^169\.254\./, // link-local, inclui metadata da nuvem (169.254.169.254)
  /^\[?::1\]?$/, /^\[?fc00:/i, /^\[?fe80:/i,
];
function isSsrfUnsafeWebhookUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return true;
  }
  if (parsed.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && parsed.protocol === "http:")) {
    return true;
  }
  return PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(parsed.hostname));
}

tenantIntegrationsRouter.post("/integrations/webhook-endpoints", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireIntegrationsManage(req, res))) return;
  const parsed = createWebhookEndpointSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  if (isSsrfUnsafeWebhookUrl(parsed.data.url)) {
    return res.status(400).json({ success: false, data: null, error: { code: "UNSAFE_WEBHOOK_URL", message: "A URL do webhook deve ser HTTPS pública e não pode apontar para um host/IP interno." } });
  }
  const { tenantId } = req.session!;
  // `signingSecretEncrypted` reaproveita a mesma convenção de criptografia já
  // usada no restante do projeto (envelope-crypto.ts) — aqui a string crua é
  // mantida apenas em memória e devolvida uma única vez na resposta.
  const signingSecret = crypto.randomBytes(32).toString("hex");
  const sealed = encryptEnvelope({ signingSecret });
  const endpoint = await prisma.tenantWebhookEndpoint.create({
    data: {
      tenantId,
      url: parsed.data.url,
      eventTypes: parsed.data.eventTypes,
      signingSecretEncrypted: `${sealed.encryptionKeyId}:${sealed.payload.toString("base64")}`,
    },
  });
  return res.status(201).json({
    success: true,
    data: { id: endpoint.id, url: endpoint.url, eventTypes: endpoint.eventTypes, active: endpoint.active, signingSecret, createdAt: endpoint.createdAt },
    error: null,
  });
});

const patchWebhookEndpointSchema = z.object({
  eventTypes: z.array(z.string()).min(1).optional(),
  active: z.boolean().optional(),
});

tenantIntegrationsRouter.patch("/integrations/webhook-endpoints/:id", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireIntegrationsManage(req, res))) return;
  const parsed = patchWebhookEndpointSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const { tenantId } = req.session!;
  const endpoint = await prisma.tenantWebhookEndpoint.findFirst({ where: { id: req.params.id, tenantId } });
  if (!endpoint) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Endpoint de webhook não encontrado." } });
  }
  const updated = await prisma.tenantWebhookEndpoint.update({
    where: { id: endpoint.id },
    data: parsed.data,
    select: { id: true, tenantId: true, url: true, eventTypes: true, active: true, createdAt: true },
  });
  return res.json({ success: true, data: updated, error: null });
});

tenantIntegrationsRouter.get("/integrations/webhook-endpoints/:id/deliveries", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireIntegrationsManage(req, res))) return;
  const { tenantId } = req.session!;
  const endpoint = await prisma.tenantWebhookEndpoint.findFirst({ where: { id: req.params.id, tenantId } });
  if (!endpoint) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Endpoint de webhook não encontrado." } });
  }
  const deliveries = await prisma.webhookDelivery.findMany({ where: { endpointId: endpoint.id }, orderBy: { deliveredAt: "desc" }, take: 100 });
  return res.json({ success: true, data: deliveries, error: null });
});

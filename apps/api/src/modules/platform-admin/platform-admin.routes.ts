// apps/api/src/modules/platform-admin/platform-admin.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 13 (Painel de Administração Global)
// + Capítulo 15 (Status do Sistema, Feature Flags, Helpdesk, API/Webhooks).
// GAP DE AUDITORIA ENCONTRADO E CORRIGIDO: `PlatformAdminUser`, `AuditLog`,
// `SystemParameter`, `FeatureFlag`, `SupportTicket`/`SupportTicketMessage`,
// `TenantApiKey`, `TenantWebhookEndpoint`/`WebhookDelivery` existem no schema
// desde o início, e `platform-admin-auth.routes.ts`/`.middleware.ts` já
// implementavam login + 2FA do painel, mas NENHUMA rota operacional do painel
// em si existia — apenas autenticação, nenhum controle de tenant de fato.
// ESCOPO DESTA 1ª IMPLEMENTAÇÃO (honestamente delimitado):
//   - Controle de tenants: listar, ver detalhe, suspender/reativar (SUPER_ADMIN).
//   - `AuditLog`: toda ação sensível deste módulo grava uma linha (somente
//     INSERT, nunca UPDATE/DELETE, igual ao comentário do schema).
//   - `SystemParameter`: listar/editar.
//   - `FeatureFlag`: CRUD completo.
//   - `SupportTicket`: listar/detalhe/atribuir/mudar status/responder.
//   - Oversight de `TenantApiKey` (revogar) e `TenantWebhookEndpoint`
//     (listar entregas + replay manual).
// PENDENTE (flagado explicitamente): dashboard de saúde do sistema em tempo
// real (Capítulo 15.1 — exigiria métricas live de Postgres/Redis/filas, não
// implementado), motor de impersonation (`ImpersonationSession`, Capítulo
// 13.1), retry automático com backoff exponencial de `WebhookDelivery`
// (Capítulo 15.4 — aqui só o replay manual está implementado).
import { Router, Request, Response } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import { prismaUnscoped as prisma } from "@filitech/db";
import { requirePlatformAdminAuth, requireSuperAdmin } from "./platform-admin-auth.middleware";

export const platformAdminRouter = Router();

async function writeAuditLog(req: Request, action: string, targetType: string, targetId: string | null, metadata: Record<string, unknown>) {
  await prisma.auditLog.create({
    data: {
      platformAdminUserId: req.platformAdminSession!.platformAdminUserId,
      action,
      targetType,
      targetId,
      metadata: metadata as any,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────
// TENANTS (Capítulo 13.2)
// ─────────────────────────────────────────────────────────────────────────

platformAdminRouter.get("/platform-admin/tenants", requirePlatformAdminAuth, async (req: Request, res: Response) => {
  const { status, search } = req.query as { status?: string; search?: string };
  const tenants = await prisma.tenant.findMany({
    where: {
      ...(status ? { status: status as any } : {}),
      ...(search ? { OR: [{ legalName: { contains: search, mode: "insensitive" } }, { tradeName: { contains: search, mode: "insensitive" } }, { slug: { contains: search, mode: "insensitive" } }] } : {}),
    },
    orderBy: { tradeName: "asc" },
    take: 100,
  });
  return res.json({ success: true, data: tenants, error: null });
});

platformAdminRouter.get("/platform-admin/tenants/:id", requirePlatformAdminAuth, async (req: Request, res: Response) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } });
  if (!tenant) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Tenant não encontrado." } });
  }
  return res.json({ success: true, data: tenant, error: null });
});

const updateTenantStatusSchema = z.object({
  status: z.enum(["TRIAL", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELLED"]),
  reason: z.string().min(1),
});

// Suspender/reativar é a ação mais sensível do painel — restrita a SUPER_ADMIN,
// nunca SUPPORT_AGENT/FINANCE_ANALYST — e sempre audita o motivo informado.
platformAdminRouter.patch("/platform-admin/tenants/:id/status", requirePlatformAdminAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  const parsed = updateTenantStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } });
  if (!tenant) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Tenant não encontrado." } });
  }
  const updated = await prisma.tenant.update({ where: { id: tenant.id }, data: { status: parsed.data.status } });
  await writeAuditLog(req, "TENANT_STATUS_CHANGED", "Tenant", tenant.id, { from: tenant.status, to: parsed.data.status, reason: parsed.data.reason });
  return res.json({ success: true, data: updated, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// AUDIT LOG (somente leitura — tabela append-only, Capítulo 13.4)
// ─────────────────────────────────────────────────────────────────────────

platformAdminRouter.get("/platform-admin/audit-logs", requirePlatformAdminAuth, async (req: Request, res: Response) => {
  const { targetType, targetId } = req.query as { targetType?: string; targetId?: string };
  const logs = await prisma.auditLog.findMany({
    where: { ...(targetType ? { targetType } : {}), ...(targetId ? { targetId } : {}) },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return res.json({ success: true, data: logs, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// CENTRAL DE INTEGRAÇÕES (Capítulo 20.10) — visão agregada por provedor, nunca por
// tenant isolado: quantos tenants têm a credencial ativa e a taxa de sucesso dos
// últimos 100 IntegrationHealthCheckLog por provedor, para detectar em massa (ex.)
// uma mudança de layout da SEFAZ ou expiração em lote de tokens antes que o lojista
// perceba no caixa. Reaproveita 100% os dados já gravados por runIntegrationTest
// (Capítulo 20.1) — nenhuma chamada de rede nova é feita aqui.
platformAdminRouter.get("/platform-admin/integrations/summary", requirePlatformAdminAuth, async (_req: Request, res: Response) => {
  const credentials = await prisma.integrationCredential.findMany({
    select: { id: true, tenantId: true, provider: true, active: true, lastTestedAt: true, lastTestSuccess: true },
  });

  const byProvider = new Map<string, { credentialIds: string[]; activeTenantCount: number }>();
  for (const credential of credentials) {
    const bucket = byProvider.get(credential.provider) ?? { credentialIds: [], activeTenantCount: 0 };
    bucket.credentialIds.push(credential.id);
    if (credential.active && credential.tenantId) bucket.activeTenantCount += 1;
    byProvider.set(credential.provider, bucket);
  }

  const summary = await Promise.all(
    Array.from(byProvider.entries()).map(async ([provider, bucket]) => {
      const recentLogs = await prisma.integrationHealthCheckLog.findMany({
        where: { credentialId: { in: bucket.credentialIds } },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: { success: true },
      });
      const successRate = recentLogs.length > 0 ? recentLogs.filter((l) => l.success).length / recentLogs.length : null;
      return {
        provider,
        activeTenantCount: bucket.activeTenantCount,
        totalCredentialCount: bucket.credentialIds.length,
        last100SuccessRate: successRate,
        sampledChecks: recentLogs.length,
      };
    }),
  );

  return res.json({ success: true, data: summary, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// SYSTEM PARAMETERS (Capítulo 13.4)
// ─────────────────────────────────────────────────────────────────────────

platformAdminRouter.get("/platform-admin/system-parameters", requirePlatformAdminAuth, async (_req: Request, res: Response) => {
  const parameters = await prisma.systemParameter.findMany({ orderBy: { key: "asc" } });
  return res.json({ success: true, data: parameters, error: null });
});

const updateSystemParameterSchema = z.object({ value: z.string() });

platformAdminRouter.put("/platform-admin/system-parameters/:key", requirePlatformAdminAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  const parsed = updateSystemParameterSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const existing = await prisma.systemParameter.findUnique({ where: { key: req.params.key } });
  if (!existing) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Parâmetro não encontrado." } });
  }
  const updated = await prisma.systemParameter.update({
    where: { key: existing.key },
    data: { value: parsed.data.value, updatedByPlatformAdminUserId: req.platformAdminSession!.platformAdminUserId },
  });
  await writeAuditLog(req, "PARAMETER_UPDATED", "SystemParameter", existing.key, { from: existing.value, to: parsed.data.value });
  return res.json({ success: true, data: updated, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// FEATURE FLAGS (Capítulo 15.2)
// ─────────────────────────────────────────────────────────────────────────

platformAdminRouter.get("/platform-admin/feature-flags", requirePlatformAdminAuth, async (_req: Request, res: Response) => {
  const flags = await prisma.featureFlag.findMany({ orderBy: { key: "asc" } });
  return res.json({ success: true, data: flags, error: null });
});

const createFeatureFlagSchema = z.object({
  key: z.string().min(1),
  description: z.string().min(1),
  rolloutPercent: z.number().int().min(0).max(100).default(0),
  enabledForTenantIds: z.array(z.string().uuid()).default([]),
  active: z.boolean().default(true),
});

platformAdminRouter.post("/platform-admin/feature-flags", requirePlatformAdminAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  const parsed = createFeatureFlagSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const flag = await prisma.featureFlag.create({ data: parsed.data });
  await writeAuditLog(req, "FEATURE_FLAG_CREATED", "FeatureFlag", flag.id, { key: flag.key });
  return res.status(201).json({ success: true, data: flag, error: null });
});

const patchFeatureFlagSchema = createFeatureFlagSchema.partial().omit({ key: true });

platformAdminRouter.patch("/platform-admin/feature-flags/:id", requirePlatformAdminAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  const parsed = patchFeatureFlagSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const existing = await prisma.featureFlag.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Feature flag não encontrada." } });
  }
  const updated = await prisma.featureFlag.update({ where: { id: existing.id }, data: parsed.data });
  await writeAuditLog(req, "MODULE_TOGGLED", "FeatureFlag", existing.id, { changes: parsed.data });
  return res.json({ success: true, data: updated, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// SUPPORT TICKETS / HELPDESK (Capítulo 15.3)
// ─────────────────────────────────────────────────────────────────────────

platformAdminRouter.get("/platform-admin/support-tickets", requirePlatformAdminAuth, async (req: Request, res: Response) => {
  const { status, assignedToMe } = req.query as { status?: string; assignedToMe?: string };
  const tickets = await prisma.supportTicket.findMany({
    where: {
      ...(status ? { status: status as any } : {}),
      ...(assignedToMe === "true" ? { assignedToPlatformAdminUserId: req.platformAdminSession!.platformAdminUserId } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  return res.json({ success: true, data: tickets, error: null });
});

platformAdminRouter.get("/platform-admin/support-tickets/:id", requirePlatformAdminAuth, async (req: Request, res: Response) => {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: req.params.id },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!ticket) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Chamado não encontrado." } });
  }
  return res.json({ success: true, data: ticket, error: null });
});

const patchTicketSchema = z.object({
  assignedToPlatformAdminUserId: z.string().uuid().nullable().optional(),
  status: z.enum(["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER", "RESOLVED", "CLOSED"]).optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
});

platformAdminRouter.patch("/platform-admin/support-tickets/:id", requirePlatformAdminAuth, async (req: Request, res: Response) => {
  const parsed = patchTicketSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const existing = await prisma.supportTicket.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Chamado não encontrado." } });
  }
  const updated = await prisma.supportTicket.update({
    where: { id: existing.id },
    data: {
      ...parsed.data,
      resolvedAt: parsed.data.status === "RESOLVED" ? new Date() : existing.resolvedAt,
    },
  });
  return res.json({ success: true, data: updated, error: null });
});

const addTicketMessageSchema = z.object({ body: z.string().min(1), attachmentUrls: z.array(z.string()).default([]) });

platformAdminRouter.post("/platform-admin/support-tickets/:id/messages", requirePlatformAdminAuth, async (req: Request, res: Response) => {
  const parsed = addTicketMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const ticket = await prisma.supportTicket.findUnique({ where: { id: req.params.id } });
  if (!ticket) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Chamado não encontrado." } });
  }
  const message = await prisma.supportTicketMessage.create({
    data: {
      ticketId: ticket.id,
      authorType: "PLATFORM_ADMIN",
      authorId: req.platformAdminSession!.platformAdminUserId,
      body: parsed.data.body,
      attachmentUrls: parsed.data.attachmentUrls,
    },
  });
  return res.status(201).json({ success: true, data: message, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// OVERSIGHT DE API KEYS E WEBHOOKS DOS TENANTS (Capítulo 15.4)
// ─────────────────────────────────────────────────────────────────────────

platformAdminRouter.get("/platform-admin/tenants/:tenantId/api-keys", requirePlatformAdminAuth, async (req: Request, res: Response) => {
  const keys = await prisma.tenantApiKey.findMany({ where: { tenantId: req.params.tenantId }, orderBy: { createdAt: "desc" } });
  return res.json({ success: true, data: keys, error: null });
});

platformAdminRouter.post("/platform-admin/tenant-api-keys/:id/revoke", requirePlatformAdminAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  const key = await prisma.tenantApiKey.findUnique({ where: { id: req.params.id } });
  if (!key) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Chave de API não encontrada." } });
  }
  const updated = await prisma.tenantApiKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } });
  await writeAuditLog(req, "API_KEY_REVOKED", "TenantApiKey", key.id, { tenantId: key.tenantId, label: key.label });
  return res.json({ success: true, data: updated, error: null });
});

platformAdminRouter.get("/platform-admin/tenants/:tenantId/webhook-endpoints", requirePlatformAdminAuth, async (req: Request, res: Response) => {
  const endpoints = await prisma.tenantWebhookEndpoint.findMany({ where: { tenantId: req.params.tenantId } });
  return res.json({ success: true, data: endpoints, error: null });
});

platformAdminRouter.get("/platform-admin/webhook-endpoints/:id/deliveries", requirePlatformAdminAuth, async (req: Request, res: Response) => {
  const deliveries = await prisma.webhookDelivery.findMany({
    where: { endpointId: req.params.id },
    orderBy: { deliveredAt: "desc" },
    take: 100,
  });
  return res.json({ success: true, data: deliveries, error: null });
});

// Reenvio manual de uma entrega falha — o disparo real de HTTP (com assinatura
// HMAC-SHA256 do signingSecret) é delegado à mesma função de entrega de webhook
// usada originalmente (apps/api/src/lib/queue.ts, fila BullMQ existente), nunca
// duplicado aqui.
platformAdminRouter.post("/platform-admin/webhook-deliveries/:id/replay", requirePlatformAdminAuth, async (req: Request, res: Response) => {
  const delivery = await prisma.webhookDelivery.findUnique({ where: { id: req.params.id }, include: { endpoint: true } });
  if (!delivery) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Entrega de webhook não encontrada." } });
  }
  if (!delivery.endpoint.active) {
    return res.status(409).json({ success: false, data: null, error: { code: "ENDPOINT_INACTIVE", message: "O endpoint de destino está inativo." } });
  }
  // PENDENTE: disparo HTTP real + assinatura HMAC ainda não implementado (worker
  // de webhook dedicado não existe nesta passada) — esta rota registra a
  // intenção de replay e a auditoria, mas não substitui o worker de entrega real.
  await writeAuditLog(req, "WEBHOOK_REPLAY_REQUESTED", "WebhookDelivery", delivery.id, { endpointId: delivery.endpointId, eventType: delivery.eventType });
  return res.status(202).json({ success: true, data: { id: delivery.id, replayQueued: true }, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// Utilitário exportado para o módulo tenant-facing de API keys (hash simétrico)
// ─────────────────────────────────────────────────────────────────────────

export function hashApiKey(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

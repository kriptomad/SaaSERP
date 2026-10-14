// apps/api/src/modules/notifications/notification-settings.routes.ts
// GAP DE AUDITORIA: `NotificationPreference` e `PushDeviceToken` existiam no schema sem nenhuma rota.
//
// Autorização: ambos os recursos são DADOS PESSOAIS do usuário logado (`userId` vem sempre de req.session,
// nunca do body/URL) — por isso só `requireAuth`, sem código RBAC novo: um usuário nunca lê/edita a
// preferência ou o dispositivo de outro, nem mesmo um OWNER (não há "settings:users:manage" aqui).
//
// Regras do schema real: `@@unique([userId, category])`; `push: true` "exige PushDeviceToken ativo";
// `expoPushToken` é @unique GLOBAL (um aparelho só pertence a um usuário por vez).
import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";

export const notificationSettingsRouter = Router();

const CATEGORIES = [
  "WORK_ORDER_STATUS",
  "SUPPORT_TICKET_UPDATE",
  "CASH_FLOW_ALERT",
  "BILLING_DUNNING",
  "ACCOUNTING_TASK_REMINDER",
  "STOCK_LOW",
  "FISCAL_DOCUMENT_REJECTED",
  "SYSTEM_ANNOUNCEMENT",
] as const;
type Category = (typeof CATEGORIES)[number];

// Defaults do schema (inApp/email true; push/whatsapp false) para categorias ainda sem linha.
const DEFAULTS = { inApp: true, email: true, push: false, whatsapp: false };

const fail = (res: Response, status: number, code: string, message: string, details?: unknown) =>
  res.status(status).json({ success: false, data: null, error: { code, message, ...(details ? { details } : {}) } });

async function hasActivePushDevice(userId: string): Promise<boolean> {
  return (await prisma.pushDeviceToken.count({ where: { userId, revokedAt: null } })) > 0;
}

// ─────────────────────────────────────────────────────────────────────────
// PREFERÊNCIAS
// ─────────────────────────────────────────────────────────────────────────

notificationSettingsRouter.get("/notification-preferences", requireAuth, async (req: Request, res: Response) => {
  const { userId } = req.session!;
  const rows = await prisma.notificationPreference.findMany({ where: { userId } });
  const byCategory = new Map(rows.map((r) => [r.category as string, r]));
  const data = CATEGORIES.map((category) => {
    const r = byCategory.get(category);
    return {
      category,
      inApp: r?.inApp ?? DEFAULTS.inApp,
      email: r?.email ?? DEFAULTS.email,
      push: r?.push ?? DEFAULTS.push,
      whatsapp: r?.whatsapp ?? DEFAULTS.whatsapp,
      isDefault: !r,
    };
  });
  return res.json({ success: true, data, error: null });
});

const channelsSchema = z.object({
  inApp: z.boolean().optional(),
  email: z.boolean().optional(),
  push: z.boolean().optional(),
  whatsapp: z.boolean().optional(),
});

async function upsertPreference(tenantId: string, userId: string, category: Category, channels: z.infer<typeof channelsSchema>) {
  return prisma.notificationPreference.upsert({
    where: { userId_category: { userId, category } },
    update: channels,
    create: { tenantId, userId, category, ...channels },
  });
}

notificationSettingsRouter.put("/notification-preferences/:category", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId } = req.session!;
  const category = req.params.category as Category;
  if (!CATEGORIES.includes(category)) return fail(res, 400, "INVALID_CATEGORY", "Categoria de notificação inválida.");
  const parsed = channelsSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "VALIDATION_ERROR", "Dados inválidos.", parsed.error.flatten());
  if (Object.keys(parsed.data).length === 0) return fail(res, 400, "VALIDATION_ERROR", "Informe ao menos um canal.");

  if (parsed.data.push === true && !(await hasActivePushDevice(userId))) {
    return fail(res, 409, "PUSH_REQUIRES_DEVICE", "Registre um dispositivo (POST /push-devices) antes de ativar notificações push.");
  }
  const pref = await upsertPreference(tenantId, userId, category, parsed.data);
  return res.json({ success: true, data: pref, error: null });
});

const bulkSchema = z.object({
  preferences: z.array(channelsSchema.extend({ category: z.enum(CATEGORIES) })).min(1).max(CATEGORIES.length),
});

notificationSettingsRouter.put("/notification-preferences", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId } = req.session!;
  const parsed = bulkSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "VALIDATION_ERROR", "Dados inválidos.", parsed.error.flatten());
  const categories = parsed.data.preferences.map((p) => p.category);
  if (new Set(categories).size !== categories.length) return fail(res, 400, "DUPLICATE_CATEGORY", "Categoria repetida na lista.");

  if (parsed.data.preferences.some((p) => p.push === true) && !(await hasActivePushDevice(userId))) {
    return fail(res, 409, "PUSH_REQUIRES_DEVICE", "Registre um dispositivo (POST /push-devices) antes de ativar notificações push.");
  }
  const saved = await prisma.$transaction(
    parsed.data.preferences.map(({ category, ...channels }) =>
      prisma.notificationPreference.upsert({
        where: { userId_category: { userId, category } },
        update: channels,
        create: { tenantId, userId, category, ...channels },
      }),
    ),
  );
  return res.json({ success: true, data: saved, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// DISPOSITIVOS PUSH
// ─────────────────────────────────────────────────────────────────────────

notificationSettingsRouter.get("/push-devices", requireAuth, async (req: Request, res: Response) => {
  const { userId } = req.session!;
  const devices = await prisma.pushDeviceToken.findMany({
    where: { userId, revokedAt: null },
    select: { id: true, platform: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  return res.json({ success: true, data: devices, error: null });
});

const registerSchema = z.object({
  platform: z.enum(["IOS", "ANDROID", "WEB"]),
  expoPushToken: z.string().trim().regex(/^(Expo|Exponent)PushToken\[[^\]\s]+\]$/, "Token Expo Push inválido."),
});

notificationSettingsRouter.post("/push-devices", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId } = req.session!;
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "VALIDATION_ERROR", "Dados inválidos.", parsed.error.flatten());
  const { platform, expoPushToken } = parsed.data;

  // Idempotente: reinstalar o app ou trocar de usuário no mesmo aparelho reatribui o token ao usuário autenticado.
  const device = await prisma.pushDeviceToken.upsert({
    where: { expoPushToken },
    update: { tenantId, userId, platform, revokedAt: null },
    create: { tenantId, userId, platform, expoPushToken },
    select: { id: true, platform: true, createdAt: true },
  });
  return res.status(201).json({ success: true, data: device, error: null });
});

notificationSettingsRouter.delete("/push-devices/:id", requireAuth, async (req: Request, res: Response) => {
  const { userId } = req.session!;
  const device = await prisma.pushDeviceToken.findFirst({ where: { id: req.params.id, userId } });
  if (!device) return fail(res, 404, "NOT_FOUND", "Dispositivo não encontrado.");

  // Revoga (soft) em vez de apagar: mantém a trilha e o worker de push ignora `revokedAt != null`.
  await prisma.pushDeviceToken.update({ where: { id: device.id }, data: { revokedAt: device.revokedAt ?? new Date() } });
  // Sem nenhum aparelho ativo, `push: true` ficaria inconsistente — desliga em todas as categorias.
  if (!(await hasActivePushDevice(userId))) {
    await prisma.notificationPreference.updateMany({ where: { userId, push: true }, data: { push: false } });
  }
  return res.json({ success: true, data: { id: device.id, revoked: true }, error: null });
});

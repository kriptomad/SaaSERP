// apps/api/src/modules/platform-admin/platform-secrets.routes.ts
// Rotas do painel admin para configurar credenciais de PLATAFORMA (Stripe, Asaas,
// CORS, licenciamento) sem depender de `process.env` — ver `apps/api/src/lib/
// platform-secrets.ts` para a camada de resolução/criptografia. Mesmo padrão de
// autenticação/RBAC/audit-log de `platform-admin.routes.ts`: `requirePlatformAdminAuth`
// para leitura, `requireSuperAdmin` para a gravação (ação sensível — credenciais reais
// de cobrança/integrações), e toda escrita grava uma linha append-only em `AuditLog`.
import { Router, Request, Response } from "express";
import { z } from "zod";
import { prismaUnscoped as prisma } from "@filitech/db";
import { requirePlatformAdminAuth, requireSuperAdmin } from "./platform-admin-auth.middleware";
import { PLATFORM_SECRET_REGISTRY, listPlatformSecretStatuses, setPlatformSecret } from "../../lib/platform-secrets";
import { testR2Connection } from "../../lib/object-storage";
import { testPluggyConnection } from "../../lib/pluggy-client";

export const platformSecretsRouter = Router();

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

// GET /platform-admin/platform-secrets — visão do painel: nunca devolve o valor real,
// só a origem (banco/env/nenhuma) e um preview mascarado (Capítulo 20.9).
platformSecretsRouter.get("/platform-admin/platform-secrets", requirePlatformAdminAuth, async (_req: Request, res: Response) => {
  const statuses = await listPlatformSecretStatuses();
  return res.json({ success: true, data: statuses, error: null });
});

const updateSecretSchema = z.object({ value: z.string().min(1).nullable() });

// PUT /platform-admin/platform-secrets/:key — grava/remove o override. Restrito a
// SUPER_ADMIN: estas credenciais afetam cobrança e integrações reais (nunca
// SUPPORT_AGENT/FINANCE_ANALYST). O valor real NUNCA é gravado no audit log.
platformSecretsRouter.put(
  "/platform-admin/platform-secrets/:key",
  requirePlatformAdminAuth,
  requireSuperAdmin,
  async (req: Request, res: Response) => {
    const { key } = req.params;
    if (!PLATFORM_SECRET_REGISTRY.some((d) => d.key === key)) {
      return res.status(400).json({
        success: false,
        data: null,
        error: { code: "UNKNOWN_SECRET_KEY", message: `Chave de credencial de plataforma desconhecida: ${key}.` },
      });
    }

    const parsed = updateSecretSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
    }

    await setPlatformSecret(key, parsed.data.value, req.platformAdminSession!.platformAdminUserId);
    await writeAuditLog(req, "platform_secret.update", "PlatformSecret", key, { key, hadValue: Boolean(parsed.data.value) });

    const statuses = await listPlatformSecretStatuses();
    const updated = statuses.find((s) => s.key === key) ?? null;
    return res.json({ success: true, data: updated, error: null });
  },
);

// POST /platform-admin/platform-secrets/test-r2 — gap de auditoria fechado: as 4
// credenciais do R2 podiam ser salvas pelo painel, mas não havia nenhum jeito de
// confirmar que elas realmente funcionam (HeadBucket real, nunca simulado).
platformSecretsRouter.post(
  "/platform-admin/platform-secrets/test-r2",
  requirePlatformAdminAuth,
  requireSuperAdmin,
  async (req: Request, res: Response) => {
    const result = await testR2Connection();
    await writeAuditLog(req, "platform_secret.test_r2", "PlatformSecret", "R2_BUCKET_NAME", { success: result.success });
    return res.json({ success: true, data: result, error: null });
  },
);

// POST /platform-admin/platform-secrets/test-pluggy — gap de auditoria fechado: o
// clientId/clientSecret da Pluggy podiam ser salvos pelo painel, mas não havia como
// confirmar que o par realmente autentica (POST /auth real na API da Pluggy, nunca
// simulado), mesmo padrão de `test-r2` acima.
platformSecretsRouter.post(
  "/platform-admin/platform-secrets/test-pluggy",
  requirePlatformAdminAuth,
  requireSuperAdmin,
  async (req: Request, res: Response) => {
    const result = await testPluggyConnection();
    await writeAuditLog(req, "platform_secret.test_pluggy", "PlatformSecret", "PLUGGY_CLIENT_ID", { success: result.success });
    return res.json({ success: true, data: result, error: null });
  },
);

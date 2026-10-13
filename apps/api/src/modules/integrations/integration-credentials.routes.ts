// apps/api/src/modules/integrations/integration-credentials.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 20 (integrações) + Capítulo 20.1 (envelope
// de credenciais, KMS). CRUD administrativo de `IntegrationCredential`, protegido por
// RBAC "settings:integrations:manage" (OWNER/MANAGER, ver seed.ts). Resolve o gap
// identificado na auditoria: a primitiva de criptografia (`envelope-crypto.ts`) já
// existia, mas nenhuma rota real a envolvia para o lojista cadastrar/testar/rotacionar
// credenciais pelo painel.
//
// Convenção de resposta (Capítulo 9): envelope { success, data, error }. O payload
// decifrado NUNCA é devolvido ao cliente em nenhuma rota — apenas metadados e um
// preview mascarado (últimos 4 caracteres de cada valor string) para o lojista
// confirmar visualmente qual credencial está salva sem expor o segredo completo.
import { Router, Request, Response } from "express";
import { z } from "zod";
import { prismaUnscoped as prisma, IntegrationProvider, IntegrationEnvironment } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";
import { encryptEnvelope, decryptEnvelope } from "../../lib/envelope-crypto";
import { testIntegrationCredential } from "./test-integration-credential";

export const integrationCredentialsRouter = Router();

async function hasManageIntegrationsPermission(role: string, userId: string): Promise<boolean> {
  const permissionCode = "settings:integrations:manage";
  const [defaultGrant, override] = await Promise.all([
    prisma.roleDefaultPermission.findUnique({
      where: { role_permissionCode: { role: role as any, permissionCode } },
    }),
    prisma.rolePermission.findUnique({
      where: { userId_permission: { userId, permission: permissionCode } },
    }),
  ]);
  return override ? override.granted : Boolean(defaultGrant);
}

function maskPayloadForPreview(payload: Record<string, unknown>): Record<string, string> {
  const masked: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value !== "string" || value.length === 0) {
      masked[key] = "••••";
      continue;
    }
    // Segredos curtos (<12) não revelam nenhum caractere: expor 4 de 5–8 enfraqueceria o segredo de forma relevante.
    const visibleSuffix = value.length >= 12 ? value.slice(-4) : "";
    masked[key] = `${"•".repeat(Math.min(8, Math.max(4, value.length - visibleSuffix.length)))}${visibleSuffix}`;
  }
  return masked;
}

integrationCredentialsRouter.get("/integration-credentials", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasManageIntegrationsPermission(role, userId))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite gerenciar integrações." } });
  }

  const credentials = await prisma.integrationCredential.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
  });

  const data = credentials.map((credential) => {
    let preview: Record<string, string> | null = null;
    try {
      const decrypted = decryptEnvelope(Buffer.from(credential.encryptedPayload), credential.encryptionKeyId);
      preview = maskPayloadForPreview(decrypted);
    } catch {
      // Falha ao decifrar (ex.: KEK rotacionada sem reprocessamento) não deve quebrar
      // a listagem — o lojista ainda precisa ver que a credencial existe para poder
      // recadastrá-la.
      preview = null;
    }
    return {
      id: credential.id,
      provider: credential.provider,
      environment: credential.environment,
      active: credential.active,
      lastTestedAt: credential.lastTestedAt,
      lastTestSuccess: credential.lastTestSuccess,
      lastTestMessage: credential.lastTestMessage,
      createdAt: credential.createdAt,
      updatedAt: credential.updatedAt,
      payloadPreview: preview,
    };
  });

  return res.json({ success: true, data, error: null });
});

const upsertCredentialSchema = z.object({
  provider: z.nativeEnum(IntegrationProvider),
  environment: z.nativeEnum(IntegrationEnvironment).default("PRODUCTION"),
  payload: z.record(z.unknown()),
});

integrationCredentialsRouter.put("/integration-credentials", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasManageIntegrationsPermission(role, userId))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite gerenciar integrações." } });
  }

  const parsed = upsertCredentialSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const { provider, environment, payload } = parsed.data;

  const { payload: encryptedPayload, encryptionKeyId } = encryptEnvelope(payload as Record<string, unknown>);

  const credential = await prisma.integrationCredential.upsert({
    where: { tenantId_provider_environment: { tenantId, provider, environment } },
    update: { encryptedPayload, encryptionKeyId, active: true, lastTestedAt: null, lastTestSuccess: null, lastTestMessage: null },
    create: { tenantId, provider, environment, encryptedPayload, encryptionKeyId, active: true },
  });

  return res.status(201).json({
    success: true,
    data: {
      id: credential.id,
      provider: credential.provider,
      environment: credential.environment,
      active: credential.active,
      createdAt: credential.createdAt,
      updatedAt: credential.updatedAt,
    },
    error: null,
  });
});

integrationCredentialsRouter.patch("/integration-credentials/:id/deactivate", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasManageIntegrationsPermission(role, userId))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite gerenciar integrações." } });
  }

  const { id } = req.params;
  const existing = await prisma.integrationCredential.findFirst({ where: { id, tenantId } });
  if (!existing) {
    return res.status(404).json({ success: false, data: null, error: { code: "CREDENTIAL_NOT_FOUND", message: "Credencial não encontrada neste tenant." } });
  }

  await prisma.integrationCredential.update({ where: { id }, data: { active: false } });
  return res.json({ success: true, data: { id, active: false }, error: null });
});

integrationCredentialsRouter.post("/integration-credentials/:id/test", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasManageIntegrationsPermission(role, userId))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite gerenciar integrações." } });
  }

  const { id } = req.params;
  const credential = await prisma.integrationCredential.findFirst({ where: { id, tenantId } });
  if (!credential) {
    return res.status(404).json({ success: false, data: null, error: { code: "CREDENTIAL_NOT_FOUND", message: "Credencial não encontrada neste tenant." } });
  }

  const startedAt = Date.now();
  const result = await testIntegrationCredential(credential);
  const latencyMs = Date.now() - startedAt;

  await prisma.$transaction([
    prisma.integrationCredential.update({
      where: { id },
      data: { lastTestedAt: new Date(), lastTestSuccess: result.success, lastTestMessage: result.message },
    }),
    prisma.integrationHealthCheckLog.create({
      data: {
        credentialId: id,
        success: result.success,
        httpStatus: result.httpStatus ?? null,
        latencyMs,
        responseBody: result.responseBodyPreview ?? null,
      },
    }),
  ]);

  return res.json({
    success: true,
    data: { success: result.success, message: result.message, httpStatus: result.httpStatus ?? null, latencyMs },
    error: null,
  });
});

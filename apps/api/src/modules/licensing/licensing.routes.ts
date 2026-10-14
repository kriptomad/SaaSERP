// apps/api/src/modules/licensing/licensing.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 2.10 — Licença Mestra ("licença usuário"):
// controle TÉCNICO de acesso ao ERP (pode logar? quais módulos de nicho estão
// liberados?), com suporte a uso 100% offline após a primeira ativação online.
//
// NUNCA confundir com:
//   - `Subscription`/Tenant Lockout (Capítulo 2.2/2.7) = COBRANÇA (mensalidade em
//     dia ou não). A licença mestra CONSULTA o status de cobrança para decidir se
//     pode emitir/renovar o token offline, mas é uma entidade técnica separada
//     (`TenantLicense`), nunca o mesmo registro.
//   - `User.role` (RBAC interno, Capítulo 7) = "licenças de uso na aplicação"
//     (Owner/Manager/Technician/Cashier/...), que já existia e não é alterado aqui.
//     Ver também `apps/api/src/modules/billing/seat-billing.service.ts` (cobrança
//     por assento de usuário), que é um terceiro conceito independente.
import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma, TenantLicenseStatus } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";
import { isTenantLocked } from "../../middlewares/tenant-lockout.middleware";
import { getOfflineTokenValidityDays, signLicenseToken, verifyLicenseToken } from "./license-token.service";

export const licensingRouter = Router();

const TRIAL_DURATION_DAYS = 15;

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
function validationError(res: Response, details: unknown) {
  return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: "Dados inválidos.", details } });
}

/// Recalcula o status EFETIVO da licença no instante da leitura — o trial de 15 dias
/// é autoexpirável (Capítulo 2.10): nenhum job precisa rodar para "vencer" um trial,
/// o próprio cálculo em tempo de leitura já reflete isso.
function effectiveLicenseStatus(license: { status: TenantLicenseStatus; trialEndsAt: Date | null }): TenantLicenseStatus {
  if (license.status === "TRIAL" && license.trialEndsAt && license.trialEndsAt <= new Date()) {
    return "EXPIRED";
  }
  return license.status;
}

// ─────────────────────────────────────────────────────────────────────────
// POST /licensing/trial — Tier Free/Trial de 15 dias (Capítulo 2.4/2.10), sem
// cartão, ERP no modo mais básico (nenhum módulo de nicho liberado). Uma única vez
// por tenant: se já existe `TenantLicense` (trial usado, ativo ou pago), rejeita.
// ─────────────────────────────────────────────────────────────────────────
licensingRouter.post("/licensing/trial", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "licensing:license:manage"))) {
    return forbidden(res, "Seu nível de acesso não permite gerenciar a licença mestra deste tenant.");
  }

  const existing = await prisma.tenantLicense.findUnique({ where: { tenantId } });
  if (existing) {
    return res.status(409).json({
      success: false,
      data: null,
      error: { code: "TRIAL_ALREADY_GRANTED", message: "Este tenant já possui uma licença mestra (trial ou paga) — o trial é concedido uma única vez." },
    });
  }

  const trialEndsAt = new Date(Date.now() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000);
  const license = await prisma.tenantLicense.create({
    data: { tenantId, status: "TRIAL", trialEndsAt, licensedModules: [] },
  });

  return res.status(201).json({
    success: true,
    data: {
      status: license.status,
      trialEndsAt: license.trialEndsAt,
      licensedModules: license.licensedModules,
    },
    error: null,
  });
});

// ─────────────────────────────────────────────────────────────────────────
// POST /licensing/activate — valida a assinatura (reaproveitando a MESMA regra do
// Tenant Lockout, Capítulo 2.2), grava/atualiza o LicenseActivation do dispositivo e
// emite um token RS256 de curta duração (padrão 7 dias) para uso 100% offline.
// ─────────────────────────────────────────────────────────────────────────
const activateSchema = z.object({
  deviceFingerprint: z.string().min(8),
  deviceLabel: z.string().max(120).nullable().optional(),
});

licensingRouter.post("/licensing/activate", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "licensing:license:manage"))) {
    return forbidden(res, "Seu nível de acesso não permite ativar a licença mestra deste tenant.");
  }

  const parsed = activateSchema.safeParse(req.body);
  if (!parsed.success) {
    return validationError(res, parsed.error.flatten());
  }
  const input = parsed.data;

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { status: true, gracePeriodEndsAt: true } });
  if (isTenantLocked(tenant)) {
    return res.status(402).json({
      success: false,
      data: null,
      error: { code: "TENANT_LOCKED", message: "Assinatura pendente de pagamento. Regularize para ativar a licença mestra.", tenantStatus: tenant.status },
    });
  }

  const license = await prisma.tenantLicense.findUnique({ where: { tenantId } });
  if (!license) {
    return res.status(404).json({
      success: false,
      data: null,
      error: { code: "LICENSE_NOT_PROVISIONED", message: "Nenhuma licença mestra encontrada para este tenant. Solicite o trial (POST /licensing/trial) ou contrate um plano." },
    });
  }

  const effectiveStatus = effectiveLicenseStatus(license);
  if (effectiveStatus === "EXPIRED") {
    return res.status(402).json({
      success: false,
      data: null,
      error: { code: "LICENSE_EXPIRED", message: "A licença mestra (trial) expirou. Contrate um plano para continuar." },
    });
  }
  if (effectiveStatus === "SUSPENDED") {
    return res.status(403).json({
      success: false,
      data: null,
      error: { code: "LICENSE_SUSPENDED", message: "A licença mestra deste tenant foi suspensa pela plataforma." },
    });
  }

  const existingActivation = await prisma.licenseActivation.findUnique({
    where: { tenantLicenseId_deviceFingerprint: { tenantLicenseId: license.id, deviceFingerprint: input.deviceFingerprint } },
  });
  if (existingActivation?.revokedAt) {
    return res.status(403).json({
      success: false,
      data: null,
      error: { code: "DEVICE_REVOKED", message: "Este dispositivo teve a ativação revogada. Contate o administrador do tenant." },
    });
  }

  // Tenant deixou de ser TRIAL no billing (assinou um plano pago) — a licença mestra
  // acompanha essa transição automaticamente na próxima ativação online.
  const nextStatus: TenantLicenseStatus = tenant.status === "TRIAL" ? license.status : "ACTIVE";

  const licensedModules =
    nextStatus === "TRIAL"
      ? []
      : (await prisma.tenantModule.findMany({ where: { tenantId, active: true }, select: { moduleCode: true } })).map((m) => m.moduleCode);

  const validityDays = await getOfflineTokenValidityDays();
  const now = new Date();
  const offlineTokenExpiresAt = new Date(now.getTime() + validityDays * 24 * 60 * 60 * 1000);

  const updatedLicense = await prisma.tenantLicense.update({
    where: { id: license.id },
    data: {
      status: nextStatus,
      licensedModules,
      lastValidatedAt: now,
      offlineTokenIssuedAt: now,
      offlineTokenExpiresAt,
    },
  });

  await prisma.licenseActivation.upsert({
    where: { tenantLicenseId_deviceFingerprint: { tenantLicenseId: license.id, deviceFingerprint: input.deviceFingerprint } },
    create: { tenantLicenseId: license.id, deviceFingerprint: input.deviceFingerprint, deviceLabel: input.deviceLabel ?? null },
    update: { lastSeenAt: now, ...(input.deviceLabel !== undefined ? { deviceLabel: input.deviceLabel } : {}) },
  });

  const token = signLicenseToken(
    { tenantId, status: updatedLicense.status, licensedModules: updatedLicense.licensedModules, deviceFingerprint: input.deviceFingerprint },
    validityDays,
  );

  return res.json({
    success: true,
    data: {
      token,
      status: updatedLicense.status,
      licensedModules: updatedLicense.licensedModules,
      trialEndsAt: updatedLicense.trialEndsAt,
      offlineTokenIssuedAt: updatedLicense.offlineTokenIssuedAt,
      offlineTokenExpiresAt: updatedLicense.offlineTokenExpiresAt,
    },
    error: null,
  });
});

// ─────────────────────────────────────────────────────────────────────────
// POST /licensing/validate — valida o token offline cacheado PURAMENTE por
// criptografia (RS256 + expiração embutida), sem exigir sessão nem bater no banco.
// É exatamente isso que permite o app desktop continuar funcionando sem internet
// dentro da janela de validade (Capítulo 2.10).
// ─────────────────────────────────────────────────────────────────────────
const validateSchema = z.object({ token: z.string().min(10) });

licensingRouter.post("/licensing/validate", async (req: Request, res: Response) => {
  const parsed = validateSchema.safeParse(req.body);
  if (!parsed.success) {
    return validationError(res, parsed.error.flatten());
  }

  try {
    const claims = verifyLicenseToken(parsed.data.token);
    return res.json({
      success: true,
      data: {
        valid: true,
        tenantId: claims.tenantId,
        status: claims.status,
        licensedModules: claims.licensedModules,
        deviceFingerprint: claims.deviceFingerprint,
        issuedAt: claims.issuedAt,
        expiresAt: claims.expiresAt,
      },
      error: null,
    });
  } catch (err: any) {
    const expired = err?.name === "TokenExpiredError";
    return res.json({
      success: true,
      data: {
        valid: false,
        reason: expired ? "TOKEN_EXPIRED" : "TOKEN_INVALID",
      },
      error: null,
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// POST /licensing/activations/:id/revoke — Gap de auditoria fechado: o Owner via
// perder/ter um dispositivo roubado e precisa invalidar o token offline cacheado
// ali imediatamente. Marca `revokedAt` (já consultado por `/licensing/validate` só
// de forma indireta — o token RS256 continua válido até expirar, então a revogação
// efetiva de verdade é feita no próximo refresh online, igual ao Capítulo 2.10.4).
// Para forçar a invalidação mesmo offline antes da expiração do token, a próxima
// chamada de `/licensing/activate` deste mesmo `deviceFingerprint` é bloqueada com
// DEVICE_REVOKED, e o dispositivo não recebe mais tokens novos.
// ─────────────────────────────────────────────────────────────────────────
licensingRouter.post("/licensing/activations/:id/revoke", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "licensing:license:manage"))) {
    return forbidden(res, "Seu nível de acesso não permite revogar dispositivos da licença mestra deste tenant.");
  }

  const license = await prisma.tenantLicense.findUnique({ where: { tenantId } });
  if (!license) {
    return res.status(404).json({ success: false, data: null, error: { code: "LICENSE_NOT_PROVISIONED", message: "Nenhuma licença mestra encontrada para este tenant." } });
  }

  const activation = await prisma.licenseActivation.findFirst({
    where: { id: req.params.id, tenantLicenseId: license.id },
  });
  if (!activation) {
    return res.status(404).json({ success: false, data: null, error: { code: "ACTIVATION_NOT_FOUND", message: "Dispositivo não encontrado nesta licença." } });
  }
  if (activation.revokedAt) {
    return res.json({ success: true, data: { id: activation.id, revokedAt: activation.revokedAt }, error: null });
  }

  const updated = await prisma.licenseActivation.update({
    where: { id: activation.id },
    data: { revokedAt: new Date() },
  });

  return res.json({ success: true, data: { id: updated.id, revokedAt: updated.revokedAt }, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// GET /licensing/status — status atual da licença mestra do tenant autenticado,
// para exibição no painel admin (Owner). Nunca requer o token offline: aqui é
// sempre uma leitura online e fresca contra o banco.
// ─────────────────────────────────────────────────────────────────────────
licensingRouter.get("/licensing/status", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "licensing:license:read"))) {
    return forbidden(res, "Seu nível de acesso não permite consultar a licença mestra deste tenant.");
  }

  const [tenant, license] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { status: true, gracePeriodEndsAt: true } }),
    prisma.tenantLicense.findUnique({
      where: { tenantId },
      include: { activations: { orderBy: { lastSeenAt: "desc" } } },
    }),
  ]);

  if (!license) {
    return res.json({
      success: true,
      data: { license: null, canStartTrial: true, tenantStatus: tenant.status },
      error: null,
    });
  }

  return res.json({
    success: true,
    data: {
      license: {
        status: effectiveLicenseStatus(license),
        trialEndsAt: license.trialEndsAt,
        licensedModules: license.licensedModules,
        lastValidatedAt: license.lastValidatedAt,
        offlineTokenIssuedAt: license.offlineTokenIssuedAt,
        offlineTokenExpiresAt: license.offlineTokenExpiresAt,
      },
      activations: license.activations.map((a) => ({
        id: a.id,
        deviceFingerprint: a.deviceFingerprint,
        deviceLabel: a.deviceLabel,
        activatedAt: a.activatedAt,
        lastSeenAt: a.lastSeenAt,
        revokedAt: a.revokedAt,
      })),
      canStartTrial: false,
      tenantStatus: tenant.status,
      tenantLocked: isTenantLocked(tenant),
    },
    error: null,
  });
});

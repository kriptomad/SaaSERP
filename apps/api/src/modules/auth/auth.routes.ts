// apps/api/src/modules/auth/auth.routes.ts
// Rotas reais de autenticação: signup de tenant (onboarding, Capítulo 1.2) e login
// (JWT RS256, Capítulo 3.5). Usa prismaUnscoped porque ainda não há tenantId de sessão
// nessas duas rotas (são as únicas formas legítimas de criar/entrar em um tenant).
import { Router } from "express";
import { z } from "zod";
import { prismaUnscoped } from "@filitech/db";
import { hashPassword, verifyPassword } from "./password.service";
import { signSessionToken } from "./jwt.service";
import { enforceRateLimit, resetRateLimit, RateLimitExceededError } from "../../lib/rate-limit";
import { authMiddleware, requireAuth } from "../../middlewares/auth.middleware";

export const authRouter = Router();

const signupSchema = z.object({
  legalName: z.string().min(2),
  tradeName: z.string().min(2),
  slug: z
    .string()
    .min(3)
    .regex(/^[a-z0-9-]+$/, "slug deve conter apenas letras minúsculas, números e hífen"),
  cnpj: z.string().optional(),
  tenantType: z.enum(["BUSINESS", "PERSONAL", "ACCOUNTING_OFFICE"]).default("BUSINESS"),
  ownerName: z.string().min(2),
  ownerEmail: z.string().email(),
  ownerPassword: z.string().min(8),
});

authRouter.post("/signup", async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const input = parsed.data;

  // CNPJ obrigatório apenas para tenantType = BUSINESS (Capítulo 22.1).
  if (input.tenantType === "BUSINESS" && !input.cnpj) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: "cnpj é obrigatório para tenantType BUSINESS." } });
  }

  const existingSlug = await prismaUnscoped.tenant.findUnique({ where: { slug: input.slug } });
  if (existingSlug) {
    return res.status(409).json({ success: false, data: null, error: { code: "SLUG_TAKEN", message: "Este identificador já está em uso." } });
  }

  const passwordHash = await hashPassword(input.ownerPassword);

  let created;
  try {
    created = await prismaUnscoped.$transaction(async (tx) => {
    const createdTenant = await tx.tenant.create({
      data: {
        legalName: input.legalName,
        tradeName: input.tradeName,
        slug: input.slug,
        cnpj: input.cnpj ?? null,
        tenantType: input.tenantType,
        status: "TRIAL",
      },
    });

    const createdOwner = await tx.user.create({
      data: {
        tenantId: createdTenant.id,
        name: input.ownerName,
        email: input.ownerEmail,
        passwordHash,
        role: "OWNER",
      },
    });

    return { tenant: createdTenant, owner: createdOwner };
    });
  } catch (err: any) {
    if (err?.code === "P2002") {
      return res.status(409).json({ success: false, data: null, error: { code: "SLUG_TAKEN", message: "Este identificador já está em uso." } });
    }
    throw err;
  }
  const { tenant, owner } = created;

  const token = signSessionToken({ userId: owner.id, tenantId: tenant.id, role: "OWNER" });
  const authPayload = {
    token,
    tenant: {
      id: tenant.id,
      slug: tenant.slug,
      tradeName: tenant.tradeName,
      status: tenant.status,
      tenantType: tenant.tenantType,
      cnpj: tenant.cnpj,
    },
    user: { id: owner.id, name: owner.name, email: owner.email, role: owner.role },
  };
  // Envelope {success,data,error} + campos planos na raiz: o frontend (AuthResponse em apps/web) ainda lê token/tenant/user planos.
  return res.status(201).json({ success: true, data: authPayload, error: null, ...authPayload });
});

const loginSchema = z.object({
  tenantSlug: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const { tenantSlug, email, password } = parsed.data;

  // Rate limiting por tentativas falhas (Capítulo 14.3, mesmo padrão "Redis INCR com
  // TTL" já usado em manager-pin.service.ts): 5 tentativas a cada 15 minutos por
  // tenant+e-mail, namespace isolado por tenant — um invasor tentando força bruta
  // contra a conta de um lojista nunca consome/afeta o limite de outro tenant.
  const rateLimitKey = `tenant:${tenantSlug}:login:fail:${email.toLowerCase()}`;
  try {
    await enforceRateLimit(rateLimitKey, 5, 900);
  } catch (err) {
    if (err instanceof RateLimitExceededError) {
      return res.status(429).json({ success: false, data: null, error: { code: "RATE_LIMITED", message: err.message } });
    }
    throw err;
  }

  const tenant = await prismaUnscoped.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) {
    return res.status(401).json({ success: false, data: null, error: { code: "INVALID_CREDENTIALS", message: "Credenciais inválidas." } });
  }

  const user = await prismaUnscoped.user.findFirst({ where: { tenantId: tenant.id, email, active: true } });
  if (!user) {
    return res.status(401).json({ success: false, data: null, error: { code: "INVALID_CREDENTIALS", message: "Credenciais inválidas." } });
  }

  const passwordOk = await verifyPassword(user.passwordHash, password);
  if (!passwordOk) {
    return res.status(401).json({ success: false, data: null, error: { code: "INVALID_CREDENTIALS", message: "Credenciais inválidas." } });
  }

  // Login válido: reseta o contador de tentativas falhas desta conta.
  await resetRateLimit(rateLimitKey);

  // Capítulo 2 — Tenant Lockout: bloqueia login se a assinatura estiver suspensa.
  if (tenant.status === "SUSPENDED" || tenant.status === "CANCELLED") {
    return res.status(402).json({
      success: false, data: null, error: { code: "TENANT_LOCKED", message: "Este espaço está com a assinatura suspensa. Regularize o pagamento para continuar." },
    });
  }

  const token = signSessionToken({ userId: user.id, tenantId: tenant.id, role: user.role as any });
  const authPayload = {
    token,
    tenant: {
      id: tenant.id,
      slug: tenant.slug,
      tradeName: tenant.tradeName,
      status: tenant.status,
      tenantType: tenant.tenantType,
      cnpj: tenant.cnpj,
    },
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  };
  return res.json({ success: true, data: authPayload, error: null, ...authPayload });
});

// Capítulo 13.1 — qualquer usuário autenticado consegue encerrar sua PRÓPRIA sessão
// de impersonation a qualquer momento (não exige papel OWNER: o objetivo é dar ao
// lojista controle total sobre uma sessão de suporte aberta em seu nome). Idempotente:
// chamar de novo depois de já encerrada apenas confirma, sem erro.
authRouter.post("/impersonation/end", authMiddleware, requireAuth, async (req, res) => {
  const sessionId = req.session?.impersonation?.sessionId;
  if (!sessionId) {
    return res.status(409).json({ success: false, data: null, error: { code: "NOT_IMPERSONATING", message: "Esta sessão não é uma sessão de impersonation." } });
  }
  await prismaUnscoped.impersonationSession.updateMany({
    where: { id: sessionId, endedAt: null },
    data: { endedAt: new Date() },
  });
  return res.json({ success: true, data: { ended: true }, error: null });
});

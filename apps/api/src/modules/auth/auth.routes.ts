// apps/api/src/modules/auth/auth.routes.ts
// Rotas reais de autenticação: signup de tenant (onboarding, Capítulo 1.2) e login
// (JWT RS256, Capítulo 3.5). Usa prismaUnscoped porque ainda não há tenantId de sessão
// nessas duas rotas (são as únicas formas legítimas de criar/entrar em um tenant).
import { Router } from "express";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { prismaUnscoped } from "@filitech/db";
import { hashPassword, verifyPassword } from "./password.service";
import { signSessionToken } from "./jwt.service";
import { enforceRateLimit, resetRateLimit, RateLimitExceededError } from "../../lib/rate-limit";
import { authMiddleware, requireAuth } from "../../middlewares/auth.middleware";
import { isValidCnpj } from "../../lib/br-documents";
import { validatePasswordPolicy } from "../../lib/password-policy";
import { sendPlatformEmail } from "../../lib/platform-email";
import { getPlatformSecret } from "../../lib/platform-secrets";
import { createModuleLogger } from "../../lib/logger";

export const authRouter = Router();

const logger = createModuleLogger("tenant-auth");

// GAP DE AUDITORIA FECHADO (Rodada 6) — só existia reset de senha para
// PlatformAdminUser (platform-admin-auth.routes.ts, Capítulo 14.3). Um usuário
// comum de tenant (OWNER/MANAGER/TECHNICIAN/CASHIER) que esquecesse a senha não
// tinha NENHUMA forma de recuperar a conta além de um OWNER recadastrá-lo na mão.
// Mesmo padrão de segurança já usado para admins (token opaco de uso único, hash
// SHA-256 persistido, janela curta de validade, resposta sempre genérica para
// nunca permitir enumeração de e-mail) — reaproveita o MESMO model
// `PasswordResetToken`, que já nasceu com `userId` nulável exatamente para esta
// extensão (ver comentário no schema.prisma).
const PASSWORD_RESET_TOKEN_TTL_MINUTES = 30;

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
  // GAP DE AUDITORIA FECHADO (mega-audit rodada 5): aceite dos Termos de Uso e da
  // Política de Privacidade agora é obrigatório e validado no backend (nunca apenas
  // "confiado" ao frontend) — requisito legal (LGPD) para prova de consentimento.
  termsAccepted: z.literal(true, { errorMap: () => ({ message: "É necessário aceitar os Termos de Uso e a Política de Privacidade para criar uma conta." }) }),
});

authRouter.post("/signup", async (req, res) => {
  // GAP DE AUDITORIA FECHADO: signup criava tenant+usuário sem nenhum rate
  // limiting, diferente de /login e /password-reset/request no mesmo arquivo —
  // permitia criação automatizada ilimitada de tenants/contas a partir do mesmo IP.
  try {
    await enforceRateLimit(`signup:${req.ip}`, 5, 900);
  } catch (err) {
    if (err instanceof RateLimitExceededError) {
      return res.status(429).json({ success: false, data: null, error: { code: "RATE_LIMITED", message: err.message } });
    }
    throw err;
  }
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const input = parsed.data;

  // CNPJ obrigatório apenas para tenantType = BUSINESS (Capítulo 22.1).
  if (input.tenantType === "BUSINESS" && !input.cnpj) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: "cnpj é obrigatório para tenantType BUSINESS." } });
  }
  // Validação real de dígito verificador — aceita tanto CNPJ numérico tradicional
  // quanto o novo formato alfanumérico da Receita Federal (ver lib/br-documents.ts).
  // Checado sempre que um CNPJ é informado, independente do tenantType.
  if (input.cnpj && !isValidCnpj(input.cnpj)) {
    return res.status(400).json({ success: false, data: null, error: { code: "INVALID_CNPJ", message: "CNPJ inválido (dígito verificador não confere)." } });
  }
  const passwordPolicy = validatePasswordPolicy(input.ownerPassword);
  if (!passwordPolicy.valid) {
    return res.status(400).json({ success: false, data: null, error: { code: "WEAK_PASSWORD", message: passwordPolicy.errors.join(" ") } });
  }

  const existingSlug = await prismaUnscoped.tenant.findUnique({ where: { slug: input.slug } });
  if (existingSlug) {
    return res.status(409).json({ success: false, data: null, error: { code: "SLUG_TAKEN", message: "Este identificador já está em uso." } });
  }

  const passwordHash = await hashPassword(input.ownerPassword);

  // GAP DE AUDITORIA FECHADO (mega-audit rodada 5): `Tenant.termsVersionAccepted`/
  // `privacyPolicyVersionAccepted` já existiam no schema, mas nenhuma rota de
  // signup realmente consultava `LegalDocumentVersion` nem gravava o aceite —
  // nunca gravamos uma versão "fixa"/hardcoded aqui: buscamos a versão REALMENTE
  // publicada mais recente de cada tipo de documento no momento do cadastro, para
  // que o registro de consentimento seja auditável mesmo após o texto mudar.
  const [latestTerms, latestPrivacy] = await Promise.all([
    prismaUnscoped.legalDocumentVersion.findFirst({ where: { documentType: "TERMS_OF_USE" }, orderBy: { publishedAt: "desc" } }),
    prismaUnscoped.legalDocumentVersion.findFirst({ where: { documentType: "PRIVACY_POLICY" }, orderBy: { publishedAt: "desc" } }),
  ]);

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
        termsAcceptedAt: new Date(),
        termsVersionAccepted: latestTerms?.version ?? null,
        privacyPolicyAcceptedAt: new Date(),
        privacyPolicyVersionAccepted: latestPrivacy?.version ?? null,
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

// ─────────────────────────────────────────────────────────────────────────
// RESET DE SENHA (usuário comum de tenant — OWNER/MANAGER/TECHNICIAN/CASHIER)
// ─────────────────────────────────────────────────────────────────────────

async function resolveAppBaseUrl(): Promise<string> {
  return (await getPlatformSecret("APP_BASE_URL")) ?? "https://app.filitecherp.com.br";
}

const passwordResetRequestSchema = z.object({ tenantSlug: z.string().min(1), email: z.string().email() });

authRouter.post("/auth/password-reset/request", async (req, res) => {
  const parsed = passwordResetRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const { tenantSlug, email } = parsed.data;

  // Rate limiting por tentativas (mesmo padrão de login) — nunca permite que este
  // endpoint seja usado para martelar o envio de e-mails de reset contra uma conta.
  const rateLimitKey = `tenant:${tenantSlug}:password-reset:request:${email.toLowerCase()}`;
  try {
    await enforceRateLimit(rateLimitKey, 3, 900);
  } catch (err) {
    if (err instanceof RateLimitExceededError) {
      return res.status(429).json({ success: false, data: null, error: { code: "RATE_LIMITED", message: err.message } });
    }
    throw err;
  }

  // Resposta sempre genérica e 200, exista ou não a conta/tenant — nunca revela por
  // enumeração de e-mail/slug se um endereço corresponde a um usuário real (mesma
  // garantia já aplicada ao reset de admin de plataforma, Capítulo 14.3).
  const tenant = await prismaUnscoped.tenant.findUnique({ where: { slug: tenantSlug } });
  const user = tenant ? await prismaUnscoped.user.findFirst({ where: { tenantId: tenant.id, email, active: true } }) : null;
  if (tenant && user) {
    const rawToken = randomUUID();
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const resetToken = await prismaUnscoped.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MINUTES * 60_000),
        requestedFromIp: req.ip ?? "0.0.0.0",
      },
    });

    const appBaseUrl = await resolveAppBaseUrl();
    const resetLink = `${appBaseUrl}/redefinir-senha?token=${rawToken}`;
    const emailResult = await sendPlatformEmail(
      user.email,
      "Redefinição de senha — Filitech ERP",
      `<p>Olá, ${user.name}.</p><p>Foi solicitada a redefinição da sua senha de acesso ao Filitech ERP (${tenant.tradeName}). Clique no link abaixo para continuar (válido por ${PASSWORD_RESET_TOKEN_TTL_MINUTES} minutos):</p><p><a href="${resetLink}">${resetLink}</a></p><p>Se você não solicitou esta redefinição, ignore este e-mail — sua senha continua a mesma.</p>`,
    );
    if (!emailResult.success) {
      // Nunca logar o token/link em claro — apenas o identificador do usuário e o
      // motivo da falha de entrega (mesma regra já corrigida para o reset de admin
      // de plataforma na Rodada 5), permitindo reenvio manual assistido até lá.
      logger.warn({
        userId: user.id,
        tenantId: tenant.id,
        resetTokenId: resetToken.id,
        reason: emailResult.message,
      }, "Falha ao enviar e-mail de reset de senha de usuário de tenant (token gerado, mas o link não pôde ser entregue)");
    }
  }

  return res.json({ success: true, data: { message: "Se o e-mail existir em nossa base, um link de redefinição foi enviado." }, error: null });
});

const passwordResetConfirmSchema = z.object({ token: z.string().min(1), newPassword: z.string().min(8) });

authRouter.post("/auth/password-reset/confirm", async (req, res) => {
  const parsed = passwordResetConfirmSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const passwordPolicy = validatePasswordPolicy(parsed.data.newPassword);
  if (!passwordPolicy.valid) {
    return res.status(400).json({ success: false, data: null, error: { code: "WEAK_PASSWORD", message: passwordPolicy.errors.join(" ") } });
  }

  const tokenHash = createHash("sha256").update(parsed.data.token).digest("hex");
  const resetToken = await prismaUnscoped.passwordResetToken.findUnique({ where: { tokenHash } });
  if (!resetToken || !resetToken.userId || resetToken.usedAt || resetToken.expiresAt < new Date()) {
    return res.status(401).json({ success: false, data: null, error: { code: "INVALID_TOKEN", message: "Token de redefinição inválido, já utilizado ou expirado." } });
  }

  const newPasswordHash = await hashPassword(parsed.data.newPassword);
  // Mesma proteção de concorrência do reset de admin de plataforma: consumação do
  // token via `updateMany` condicional (`usedAt: null`) dentro de transação — nunca
  // aplica a troca de senha "otimisticamente" antes de garantir posse exclusiva do
  // token (evita dupla redefinição por duas requisições concorrentes com o mesmo link).
  const tokenConsumed = await prismaUnscoped.$transaction(async (tx) => {
    const consumption = await tx.passwordResetToken.updateMany({
      where: { id: resetToken.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (consumption.count === 0) return false;

    await tx.user.update({ where: { id: resetToken.userId! }, data: { passwordHash: newPasswordHash } });
    return true;
  });
  if (!tokenConsumed) {
    return res.status(401).json({ success: false, data: null, error: { code: "INVALID_TOKEN", message: "Token de redefinição inválido, já utilizado ou expirado." } });
  }

  return res.json({ success: true, data: { message: "Senha redefinida com sucesso. Faça login novamente." }, error: null });
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

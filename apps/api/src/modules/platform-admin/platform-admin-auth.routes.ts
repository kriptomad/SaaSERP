// apps/api/src/modules/platform-admin/platform-admin-auth.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 14.2 — 2FA (TOTP) obrigatório e não-opcional
// para todo PlatformAdminUser desde o primeiro acesso. Implementação real (otplib),
// não um stub: o segredo TOTP é cifrado com o mesmo envelope AES-256-GCM já usado para
// IntegrationCredential (envelope-crypto.ts), nunca em texto puro no banco. Códigos de
// backup usam argon2id (mesma biblioteca já padronizada no projeto para senhas, Capítulo
// 3.5) em vez do bcrypt citado literalmente no rascunho da Bible — mesma garantia de
// segurança, sem introduzir uma segunda biblioteca de hashing equivalente no projeto.
import { Router, Request, Response } from "express";
import { randomInt, randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { authenticator } from "otplib";
import { prismaUnscoped as prisma } from "@filitech/db";
import { verifyPassword, hashPassword } from "../auth/password.service";
import { encryptEnvelope, decryptEnvelope } from "../../lib/envelope-crypto";
import { enforceRateLimit, resetRateLimit, RateLimitExceededError } from "../../lib/rate-limit";
import { ipMatchesAnyCidr } from "../../lib/cidr-match";
import { hashSessionId } from "./platform-admin-auth.middleware";
import { createModuleLogger } from "../../lib/logger";
import { validatePasswordPolicy } from "../../lib/password-policy";
import {
  signPlatformAdminSessionToken,
  signTwoFactorEnrollToken,
  verifyTwoFactorEnrollToken,
  signTwoFactorVerifyToken,
  verifyTwoFactorVerifyToken,
} from "./platform-admin-jwt.service";

const logger = createModuleLogger("platform-admin-auth");

export const platformAdminAuthRouter = Router();

// Capítulo 14.4 — janela de validade do token de reset de senha (nunca mais longa
// que isto: um link de reset de conta de dono da plataforma é o alvo de phishing
// mais crítico de toda a aplicação).
const PASSWORD_RESET_TOKEN_TTL_MINUTES = 15;

/**
 * Registro imutável de evento AUTH_* (Capítulo 14.2/14.3/14.4/14.5) — nunca
 * atualizado/apagado depois, mesmo padrão do restante do `AuditLog` (comentário
 * `@@map("audit_logs")` no schema). `targetType` é sempre "PlatformAdminUser" para
 * estes eventos específicos de autenticação.
 */
async function logAuthEvent(platformAdminUserId: string, action: string, metadata: Record<string, unknown>): Promise<void> {
  await prisma.auditLog.create({
    data: { platformAdminUserId, action, targetType: "PlatformAdminUser", targetId: platformAdminUserId, metadata: metadata as any },
  });
}

function clientIp(req: Request): string {
  return req.ip ?? "0.0.0.0";
}

function generateBackupCode(): string {
  // 10 caracteres alfanuméricos maiúsculos, sem caracteres ambíguos (0/O, 1/I).
  const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 10; i++) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return code;
}

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

platformAdminAuthRouter.post("/platform-admin/auth/login", async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const { email, password } = parsed.data;

  // Capítulo 14.4 — rate limit por e-mail tentado, nunca por IP isoladamente (um
  // invasor rotacionando IPs via proxy não ganha tentativas ilimitadas contra a
  // mesma conta-alvo). Janela mais restritiva que o login de tenant (5/15min) dado
  // o nível de privilégio da conta protegida.
  const rateLimitKey = `platform-admin:login:fail:${email.toLowerCase()}`;
  try {
    await enforceRateLimit(rateLimitKey, 5, 900);
  } catch (err) {
    if (err instanceof RateLimitExceededError) {
      return res.status(429).json({ success: false, data: null, error: { code: "RATE_LIMITED", message: "Muitas tentativas de login. Tente novamente em alguns minutos." } });
    }
    throw err;
  }

  const admin = await prisma.platformAdminUser.findUnique({ where: { email } });
  if (!admin || !admin.active) {
    return res.status(401).json({ success: false, data: null, error: { code: "INVALID_CREDENTIALS", message: "Credenciais inválidas." } });
  }

  const passwordOk = await verifyPassword(admin.passwordHash, password);
  if (!passwordOk) {
    await logAuthEvent(admin.id, "AUTH_LOGIN_FAILED", { reason: "INVALID_PASSWORD", ip: clientIp(req) });
    return res.status(401).json({ success: false, data: null, error: { code: "INVALID_CREDENTIALS", message: "Credenciais inválidas." } });
  }

  await resetRateLimit(rateLimitKey);

  if (!admin.totpConfirmedAt) {
    // 2FA ainda não configurado — não é um sucesso de login pleno, apenas uma janela
    // curta e restrita para completar o enrollment obrigatório (Capítulo 14.2).
    const enrollToken = signTwoFactorEnrollToken({ platformAdminUserId: admin.id });
    return res.json({
      success: true,
      data: { stage: "2FA_ENROLLMENT_REQUIRED", enrollToken },
      error: null,
    });
  }

  const verifyToken = signTwoFactorVerifyToken({ platformAdminUserId: admin.id });
  return res.json({ success: true, data: { stage: "2FA_VERIFICATION_REQUIRED", verifyToken }, error: null });
});

platformAdminAuthRouter.post("/platform-admin/auth/2fa/enroll", async (req: Request, res: Response) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, data: null, error: { code: "UNAUTHENTICATED", message: "Token de enrollment ausente." } });
  }
  let claims: { platformAdminUserId: string };
  try {
    claims = verifyTwoFactorEnrollToken(header.slice("Bearer ".length));
  } catch {
    return res.status(401).json({ success: false, data: null, error: { code: "INVALID_TOKEN", message: "Token de enrollment inválido ou expirado." } });
  }

  const admin = await prisma.platformAdminUser.findUniqueOrThrow({ where: { id: claims.platformAdminUserId } });
  if (admin.totpConfirmedAt) {
    return res.status(409).json({ success: false, data: null, error: { code: "2FA_ALREADY_ENABLED", message: "2FA já está ativo para esta conta." } });
  }

  const secret = authenticator.generateSecret();
  const otpAuthUrl = authenticator.keyuri(admin.email, "Filitech ERP Admin", secret);

  const { payload, encryptionKeyId } = encryptEnvelope({ secret });
  await prisma.platformAdminUser.update({
    where: { id: admin.id },
    data: { totpSecretEncrypted: `${encryptionKeyId}:${payload.toString("base64")}`, totpConfirmedAt: null },
  });

  return res.json({ success: true, data: { otpAuthUrl }, error: null });
});

const confirmSchema = z.object({ totpCode: z.string().length(6) });

platformAdminAuthRouter.post("/platform-admin/auth/2fa/confirm", async (req: Request, res: Response) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, data: null, error: { code: "UNAUTHENTICATED", message: "Token de enrollment ausente." } });
  }
  let claims: { platformAdminUserId: string };
  try {
    claims = verifyTwoFactorEnrollToken(header.slice("Bearer ".length));
  } catch {
    return res.status(401).json({ success: false, data: null, error: { code: "INVALID_TOKEN", message: "Token de enrollment inválido ou expirado." } });
  }

  const parsed = confirmSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const admin = await prisma.platformAdminUser.findUniqueOrThrow({ where: { id: claims.platformAdminUserId } });
  if (!admin.totpSecretEncrypted) {
    return res.status(409).json({ success: false, data: null, error: { code: "2FA_NOT_ENROLLED", message: "Inicie o enrollment (/2fa/enroll) antes de confirmar." } });
  }

  const [encryptionKeyId, payloadBase64] = admin.totpSecretEncrypted.split(":");
  const { secret } = decryptEnvelope(Buffer.from(payloadBase64, "base64"), encryptionKeyId) as { secret: string };

  if (!authenticator.verify({ token: parsed.data.totpCode, secret })) {
    return res.status(401).json({ success: false, data: null, error: { code: "INVALID_2FA_CODE", message: "Código inválido. Tente novamente." } });
  }

  const rawBackupCodes = Array.from({ length: 10 }, generateBackupCode);
  const hashedBackupCodes = await Promise.all(rawBackupCodes.map((code) => hashPassword(code)));

  await prisma.$transaction([
    prisma.platformAdminUser.update({ where: { id: admin.id }, data: { totpConfirmedAt: new Date() } }),
    prisma.twoFactorBackupCode.deleteMany({ where: { platformAdminUserId: admin.id } }),
    prisma.twoFactorBackupCode.createMany({
      data: hashedBackupCodes.map((codeHash) => ({ platformAdminUserId: admin.id, codeHash })),
    }),
  ]);

  return res.json({ success: true, data: { backupCodes: rawBackupCodes }, error: null });
});

const verifySchema = z.object({ totpCode: z.string().optional(), backupCode: z.string().optional() });

platformAdminAuthRouter.post("/platform-admin/auth/2fa/verify", async (req: Request, res: Response) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, data: null, error: { code: "UNAUTHENTICATED", message: "Token de verificação ausente." } });
  }
  let claims: { platformAdminUserId: string };
  try {
    claims = verifyTwoFactorVerifyToken(header.slice("Bearer ".length));
  } catch {
    return res.status(401).json({ success: false, data: null, error: { code: "INVALID_TOKEN", message: "Token de verificação inválido ou expirado." } });
  }

  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success || (!parsed.data.totpCode && !parsed.data.backupCode)) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: "Informe totpCode ou backupCode." } });
  }

  const admin = await prisma.platformAdminUser.findUniqueOrThrow({ where: { id: claims.platformAdminUserId } });

  // Capítulo 14.4 — rate limit por conta (não por IP): o código TOTP tem só 10^6
  // combinações; sem isso, um atacante que já roubou a senha poderia forçar bruta o
  // segundo fator em poucos minutos.
  const rateLimitKey = `platform-admin:2fa:fail:${admin.id}`;
  try {
    await enforceRateLimit(rateLimitKey, 5, 900);
  } catch (err) {
    if (err instanceof RateLimitExceededError) {
      return res.status(429).json({ success: false, data: null, error: { code: "RATE_LIMITED", message: "Muitas tentativas de verificação. Tente novamente em alguns minutos." } });
    }
    throw err;
  }

  // Capítulo 14.5 — allowlist de IP é opt-in por admin: zero entradas cadastradas =
  // sem restrição (comportamento atual preservado para quem nunca configurou);
  // qualquer entrada cadastrada liga o enforcement e passa a exigir match.
  const allowlistEntries = await prisma.adminIpAllowlistEntry.findMany({ where: { platformAdminUserId: admin.id }, select: { cidrRange: true } });
  if (allowlistEntries.length > 0 && !ipMatchesAnyCidr(clientIp(req), allowlistEntries.map((e) => e.cidrRange))) {
    await logAuthEvent(admin.id, "AUTH_IP_BLOCKED", { ip: clientIp(req) });
    logger.warn({ adminId: admin.id, ip: clientIp(req) }, "Login de administrador de plataforma bloqueado por IP fora da allowlist");
    return res.status(403).json({ success: false, data: null, error: { code: "IP_NOT_ALLOWED", message: "Este IP não está autorizado a acessar esta conta. Contate outro SUPER_ADMIN para liberar seu IP atual." } });
  }

  if (parsed.data.totpCode) {
    if (!admin.totpSecretEncrypted) {
      return res.status(409).json({ success: false, data: null, error: { code: "2FA_NOT_ENROLLED", message: "2FA não configurado para esta conta." } });
    }
    const [encryptionKeyId, payloadBase64] = admin.totpSecretEncrypted.split(":");
    const { secret } = decryptEnvelope(Buffer.from(payloadBase64, "base64"), encryptionKeyId) as { secret: string };
    if (!authenticator.verify({ token: parsed.data.totpCode, secret })) {
      await logAuthEvent(admin.id, "AUTH_2FA_FAILED", { method: "TOTP", ip: clientIp(req) });
      return res.status(401).json({ success: false, data: null, error: { code: "INVALID_2FA_CODE", message: "Código inválido." } });
    }
  } else {
    // Caminho de backup code: uso único, consumido ANTES de prosseguir (Capítulo 14.2) —
    // se o processo falhar após este ponto, o código já está marcado como usado, nunca
    // reaproveitável, mesmo sem o login ter sido concluído com sucesso.
    const candidateCodes = await prisma.twoFactorBackupCode.findMany({
      where: { platformAdminUserId: admin.id, usedAt: null },
    });
    let matchedId: string | null = null;
    for (const candidate of candidateCodes) {
      if (await verifyPassword(candidate.codeHash, parsed.data.backupCode!)) {
        matchedId = candidate.id;
        break;
      }
    }
    if (!matchedId) {
      await logAuthEvent(admin.id, "AUTH_2FA_FAILED", { method: "BACKUP_CODE", ip: clientIp(req) });
      return res.status(401).json({ success: false, data: null, error: { code: "INVALID_BACKUP_CODE", message: "Código de backup inválido ou já utilizado." } });
    }
    await prisma.twoFactorBackupCode.update({ where: { id: matchedId }, data: { usedAt: new Date() } });
    // Nota de incremento futuro: o alerta por e-mail ao titular (AUTH_2FA_BACKUP_CODE_USED,
    // Capítulo 14.2) depende do provedor de e-mail transacional (Resend, Capítulo 20),
    // ainda não conectado nesta fase — o uso do backup code já fica registrado de forma
    // auditável via `usedAt` e também via `logAuthEvent` abaixo, mesmo sem o envio do
    // alerta por e-mail ainda implementado.
  }

  await resetRateLimit(rateLimitKey);
  await prisma.platformAdminUser.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });

  // Capítulo 14.4 — sessão ativa rastreada e revogável: o `sid` embutido no JWT é a
  // única forma de revogar uma sessão específica antes do seu `exp` natural (4h).
  const sid = randomUUID();
  await prisma.activeSession.create({
    data: {
      platformAdminUserId: admin.id,
      refreshTokenHash: hashSessionId(sid),
      ipAddress: clientIp(req),
      userAgent: req.headers["user-agent"] ?? "desconhecido",
    },
  });
  await logAuthEvent(admin.id, "AUTH_LOGIN_SUCCESS", { ip: clientIp(req), method: parsed.data.totpCode ? "TOTP" : "BACKUP_CODE" });

  const sessionToken = signPlatformAdminSessionToken({ platformAdminUserId: admin.id, role: admin.role, sid });
  return res.json({
    success: true,
    data: { token: sessionToken, admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role } },
    error: null,
  });
});

// ─────────────────────────────────────────────────────────────────────────
// SESSÕES ATIVAS — listar e revogar (Capítulo 14.4)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Middleware mínimo local (não reaproveita `requirePlatformAdminAuth` do módulo de
 * middleware para evitar import circular — `platform-admin-auth.middleware.ts` já
 * importa deste arquivo seria incorreto; o padrão de import é o inverso: este
 * arquivo importa `hashSessionId` de lá, nunca o contrário).
 */
function requireSession(req: Request, res: Response): { platformAdminUserId: string; sid: string } | null {
  if (!req.platformAdminSession) {
    res.status(401).json({ success: false, data: null, error: { code: "UNAUTHENTICATED", message: "Sessão ausente ou inválida." } });
    return null;
  }
  return req.platformAdminSession;
}

platformAdminAuthRouter.get("/platform-admin/auth/sessions", async (req: Request, res: Response) => {
  const session = requireSession(req, res);
  if (!session) return;

  const currentHash = hashSessionId(session.sid);
  const sessions = await prisma.activeSession.findMany({
    where: { platformAdminUserId: session.platformAdminUserId, revokedAt: null },
    orderBy: { lastSeenAt: "desc" },
  });

  return res.json({
    success: true,
    data: sessions.map((s) => ({
      id: s.id,
      ipAddress: s.ipAddress,
      userAgent: s.userAgent,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      isCurrent: s.refreshTokenHash === currentHash,
    })),
    error: null,
  });
});

platformAdminAuthRouter.post("/platform-admin/auth/sessions/:id/revoke", async (req: Request, res: Response) => {
  const session = requireSession(req, res);
  if (!session) return;

  // Nunca revoga sessão de outro admin, mesmo um SUPER_ADMIN — "Encerrar sessão" é
  // uma ação sobre a PRÓPRIA conta (ex.: notebook perdido), não um controle de
  // acesso administrativo sobre terceiros (isso seria o fluxo de desativar a conta
  // inteira em platform-admin.routes.ts, um escopo diferente).
  const target = await prisma.activeSession.findFirst({ where: { id: req.params.id, platformAdminUserId: session.platformAdminUserId } });
  if (!target) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Sessão não encontrada." } });
  }
  await prisma.activeSession.update({ where: { id: target.id }, data: { revokedAt: new Date() } });
  await logAuthEvent(session.platformAdminUserId, "AUTH_SESSION_REVOKED", { sessionId: target.id, wasCurrent: target.refreshTokenHash === hashSessionId(session.sid) });

  return res.json({ success: true, data: { revoked: true }, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// RESET DE SENHA (Capítulo 14.3)
// ─────────────────────────────────────────────────────────────────────────

const passwordResetRequestSchema = z.object({ email: z.string().email() });

platformAdminAuthRouter.post("/platform-admin/auth/password-reset/request", async (req: Request, res: Response) => {
  const parsed = passwordResetRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  // Resposta sempre genérica e 200, exista ou não a conta — nunca revela por
  // enumeração de e-mail se um endereço corresponde a um admin da plataforma.
  const admin = await prisma.platformAdminUser.findUnique({ where: { email: parsed.data.email } });
  if (admin && admin.active) {
    const rawToken = randomUUID();
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    await prisma.passwordResetToken.create({
      data: {
        platformAdminUserId: admin.id,
        tokenHash,
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MINUTES * 60_000),
        requestedFromIp: clientIp(req),
      },
    });
    await logAuthEvent(admin.id, "AUTH_PASSWORD_RESET_REQUESTED", { ip: clientIp(req) });
    // PENDENTE (flagado explicitamente, não escondido): envio do link por e-mail
    // transacional depende de uma credencial de Resend em nível de PLATAFORMA (não
    // existe ainda um grupo "Email" em PLATFORM_SECRET_REGISTRY, platform-secrets.ts
    // — apenas credenciais por tenant via IntegrationCredential existem hoje para
    // EMAIL_RESEND). Até essa integração ser conectada, o link é registrado no log
    // estruturado do servidor (acesso restrito à infraestrutura, nunca exposto na
    // resposta HTTP) para permitir reset manual assistido por um operador.
    logger.warn({
      adminId: admin.id,
      resetLink: `https://admin.filitecherp.com.br/reset-senha?token=${rawToken}`,
    }, "Link de reset de senha gerado (envio por e-mail pendente de credencial de plataforma)");
  }

  return res.json({ success: true, data: { message: "Se o e-mail existir em nossa base, um link de redefinição foi gerado." }, error: null });
});

const passwordResetConfirmSchema = z.object({ token: z.string().min(1), newPassword: z.string().min(8) });

platformAdminAuthRouter.post("/platform-admin/auth/password-reset/confirm", async (req: Request, res: Response) => {
  const parsed = passwordResetConfirmSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const passwordPolicy = validatePasswordPolicy(parsed.data.newPassword);
  if (!passwordPolicy.valid) {
    return res.status(400).json({ success: false, data: null, error: { code: "WEAK_PASSWORD", message: passwordPolicy.errors.join(" ") } });
  }

  const tokenHash = createHash("sha256").update(parsed.data.token).digest("hex");
  const resetToken = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
  if (!resetToken || !resetToken.platformAdminUserId || resetToken.usedAt || resetToken.expiresAt < new Date()) {
    return res.status(401).json({ success: false, data: null, error: { code: "INVALID_TOKEN", message: "Token de redefinição inválido, já utilizado ou expirado." } });
  }

  const newPasswordHash = await hashPassword(parsed.data.newPassword);
  await prisma.$transaction([
    prisma.platformAdminUser.update({ where: { id: resetToken.platformAdminUserId }, data: { passwordHash: newPasswordHash } }),
    prisma.passwordResetToken.update({ where: { id: resetToken.id }, data: { usedAt: new Date() } }),
    // Troca de senha revoga TODAS as sessões ativas — mesmo princípio de segurança
    // de "a troca de senha presume que a credencial anterior pode estar
    // comprometida", nunca deixando uma sessão antiga sobreviver à redefinição.
    prisma.activeSession.updateMany({
      where: { platformAdminUserId: resetToken.platformAdminUserId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
  await logAuthEvent(resetToken.platformAdminUserId, "AUTH_PASSWORD_RESET_COMPLETED", { ip: clientIp(req) });

  return res.json({ success: true, data: { message: "Senha redefinida com sucesso. Faça login novamente." }, error: null });
});

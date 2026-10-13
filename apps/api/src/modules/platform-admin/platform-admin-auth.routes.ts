// apps/api/src/modules/platform-admin/platform-admin-auth.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 14.2 — 2FA (TOTP) obrigatório e não-opcional
// para todo PlatformAdminUser desde o primeiro acesso. Implementação real (otplib),
// não um stub: o segredo TOTP é cifrado com o mesmo envelope AES-256-GCM já usado para
// IntegrationCredential (envelope-crypto.ts), nunca em texto puro no banco. Códigos de
// backup usam argon2id (mesma biblioteca já padronizada no projeto para senhas, Capítulo
// 3.5) em vez do bcrypt citado literalmente no rascunho da Bible — mesma garantia de
// segurança, sem introduzir uma segunda biblioteca de hashing equivalente no projeto.
import { Router, Request, Response } from "express";
import { randomInt } from "node:crypto";
import { z } from "zod";
import { authenticator } from "otplib";
import { prismaUnscoped as prisma } from "@filitech/db";
import { verifyPassword, hashPassword } from "../auth/password.service";
import { encryptEnvelope, decryptEnvelope } from "../../lib/envelope-crypto";
import {
  signPlatformAdminSessionToken,
  signTwoFactorEnrollToken,
  verifyTwoFactorEnrollToken,
  signTwoFactorVerifyToken,
  verifyTwoFactorVerifyToken,
} from "./platform-admin-jwt.service";

export const platformAdminAuthRouter = Router();

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

  const admin = await prisma.platformAdminUser.findUnique({ where: { email } });
  if (!admin || !admin.active) {
    return res.status(401).json({ success: false, data: null, error: { code: "INVALID_CREDENTIALS", message: "Credenciais inválidas." } });
  }

  const passwordOk = await verifyPassword(admin.passwordHash, password);
  if (!passwordOk) {
    return res.status(401).json({ success: false, data: null, error: { code: "INVALID_CREDENTIALS", message: "Credenciais inválidas." } });
  }

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

  if (parsed.data.totpCode) {
    if (!admin.totpSecretEncrypted) {
      return res.status(409).json({ success: false, data: null, error: { code: "2FA_NOT_ENROLLED", message: "2FA não configurado para esta conta." } });
    }
    const [encryptionKeyId, payloadBase64] = admin.totpSecretEncrypted.split(":");
    const { secret } = decryptEnvelope(Buffer.from(payloadBase64, "base64"), encryptionKeyId) as { secret: string };
    if (!authenticator.verify({ token: parsed.data.totpCode, secret })) {
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
      return res.status(401).json({ success: false, data: null, error: { code: "INVALID_BACKUP_CODE", message: "Código de backup inválido ou já utilizado." } });
    }
    await prisma.twoFactorBackupCode.update({ where: { id: matchedId }, data: { usedAt: new Date() } });
    // Nota de incremento futuro: o alerta por e-mail ao titular (AUTH_2FA_BACKUP_CODE_USED,
    // Capítulo 14.2) depende do provedor de e-mail transacional (Resend, Capítulo 20),
    // ainda não conectado nesta fase — o uso do backup code já fica registrado de forma
    // auditável via `usedAt`, mesmo sem o envio do alerta ainda implementado.
  }

  await prisma.platformAdminUser.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });

  const sessionToken = signPlatformAdminSessionToken({ platformAdminUserId: admin.id, role: admin.role });
  return res.json({
    success: true,
    data: { token: sessionToken, admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role } },
    error: null,
  });
});

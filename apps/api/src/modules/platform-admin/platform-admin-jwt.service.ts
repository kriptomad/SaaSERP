// apps/api/src/modules/platform-admin/platform-admin-jwt.service.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 13/14 — painel administrativo do dono da
// plataforma (SUPER_ADMIN/SUPPORT_AGENT/FINANCE_ANALYST), completamente separado do
// JWT de sessão de tenant (jwt.service.ts). Reutiliza o mesmo par de chaves RS256 já
// provisionado (Capítulo 3.5), mas com `issuer`/`audience` distintos — um token de
// tenant nunca pode ser reaproveitado como sessão de admin de plataforma, e vice-versa,
// mesmo que ambos usem a mesma chave pública/privada no servidor.
//
// Três audiences distintas modelam as três etapas do login com 2FA obrigatório
// (Capítulo 14.2), cada uma só válida para seu próprio conjunto de rotas — um token
// de uma etapa nunca é aceito em outra, mesmo com a mesma chave de assinatura:
//   - "platform-admin-2fa-enroll": emitido após senha correta quando totpConfirmedAt
//     ainda é nulo — só aceito pelas rotas /auth/2fa/enroll e /auth/2fa/confirm.
//   - "platform-admin-2fa-verify": emitido após senha correta quando o 2FA já está
//     confirmado — só aceito pela rota /auth/2fa/verify.
//   - "platform-admin": sessão completa, emitida somente após o código TOTP (ou
//     backup code) ser validado com sucesso — esta é a única audience aceita pelo
//     middleware requirePlatformAdminAuth usado nas rotas operacionais reais.
import jwt from "jsonwebtoken";
import { JWT_PRIVATE_KEY as PRIVATE_KEY, JWT_PUBLIC_KEY as PUBLIC_KEY } from "../../lib/jwt-keys";

export interface PlatformAdminSessionClaims {
  platformAdminUserId: string;
  role: "SUPER_ADMIN" | "SUPPORT_AGENT" | "FINANCE_ANALYST";
  sid: string; // Capítulo 14.4 — identificador único da sessão (nunca reaproveitado), usado como chave de revogação (`ActiveSession.refreshTokenHash` = sha256(sid)); sem ele, um JWT stateless seria impossível de revogar antes do seu `exp` natural.
}

export function signPlatformAdminSessionToken(claims: PlatformAdminSessionClaims): string {
  return jwt.sign(claims, PRIVATE_KEY, {
    algorithm: "RS256",
    expiresIn: "4h", // janela mais curta que a sessão de tenant (8h) — superfície de ataque menor para o painel do dono
    issuer: "filitech-erp",
    audience: "platform-admin",
  });
}

export function verifyPlatformAdminSessionToken(token: string): PlatformAdminSessionClaims {
  return jwt.verify(token, PUBLIC_KEY, {
    algorithms: ["RS256"],
    issuer: "filitech-erp",
    audience: "platform-admin",
  }) as PlatformAdminSessionClaims;
}

interface PlatformAdminPendingClaims {
  platformAdminUserId: string;
}

// GAP DE AUDITORIA FECHADO (Capítulo 14.2) — o enrollment de 2FA agora embute um
// nonce de uso único (gerado e persistido a cada /2fa/enroll, invalidando
// qualquer enrollment pendente anterior) para que /2fa/confirm só aceite o token
// da tentativa de enrollment mais recente, nunca um token ainda não expirado de
// um re-roll anterior do segredo.
interface PlatformAdminEnrollClaims extends PlatformAdminPendingClaims {
  // Ausente no token inicial emitido pelo login (mero "ingresso" para chamar
  // /2fa/enroll); presente e obrigatório no token reemitido por /2fa/enroll, que é
  // o único aceito por /2fa/confirm (ver checagem explícita nas rotas).
  nonce?: string;
}

function signPendingToken(claims: PlatformAdminPendingClaims, audience: string): string {
  return jwt.sign(claims, PRIVATE_KEY, {
    algorithm: "RS256",
    expiresIn: "10m", // janela curta: o login tem que concluir o passo de 2FA rapidamente
    issuer: "filitech-erp",
    audience,
  });
}

function verifyPendingToken(token: string, audience: string): PlatformAdminPendingClaims {
  return jwt.verify(token, PUBLIC_KEY, {
    algorithms: ["RS256"],
    issuer: "filitech-erp",
    audience,
  }) as PlatformAdminPendingClaims;
}

export const signTwoFactorEnrollToken = (claims: PlatformAdminEnrollClaims) => signPendingToken(claims, "platform-admin-2fa-enroll");
export const verifyTwoFactorEnrollToken = (token: string) => verifyPendingToken(token, "platform-admin-2fa-enroll") as PlatformAdminEnrollClaims;
export const signTwoFactorVerifyToken = (claims: PlatformAdminPendingClaims) => signPendingToken(claims, "platform-admin-2fa-verify");
export const verifyTwoFactorVerifyToken = (token: string) => verifyPendingToken(token, "platform-admin-2fa-verify");


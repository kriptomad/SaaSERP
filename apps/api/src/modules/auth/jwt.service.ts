// apps/api/src/modules/auth/jwt.service.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 3.5 — Segurança de Autenticação (JWT RS256).
import jwt from "jsonwebtoken";
import { JWT_PRIVATE_KEY as PRIVATE_KEY, JWT_PUBLIC_KEY as PUBLIC_KEY } from "../../lib/jwt-keys";

const SESSION_ROLES = new Set(["OWNER", "MANAGER", "TECHNICIAN", "CASHIER"]);

export interface SessionClaims {
  userId: string;
  tenantId: string;
  role: "OWNER" | "MANAGER" | "TECHNICIAN" | "CASHIER";
  // Capítulo 13.1 — presente apenas quando esta sessão foi criada por
  // impersonation a partir do painel de plataforma (nunca por login normal).
  // `sessionId` referencia `ImpersonationSession.id`, permitindo ao próprio
  // tenant encerrar a sessão de suporte a qualquer momento (POST /impersonation/end).
  impersonation?: { platformAdminUserId: string; sessionId: string };
  // CORREÇÃO DE AUDITORIA (fa-w5-sec-tenant-jwt-no-revocation): espelha
  // `User.tokenVersion` no momento da emissão — `auth.middleware.ts` rejeita o
  // token se este valor não bater mais com o valor atual do usuário no banco
  // (incrementado a cada troca/reset de senha), permitindo revogar de uma vez
  // todos os tokens emitidos antes da troca, sem precisar de uma denylist por jti.
  tokenVersion: number;
}

// CORREÇÃO DE AUDITORIA (fa-w5-sec-jwt-claims-not-required): token de sessão
// malformado/incompleto (claims ausentes ou de tipo errado) nunca deve ser tratado
// como um erro genérico de verificação — usar um tipo de erro próprio deixa claro
// para quem chama (auth.middleware.ts) que a FALHA é estrutural do payload, não de
// assinatura/expiração, ainda que ambos resultem em "sem sessão" na prática.
export class InvalidSessionTokenError extends Error {
  constructor(message = "Token de sessão inválido: claims obrigatórios ausentes ou malformados.") {
    super(message);
    this.name = "InvalidSessionTokenError";
  }
}

export function signSessionToken(claims: SessionClaims, expiresIn: jwt.SignOptions["expiresIn"] = "8h"): string {
  // `algorithm: "RS256"` explícito tanto aqui quanto em `verify` (abaixo, via
  // `algorithms: ["RS256"]`) — nunca aceita `alg: "none"` nem deixa a biblioteca
  // inferir o algoritmo a partir do header do próprio token (o vetor de ataque
  // clássico de "JWT alg confusion").
  return jwt.sign(claims, PRIVATE_KEY, { algorithm: "RS256", expiresIn, issuer: "filitech-erp" });
}

export function verifySessionToken(token: string): SessionClaims {
  const decoded = jwt.verify(token, PUBLIC_KEY, {
    algorithms: ["RS256"], // restrição explícita: nunca aceita alg:none ou outro algoritmo além do RS256 configurado
    issuer: "filitech-erp",
    clockTolerance: 0,
  }) as Record<string, unknown>;

  // CORREÇÃO DE AUDITORIA (fa-w5-sec-jwt-claims-not-required): `jsonwebtoken` só
  // valida `exp` (e nem valida `iat` de forma alguma) quando o claim ESTÁ presente
  // no payload — um token assinado sem `exp` passaria por `jwt.verify()` como
  // "válido para sempre" (sem levantar erro de expiração, pois não há o que
  // comparar). `signSessionToken` sempre embute `exp` (via `expiresIn`) e `iat`
  // (automático, `jsonwebtoken` só omite com `noTimestamp: true`, nunca usado
  // aqui) — exigir ambos explicitamente aqui barra qualquer token emitido fora
  // deste serviço (ou por uma versão futura dele com bug) que omita essas claims.
  if (typeof decoded.exp !== "number" || typeof decoded.iat !== "number") {
    throw new InvalidSessionTokenError("Token de sessão sem claims exp/iat obrigatórias.");
  }

  if (
    typeof decoded.userId !== "string" ||
    decoded.userId.length === 0 ||
    typeof decoded.tenantId !== "string" ||
    decoded.tenantId.length === 0 ||
    typeof decoded.role !== "string" ||
    !SESSION_ROLES.has(decoded.role) ||
    typeof decoded.tokenVersion !== "number" ||
    !Number.isInteger(decoded.tokenVersion) ||
    decoded.tokenVersion < 0
  ) {
    throw new InvalidSessionTokenError();
  }

  if (decoded.impersonation != null) {
    const impersonation = decoded.impersonation as Record<string, unknown>;
    if (
      typeof impersonation !== "object" ||
      typeof impersonation.platformAdminUserId !== "string" ||
      !impersonation.platformAdminUserId ||
      typeof impersonation.sessionId !== "string" ||
      !impersonation.sessionId
    ) {
      throw new InvalidSessionTokenError();
    }
  }

  return decoded as unknown as SessionClaims;
}

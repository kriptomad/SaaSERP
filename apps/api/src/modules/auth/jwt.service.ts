// apps/api/src/modules/auth/jwt.service.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 3.5 — Segurança de Autenticação (JWT RS256).
import jwt from "jsonwebtoken";
import { JWT_PRIVATE_KEY as PRIVATE_KEY, JWT_PUBLIC_KEY as PUBLIC_KEY } from "../../lib/jwt-keys";

export interface SessionClaims {
  userId: string;
  tenantId: string;
  role: "OWNER" | "MANAGER" | "TECHNICIAN" | "CASHIER";
  // Capítulo 13.1 — presente apenas quando esta sessão foi criada por
  // impersonation a partir do painel de plataforma (nunca por login normal).
  // `sessionId` referencia `ImpersonationSession.id`, permitindo ao próprio
  // tenant encerrar a sessão de suporte a qualquer momento (POST /impersonation/end).
  impersonation?: { platformAdminUserId: string; sessionId: string };
}

export function signSessionToken(claims: SessionClaims, expiresIn: jwt.SignOptions["expiresIn"] = "8h"): string {
  return jwt.sign(claims, PRIVATE_KEY, { algorithm: "RS256", expiresIn, issuer: "filitech-erp" });
}

export function verifySessionToken(token: string): SessionClaims {
  return jwt.verify(token, PUBLIC_KEY, { algorithms: ["RS256"], issuer: "filitech-erp" }) as SessionClaims;
}

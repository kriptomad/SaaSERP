// apps/api/src/modules/auth/jwt.service.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 3.5 — Segurança de Autenticação (JWT RS256).
import jwt from "jsonwebtoken";
import { JWT_PRIVATE_KEY as PRIVATE_KEY, JWT_PUBLIC_KEY as PUBLIC_KEY } from "../../lib/jwt-keys";

export interface SessionClaims {
  userId: string;
  tenantId: string;
  role: "OWNER" | "MANAGER" | "TECHNICIAN" | "CASHIER";
}

export function signSessionToken(claims: SessionClaims): string {
  return jwt.sign(claims, PRIVATE_KEY, { algorithm: "RS256", expiresIn: "8h", issuer: "filitech-erp" });
}

export function verifySessionToken(token: string): SessionClaims {
  return jwt.verify(token, PUBLIC_KEY, { algorithms: ["RS256"], issuer: "filitech-erp" }) as SessionClaims;
}

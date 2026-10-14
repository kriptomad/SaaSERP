// apps/api/src/modules/licensing/license-token.service.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 2.10 — Licença Mestra. Reaproveita o MESMO
// par de chaves RS256 já usado para o token de sessão (Capítulo 3.5), mas com um
// `issuer` distinto ("filitech-license" vs. "filitech-erp") para que um token de
// sessão nunca possa ser aceito como token de licença offline, e vice-versa.
//
// Este token é o que o app desktop Electron (construído em paralelo) cacheia
// localmente e usa para continuar funcionando sem internet dentro da janela de
// validade (padrão 7 dias, `LICENSE_OFFLINE_TOKEN_DAYS`): a verificação é puramente
// criptográfica (RS256 + expiração), nunca depende de bater no banco.
import jwt from "jsonwebtoken";
import { JWT_PRIVATE_KEY as PRIVATE_KEY, JWT_PUBLIC_KEY as PUBLIC_KEY } from "../../lib/jwt-keys";
import { TenantLicenseStatus } from "@filitech/db";
import { getPlatformSecret } from "../../lib/platform-secrets";

export interface LicenseTokenClaims {
  tenantId: string;
  status: TenantLicenseStatus;
  licensedModules: string[];
  deviceFingerprint: string;
}

const LICENSE_ISSUER = "filitech-license";

export async function getOfflineTokenValidityDays(): Promise<number> {
  const raw = await getPlatformSecret("LICENSE_OFFLINE_TOKEN_DAYS");
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 7;
}

export function signLicenseToken(claims: LicenseTokenClaims, validityDays: number): string {
  return jwt.sign(claims, PRIVATE_KEY, { algorithm: "RS256", expiresIn: `${validityDays}d`, issuer: LICENSE_ISSUER });
}

export interface VerifiedLicenseToken extends LicenseTokenClaims {
  issuedAt: Date;
  expiresAt: Date;
}

/// Verificação 100% offline: apenas assinatura RS256 (chave pública, sem round-trip
/// de rede) + expiração embutida no próprio JWT. Lança se inválido/expirado — quem
/// chama decide como traduzir isso em resposta HTTP (Capítulo 2.10).
export function verifyLicenseToken(token: string): VerifiedLicenseToken {
  const decoded = jwt.verify(token, PUBLIC_KEY, { algorithms: ["RS256"], issuer: LICENSE_ISSUER }) as jwt.JwtPayload & LicenseTokenClaims;
  return {
    tenantId: decoded.tenantId,
    status: decoded.status,
    licensedModules: decoded.licensedModules,
    deviceFingerprint: decoded.deviceFingerprint,
    issuedAt: new Date(decoded.iat! * 1000),
    expiresAt: new Date(decoded.exp! * 1000),
  };
}

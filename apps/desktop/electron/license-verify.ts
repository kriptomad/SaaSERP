// apps/desktop/electron/license-verify.ts
// Verificação criptográfica REAL do token de licença offline — espelha exatamente
// `verifyLicenseToken` de apps/api/src/modules/licensing/license-token.service.ts
// (mesmo algoritmo RS256 + issuer "filitech-license"), mas rodando só com a chave
// PÚBLICA (nunca a privada) embutida neste shell (ver license-keys.ts).
//
// CORREÇÃO DE AUDITORIA (fa-desktop-offline-license-no-signature,
// fa-desktop-license-status-no-signature-check): antes, a validação offline só lia
// `cached.offlineTokenExpiresAt`/`status` de um JSON mutável em disco
// (`filitech-desktop-config.json`) — qualquer edição manual desse arquivo (ou um
// `config:patch` comprometido, já removido) bastava para fabricar uma licença válida
// sem nunca ter passado pela API real. Agora, sempre que há um `license.token`
// cacheado, ele é verificado com `jsonwebtoken` contra a chave pública RS256 antes de
// qualquer decisão de "válido offline" — assinatura inválida/expirada/issuer errado
// invalida a licença mesmo que o JSON local diga o contrário.
import jwt from "jsonwebtoken";
import { LICENSE_PUBLIC_KEY } from "./license-keys";
import type { LicenseCache, TenantSessionCache } from "./ipc-contract";

const LICENSE_ISSUER = "filitech-license";

export interface VerifiedLicenseClaims {
  tenantId: string;
  status: LicenseCache["status"];
  licensedModules: string[];
  deviceFingerprint: string;
  expiresAt: Date;
}

export type LicenseVerificationResult =
  | { valid: true; claims: VerifiedLicenseClaims }
  | { valid: false; reason: string };

/**
 * Verifica assinatura RS256 + issuer + expiração/nbf (via `jwt.verify`, que já falha
 * para token expirado/ainda-não-válido) e, em seguida, confere que o token pertence a
 * ESTE dispositivo (`deviceFingerprint`) e, se há uma sessão de tenant ativa, ao MESMO
 * tenant — nunca confia apenas no campo `status` solto do cache local.
 */
export function verifyOfflineLicenseToken(
  token: string,
  expectedDeviceFingerprint: string | null,
  expectedSession: TenantSessionCache | null,
): LicenseVerificationResult {
  let decoded: jwt.JwtPayload;
  try {
    decoded = jwt.verify(token, LICENSE_PUBLIC_KEY, { algorithms: ["RS256"], issuer: LICENSE_ISSUER }) as jwt.JwtPayload;
  } catch (error) {
    return { valid: false, reason: `Assinatura do token de licença inválida/expirada: ${(error as Error).message}` };
  }

  const tenantId = decoded.tenantId as string | undefined;
  const deviceFingerprint = decoded.deviceFingerprint as string | undefined;
  const status = decoded.status as LicenseCache["status"] | undefined;
  const licensedModules = (decoded.licensedModules as string[] | undefined) ?? [];
  if (!tenantId || !deviceFingerprint || !status) {
    return { valid: false, reason: "Token de licença sem claims obrigatórias." };
  }
  if (expectedDeviceFingerprint && deviceFingerprint !== expectedDeviceFingerprint) {
    return { valid: false, reason: "Token de licença emitido para outro dispositivo." };
  }
  if (expectedSession && expectedSession.tenant.id !== tenantId) {
    return { valid: false, reason: "Token de licença pertence a outro tenant." };
  }

  return {
    valid: true,
    claims: {
      tenantId,
      status,
      licensedModules,
      deviceFingerprint,
      expiresAt: new Date((decoded.exp ?? 0) * 1000),
    },
  };
}

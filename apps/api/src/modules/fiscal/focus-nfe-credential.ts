// apps/api/src/modules/fiscal/focus-nfe-credential.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 20.3 — resolução da credencial Focus NFe,
// extraída de transmit-fiscal-event.ts (cancelamento) para ser reaproveitada também
// pela emissão real (emit-fiscal-document.service.ts), sem duplicar a lógica de
// fallback tenant → plataforma.
import { TenantScopedPrismaClient } from "@filitech/db";
import { decryptEnvelope } from "../../lib/envelope-crypto";

export class FocusNfeNotConfiguredError extends Error {}

export interface FocusNfeCredentialPayload {
  token: string;
  [key: string]: unknown;
}

export function isFocusNfeCredentialPayload(value: Record<string, unknown>): value is FocusNfeCredentialPayload {
  return typeof value.token === "string" && value.token.length > 0;
}

/**
 * Localiza a credencial Focus NFe aplicável: prioriza uma credencial própria do
 * tenant (lojista trouxe seu próprio contrato Focus NFe) e cai para a credencial de
 * plataforma (tenantId nulo — conta mestra/revenda Filitech) quando o tenant não
 * configurou a própria, conforme o modelo documentado no schema
 * (IntegrationCredential.tenantId nulo = "credencial de plataforma"). Nunca lida com
 * env vars — toda credencial é parametrizável via painel admin > Integrações.
 */
export async function resolveFocusNfeCredential(prisma: TenantScopedPrismaClient, tenantId: string) {
  const tenantCredential = await prisma.integrationCredential.findUnique({
    where: {
      tenantId_provider_environment: { tenantId, provider: "FISCAL_FOCUS_NFE", environment: "PRODUCTION" },
    },
  });
  if (tenantCredential?.active) {
    return tenantCredential;
  }

  const platformCredential = await prisma.integrationCredential.findFirst({
    where: { tenantId: null, provider: "FISCAL_FOCUS_NFE", environment: "PRODUCTION", active: true },
  });
  return platformCredential ?? null;
}

/** Decodifica e valida o payload de credencial Focus NFe, lançando o mesmo erro
 * "fail-closed" usado pelo cancelamento quando o formato é inválido/incompleto. */
export function decryptFocusNfeCredential(credential: {
  encryptedPayload: Uint8Array | Buffer;
  encryptionKeyId: string;
}): FocusNfeCredentialPayload {
  const decrypted = decryptEnvelope(Buffer.from(credential.encryptedPayload), credential.encryptionKeyId);
  if (!isFocusNfeCredentialPayload(decrypted)) {
    throw new FocusNfeNotConfiguredError(
      "Credencial Focus NFe cadastrada está com formato inválido (esperado { token }). Refaça o cadastro em Configurações > Integrações.",
    );
  }
  return decrypted;
}

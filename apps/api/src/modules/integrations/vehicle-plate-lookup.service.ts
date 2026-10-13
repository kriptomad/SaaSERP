// apps/api/src/modules/integrations/vehicle-plate-lookup.service.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 11.9 (Oficina Mecânica/Autoelétrica) —
// "A consulta automática pela placa é real, não mock": integração com a API Placa
// Fipe (GET https://placas.fipeapi.com.br/placas/{placa}?key={apiKey}), modelada
// como mais um provedor do framework central de integrações (Capítulo 20) — mesma
// credencial cifrada (`IntegrationCredential`) já usada por WhatsApp/Focus NFe/Asaas,
// nunca um caminho de integração paralelo e solto.
//
// Integração OPCIONAL por design: sem credencial ativa cadastrada em
// /settings/integrations, a consulta simplesmente retorna null e o cadastro de
// Vehicle segue 100% manual — nunca bloqueia o lojista que não contratou o provedor.
import { prismaUnscoped as prisma } from "@filitech/db";
import { decryptEnvelope } from "../../lib/envelope-crypto";

const REQUEST_TIMEOUT_MS = 5_000;

export interface PlateLookupResult {
  brand: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  fipeCode: string | null;
}

export async function lookupVehicleByPlate(tenantId: string, plate: string): Promise<PlateLookupResult | null> {
  const credential = await prisma.integrationCredential.findUnique({
    where: { tenantId_provider_environment: { tenantId, provider: "VEHICLE_DATA_FIPE_PLACA", environment: "PRODUCTION" } },
  });
  if (!credential || !credential.active) {
    return null;
  }

  let decrypted: Record<string, unknown>;
  try {
    decrypted = decryptEnvelope(Buffer.from(credential.encryptedPayload), credential.encryptionKeyId);
  } catch {
    return null;
  }
  if (typeof decrypted.apiKey !== "string" || !decrypted.apiKey) {
    return null;
  }

  try {
    const response = await fetch(`https://placas.fipeapi.com.br/placas/${encodeURIComponent(plate)}?key=${encodeURIComponent(decrypted.apiKey)}`, {
      method: "GET",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      // Falha na consulta (placa inexistente, provedor fora do ar, etc.) nunca
      // bloqueia o cadastro — apenas deixa de pré-preencher os campos.
      return null;
    }
    const data = (await response.json()) as Record<string, unknown>;
    return {
      brand: typeof data.marca === "string" ? data.marca : null,
      model: typeof data.modelo === "string" ? data.modelo : null,
      year: typeof data.ano === "number" ? data.ano : Number(data.ano) || null,
      color: typeof data.cor === "string" ? data.cor : null,
      fipeCode: typeof data.codigoFipe === "string" ? data.codigoFipe : null,
    };
  } catch {
    return null;
  }
}

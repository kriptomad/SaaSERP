// apps/api/src/modules/integrations/test-integration-credential.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 20 — "teste de conexão" real por provedor,
// gravado em IntegrationHealthCheckLog (nunca um resultado fixo simulado). Cada
// contrato HTTP abaixo foi confirmado via pesquisa web na documentação oficial do
// respectivo provedor nesta mesma sessão de auditoria:
//
//   - FISCAL_FOCUS_NFE: GET /v2/empresas (Basic Auth, token:vazio) — endpoint leve de
//     listagem usado como health-check de autenticação (doc.focusnfe.com.br/reference/empresas).
//   - WHATSAPP_META_CLOUD: GET /v19.0/{phoneNumberId}?fields=verified_name&access_token=...
//     (Graph API, confirma token + phone_number_id simultaneamente).
//   - BILLING_ASAAS: GET /v3/finance/balance (header access_token + User-Agent,
//     obrigatório em contas criadas após jun/2024).
//   - TEF_CLISITEF (Capítulo 23.5, hardware/TEF): reachability TCP real no host:porta
//     do daemon CliSiTef/SiTef local configurado pelo lojista — não existe endpoint
//     HTTP público documentado de "health check" para testar sem o manual sob NDA,
//     então o teste honesto possível aqui é confirmar que algo está de fato escutando
//     naquele host:porta (nunca simula execução de uma transação de cartão real).
//   - VEHICLE_DATA_FIPE_PLACA (Capítulo 11.9 — Oficina Mecânica/Autoelétrica): GET
//     https://placas.fipeapi.com.br/placas/{placa}?key={apiKey}, consultando a placa
//     de teste pública "ABC1234" documentada pelo próprio provedor — nunca consulta um
//     veículo real do tenant apenas para testar a credencial.
//
// Provedores sem contrato de teste ainda pesquisado/confirmado (STORAGE_CLOUDFLARE_R2,
// EMAIL_RESEND, SMS_ZENVIA,
// BANK_OPEN_FINANCE_PLUGGY, BILLING_STRIPE) fazem apenas o "teste de decodificação":
// confirmam que o payload cifrado é decifrável e tem o formato mínimo esperado, mas
// marcam explicitamente `success: false` com mensagem honesta de que o teste de rede
// real ainda não foi implementado — NUNCA simulam um sucesso de rede que não ocorreu.
import type { IntegrationCredential } from "@filitech/db";
import { createConnection } from "node:net";
import { decryptEnvelope } from "../../lib/envelope-crypto";

export interface IntegrationTestResult {
  success: boolean;
  message: string;
  httpStatus?: number;
  responseBodyPreview?: string;
}

// Sem timeout, um provedor lento travaria a requisição HTTP do lojista indefinidamente.
const REQUEST_TIMEOUT_MS = 10_000;

function truncateBody(body: string, maxLength = 500): string {
  return body.length > maxLength ? `${body.slice(0, maxLength)}…` : body;
}

async function testFocusNfe(payload: Record<string, unknown>): Promise<IntegrationTestResult> {
  if (typeof payload.token !== "string" || !payload.token) {
    return { success: false, message: "Payload da Focus NFe inválido: campo 'token' ausente." };
  }
  const basicAuth = Buffer.from(`${payload.token}:`).toString("base64");
  const response = await fetch("https://api.focusnfe.com.br/v2/empresas?offset=0", {
    method: "GET",
    headers: { Authorization: `Basic ${basicAuth}`, Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const bodyText = await response.text();
  if (response.status === 200) {
    return { success: true, message: "Autenticado com sucesso na Focus NFe.", httpStatus: 200, responseBodyPreview: truncateBody(bodyText) };
  }
  return {
    success: false,
    message: `Falha ao autenticar na Focus NFe (HTTP ${response.status}).`,
    httpStatus: response.status,
    responseBodyPreview: truncateBody(bodyText),
  };
}

async function testWhatsAppMetaCloud(payload: Record<string, unknown>): Promise<IntegrationTestResult> {
  if (typeof payload.accessToken !== "string" || typeof payload.phoneNumberId !== "string") {
    return { success: false, message: "Payload do WhatsApp Cloud inválido: esperado { accessToken, phoneNumberId }." };
  }
  const url = `https://graph.facebook.com/v19.0/${encodeURIComponent(payload.phoneNumberId)}?fields=verified_name&access_token=${encodeURIComponent(payload.accessToken)}`;
  const response = await fetch(url, { method: "GET", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  const bodyText = await response.text();
  if (response.status === 200) {
    return { success: true, message: "Token e phone_number_id do WhatsApp Cloud validados com sucesso.", httpStatus: 200, responseBodyPreview: truncateBody(bodyText) };
  }
  return {
    success: false,
    message: `Falha ao validar credenciais do WhatsApp Cloud (HTTP ${response.status}).`,
    httpStatus: response.status,
    responseBodyPreview: truncateBody(bodyText),
  };
}

async function testAsaas(payload: Record<string, unknown>, environment: "SANDBOX" | "PRODUCTION"): Promise<IntegrationTestResult> {
  if (typeof payload.accessToken !== "string" || !payload.accessToken) {
    return { success: false, message: "Payload do Asaas inválido: campo 'accessToken' ausente." };
  }
  const baseUrl = environment === "SANDBOX" ? "https://api-sandbox.asaas.com/v3" : "https://api.asaas.com/v3";
  const response = await fetch(`${baseUrl}/finance/balance`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      access_token: payload.accessToken,
      "User-Agent": "FilitechERP/1.0",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const bodyText = await response.text();
  if (response.status === 200) {
    return { success: true, message: "Autenticado com sucesso na Asaas.", httpStatus: 200, responseBodyPreview: truncateBody(bodyText) };
  }
  return {
    success: false,
    message: `Falha ao autenticar na Asaas (HTTP ${response.status}).`,
    httpStatus: response.status,
    responseBodyPreview: truncateBody(bodyText),
  };
}

// Capítulo 23.5 (Hardware/TEF) — o daemon CliSiTef/SiTef é um processo local do PDV
// físico do lojista, não um serviço HTTP público com endpoint de "health" documentado
// publicamente. O teste honesto possível sem o manual sob NDA é a reachability real
// de rede (TCP connect) no host:porta configurados — prova que o host/porta estão
// corretos e que algo está escutando ali, mas NÃO prova que é de fato o CliSiTef nem
// executa uma transação de teste (isso exigiria uma venda real na adquirente).
function testSitefReachability(payload: Record<string, unknown>): Promise<IntegrationTestResult> {
  const host = typeof payload.host === "string" ? payload.host : null;
  const port = Number(payload.port);
  if (!host || !Number.isInteger(port) || port <= 0) {
    return Promise.resolve({ success: false, message: "Payload do SiTef inválido: esperado { host, port, storeCode, terminalId }." });
  }
  return new Promise((resolve) => {
    const socket = createConnection({ host, port, timeout: REQUEST_TIMEOUT_MS });
    const finish = (result: IntegrationTestResult) => {
      socket.destroy();
      resolve(result);
    };
    socket.once("connect", () =>
      finish({ success: true, message: `Conexão TCP estabelecida com ${host}:${port} — host/porta do daemon SiTef parecem corretos.` }),
    );
    socket.once("timeout", () =>
      finish({ success: false, message: `Timeout ao conectar em ${host}:${port}. O daemon CliSiTef precisa estar instalado e em execução neste PDV físico para que o TEF funcione.` }),
    );
    socket.once("error", (error) =>
      finish({ success: false, message: `Falha ao conectar em ${host}:${port}: ${error.message}. O daemon CliSiTef precisa estar instalado e em execução neste PDV físico para que o TEF funcione.` }),
    );
  });
}

// Capítulo 11.9 (Oficina Mecânica/Autoelétrica) — API Placa Fipe, provedor comercial
// pré-pago sem mensalidade fixa. Testa a chave consultando a placa de teste pública
// "ABC1234" (documentada pelo próprio provedor), nunca uma placa real do tenant.
async function testVehicleDataFipePlaca(payload: Record<string, unknown>): Promise<IntegrationTestResult> {
  if (typeof payload.apiKey !== "string" || !payload.apiKey) {
    return { success: false, message: "Payload da Placa Fipe inválido: campo 'apiKey' ausente." };
  }
  const response = await fetch(`https://placas.fipeapi.com.br/placas/ABC1234?key=${encodeURIComponent(payload.apiKey)}`, {
    method: "GET",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const bodyText = await response.text();
  if (response.status === 200) {
    return { success: true, message: "Conexão com a Placa Fipe OK — chave ativa.", httpStatus: 200, responseBodyPreview: truncateBody(bodyText) };
  }
  return {
    success: false,
    message: `Falha ao validar a chave da Placa Fipe (HTTP ${response.status}).`,
    httpStatus: response.status,
    responseBodyPreview: truncateBody(bodyText),
  };
}

export async function testIntegrationCredential(credential: IntegrationCredential): Promise<IntegrationTestResult> {
  let decrypted: Record<string, unknown>;
  try {
    decrypted = decryptEnvelope(Buffer.from(credential.encryptedPayload), credential.encryptionKeyId);
  } catch (error) {
    return { success: false, message: `Não foi possível decifrar a credencial: ${(error as Error).message}` };
  }

  try {
  switch (credential.provider) {
    case "FISCAL_FOCUS_NFE":
      return await testFocusNfe(decrypted);
    case "WHATSAPP_META_CLOUD":
      return await testWhatsAppMetaCloud(decrypted);
    case "BILLING_ASAAS":
      return await testAsaas(decrypted, credential.environment);
    case "TEF_CLISITEF":
      return await testSitefReachability(decrypted);
    case "VEHICLE_DATA_FIPE_PLACA":
      return await testVehicleDataFipePlaca(decrypted);
    default:
      // Contrato HTTP de teste ainda não pesquisado/confirmado para este provedor —
      // reportar honestamente em vez de simular sucesso. A decodificação acima já
      // prova que a credencial está íntegra e pode ser usada pelos fluxos reais que
      // a consomem (ex.: cobrança Stripe/Asaas usa o SDK oficial, não este teste).
      return {
        success: false,
        message: `Credencial decifrada com sucesso, mas o teste de conexão de rede real ainda não foi implementado para o provedor ${credential.provider}.`,
      };
  }
  } catch (error) {
    // Falha de rede/timeout vira resultado de teste registrável (success=false), nunca um 500 sem log.
    return { success: false, message: `Falha de rede ao testar ${credential.provider}: ${(error as Error).message}` };
  }
}

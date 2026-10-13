// apps/api/src/modules/billing/asaas.client.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 2.7.2 — chamadas HTTP reais à API do Asaas
// (tokenização de cartão + assinatura recorrente), nunca mock/stub local.
const ASAAS_BASE_URL = process.env.ASAAS_BASE_URL ?? "https://www.asaas.com/api/v3";

function asaasHeaders() {
  return {
    "Content-Type": "application/json",
    access_token: process.env.ASAAS_API_KEY ?? "",
  };
}

async function asaasRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${ASAAS_BASE_URL}${path}`, {
    ...init,
    headers: { ...asaasHeaders(), ...init?.headers },
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`Asaas API error (${response.status}): ${JSON.stringify(body)}`);
  }
  return body as T;
}

export interface TokenizeCreditCardInput {
  customer: string;
  creditCard: { holderName: string; number: string; expiryMonth: string; expiryYear: string; ccv: string };
  creditCardHolderInfo: {
    name: string;
    email: string;
    cpfCnpj: string;
    postalCode: string;
    addressNumber: string;
    phone: string;
  };
  remoteIp: string;
}

export interface TokenizeCreditCardResponse {
  creditCardToken: string;
  creditCardNumber: string;
  creditCardBrand: string;
}

// Capítulo 2.7.2, Passo 1 — tokeniza o cartão (chamado uma única vez no cadastro/troca).
export function tokenizeCreditCard(input: TokenizeCreditCardInput): Promise<TokenizeCreditCardResponse> {
  return asaasRequest("/creditCard/tokenize", { method: "POST", body: JSON.stringify(input) });
}

export interface CreateAsaasSubscriptionInput {
  customer: string;
  billingType: "CREDIT_CARD";
  cycle: "MONTHLY";
  value: number;
  nextDueDate: string;
  creditCardToken: string;
  description: string;
}

// Capítulo 2.7.2, Passo 2 — cria a assinatura recorrente usando o token salvo.
export function createAsaasSubscription(input: CreateAsaasSubscriptionInput) {
  return asaasRequest("/subscriptions", { method: "POST", body: JSON.stringify(input) });
}

// Capítulo 2.7.6 — reembolso integral (janela de arrependimento Art. 49 CDC).
export function refundAsaasPayment(paymentId: string) {
  return asaasRequest(`/payments/${paymentId}/refund`, { method: "POST" });
}

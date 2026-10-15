// apps/api/src/modules/billing/asaas.client.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 2.7.2 — chamadas HTTP reais à API do Asaas
// (tokenização de cartão + assinatura recorrente), nunca mock/stub local.
import { getPlatformSecret } from "../../lib/platform-secrets";

// URL base e API key resolvidas por chamada via painel admin → Infraestrutura (banco,
// cifrado) com fallback para `process.env` (Capítulo 20.9) — nunca cacheadas em módulo,
// já que uma troca pelo painel precisa valer na próxima requisição (cache de 15s em
// `getPlatformSecret` já evita round-trip excessivo ao banco).
async function resolveAsaasBaseUrl(): Promise<string> {
  return (await getPlatformSecret("ASAAS_BASE_URL")) ?? "https://www.asaas.com/api/v3";
}

async function asaasHeaders() {
  return {
    "Content-Type": "application/json",
    access_token: (await getPlatformSecret("ASAAS_API_KEY")) ?? "",
  };
}

async function asaasRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const baseUrl = await resolveAsaasBaseUrl();
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { ...(await asaasHeaders()), ...init?.headers },
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

// Capítulo 2.7.6 — cancelamento self-service. O Asaas não tem agendamento de
// cancelamento para o fim do ciclo (diferente do Stripe `cancel_at_period_end`):
// cancela imediatamente a assinatura no provedor, então o caller nunca deve chamar
// isto para o caso "agendar para o fim do período" — nesse caso o cancelamento real
// no Asaas é disparado depois, quando o ciclo vigente efetivamente fecha (ver
// enforceScheduledCancellations em subscription.routes.ts), e localmente só se marca
// `cancelAtPeriodEnd=true` até lá.
export function cancelAsaasSubscription(subscriptionId: string) {
  return asaasRequest(`/subscriptions/${subscriptionId}`, { method: "DELETE" });
}

// Capítulo 2.6 — Asaas não tem o conceito de "subscription item" por módulo como o
// Stripe: a assinatura é um único valor fixo por ciclo. Para refletir módulos à la
// carte ativados/desativados, recalculamos e sobrescrevemos o `value` total (base +
// soma dos módulos ativos) a cada ativação/desativação.
export function updateAsaasSubscriptionValue(subscriptionId: string, newValue: number) {
  return asaasRequest(`/subscriptions/${subscriptionId}`, { method: "PUT", body: JSON.stringify({ value: newValue }) });
}

// Capítulo 9.3 — Checkout hospedado do Asaas para a contratação inicial de
// plano+módulos. Diferente do Stripe, o Asaas não modela "vários itens
// recorrentes" na mesma assinatura: `items` aqui é só o detalhamento visual da
// página de pagamento, o valor efetivamente cobrado é `subscription.value`
// (soma de tudo, mesma filosofia de `updateAsaasSubscriptionValue` acima).
export interface AsaasCheckoutInput {
  customer: string;
  items: Array<{ name: string; value: number }>;
  totalValue: number;
  nextDueDate: string; // YYYY-MM-DD
  successUrl: string;
  cancelUrl: string;
  expiredUrl: string;
  externalReference: string;
}

export interface AsaasCheckoutResponse {
  id: string;
  link: string;
}

export function createAsaasCheckout(input: AsaasCheckoutInput): Promise<AsaasCheckoutResponse> {
  return asaasRequest("/checkouts", {
    method: "POST",
    body: JSON.stringify({
      billingTypes: ["CREDIT_CARD", "PIX"],
      chargeTypes: ["RECURRENT"],
      minutesToExpire: 60,
      customer: input.customer,
      externalReference: input.externalReference,
      callback: { successUrl: input.successUrl, cancelUrl: input.cancelUrl, expiredUrl: input.expiredUrl },
      items: input.items.map((item) => ({ name: item.name, quantity: 1, value: item.value })),
      subscription: { cycle: "MONTHLY", nextDueDate: input.nextDueDate, value: input.totalValue },
    }),
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Capítulo 9/17 — cobranças de Boleto/Pix emitidas pelo PRÓPRIO lojista aos
// seus clientes finais (PaymentCharge), distinto da cobrança de assinatura
// SaaS acima (Tenant → Filitech). Mesmo provedor (Asaas), conta de cada
// lojista é identificada pelo `externalProviderId` persistido em `Client`
// (criado sob demanda na primeira cobrança, reaproveitado nas seguintes).
// ─────────────────────────────────────────────────────────────────────────

export interface CreateAsaasCustomerInput {
  name: string;
  cpfCnpj: string;
  email?: string;
  phone?: string;
  externalReference?: string;
}

export interface AsaasCustomerResponse {
  id: string;
}

// Cria (ou retorna, se o Asaas detectar duplicidade pelo cpfCnpj) o cliente
// final no PSP — necessário antes de emitir qualquer cobrança avulsa.
export function createAsaasCustomer(input: CreateAsaasCustomerInput): Promise<AsaasCustomerResponse> {
  return asaasRequest("/customers", { method: "POST", body: JSON.stringify(input) });
}

export interface CreateAsaasChargeInput {
  customer: string;
  billingType: "BOLETO" | "PIX";
  value: number;
  dueDate: string; // YYYY-MM-DD
  description: string;
  externalReference?: string;
}

export interface AsaasChargeResponse {
  id: string;
  status: string;
  invoiceUrl: string;
  bankSlipUrl?: string;
}

// Capítulo 9 — emite a cobrança avulsa (boleto ou Pix) de uma AccountReceivable.
export function createAsaasCharge(input: CreateAsaasChargeInput): Promise<AsaasChargeResponse> {
  return asaasRequest("/payments", { method: "POST", body: JSON.stringify(input) });
}

export interface AsaasIdentificationField {
  identificationField: string; // linha digitável do boleto
}

export function getAsaasBoletoIdentificationField(paymentId: string): Promise<AsaasIdentificationField> {
  return asaasRequest(`/payments/${paymentId}/identificationField`);
}

export interface AsaasPixQrCode {
  encodedImage: string; // base64 PNG
  payload: string; // EMV copia-e-cola
}

export function getAsaasPixQrCode(paymentId: string): Promise<AsaasPixQrCode> {
  return asaasRequest(`/payments/${paymentId}/pixQrCode`);
}

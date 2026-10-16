// apps/api/src/modules/billing/stripe.client.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 2.7.3/20.1 — Stripe real via SDK oficial,
// nunca reimplementação manual de assinatura/HMAC.
import Stripe from "stripe";
import { getPlatformSecret } from "../../lib/platform-secrets";

// A chave é resolvida via painel admin → Infraestrutura (banco, cifrado) com
// fallback para `process.env.STRIPE_SECRET_KEY` (Capítulo 20.9) — nunca mais lida
// de forma síncrona no import do módulo, pois o admin pode trocá-la em runtime
// sem reiniciar o processo (propagação em até 15s via `getPlatformSecret`).
let cachedClient: Stripe | null = null;
let cachedKey: string | null = null;

export async function getStripeClient(): Promise<Stripe> {
  const key = await getPlatformSecret("STRIPE_SECRET_KEY");
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY não configurada — configure em Painel Admin → Infraestrutura ou na variável de ambiente antes de usar a integração Stripe.",
    );
  }
  if (cachedClient && cachedKey === key) {
    return cachedClient;
  }
  cachedClient = new Stripe(key, { apiVersion: "2025-02-24.acacia" });
  cachedKey = key;
  return cachedClient;
}

// Passo 1 — SetupIntent para salvar cartão sem cobrar (Capítulo 2.7.3).
export async function createSetupIntent(stripeCustomerId: string) {
  const stripe = await getStripeClient();
  return stripe.setupIntents.create({
    customer: stripeCustomerId,
    payment_method_types: ["card"],
    usage: "off_session",
  });
}

// Cobrança por assento (Capítulo 2.9) — sincroniza a `quantity` de um
// subscription item dedicado ao excedente de usuários. O Price de assento
// extra (R$ 35,00/mês/usuário) é configurado pelo admin da plataforma em
// SystemParameter["STRIPE_EXTRA_SEAT_PRICE_ID"] (painel admin → Integrações),
// nunca hardcoded aqui, pois o ID do Price varia por ambiente (test/live).
// Quando ainda não há item criado para o tenant, cria sob demanda (apenas na
// primeira vez que extraSeatCount > 0) e persiste o id retornado.
export async function syncSeatQuantityWithStripe(
  stripeSubscriptionId: string,
  existingSeatItemId: string | null,
  extraSeatPriceId: string,
  extraSeatCount: number,
): Promise<string | null> {
  if (extraSeatCount === 0 && !existingSeatItemId) {
    // Nunca cria o item só para registrar zero — evita linha de fatura inútil.
    return null;
  }

  const stripe = await getStripeClient();

  if (existingSeatItemId) {
    await stripe.subscriptionItems.update(existingSeatItemId, { quantity: extraSeatCount });
    return existingSeatItemId;
  }

  const item = await stripe.subscriptionItems.create({
    subscription: stripeSubscriptionId,
    price: extraSeatPriceId,
    quantity: extraSeatCount,
  });
  return item.id;
}

// Capítulo 2.6 — cobrança real de módulo à la carte ativado/desativado pelo
// lojista. Usa `price_data` inline (em vez de um Price ID fixo pré-cadastrado)
// porque o valor (`Module.monthlyPrice`) já é mantido no banco e pode variar
// por ambiente/promoção — mesma filosofia de "nunca hardcoded" do restante do
// cliente Stripe deste arquivo.
export async function addModuleToStripeSubscription(
  stripeSubscriptionId: string,
  moduleCode: string,
  moduleLabel: string,
  monthlyPriceBrl: number,
): Promise<string> {
  const stripe = await getStripeClient();
  // O product_data inline não existe para subscriptionItems.create (só para
  // invoiceItems) — por isso resolvemos (ou criamos, na primeira vez) um
  // Product dedicado por módulo, identificado pelo seu `moduleCode` em
  // metadata, e então usamos price_data apontando para ele.
  const existingProducts = await stripe.products.search({ query: `metadata['moduleCode']:'${moduleCode}'`, limit: 1 });
  const product = existingProducts.data[0] ?? (await stripe.products.create({ name: `Módulo Filitech — ${moduleLabel}`, metadata: { moduleCode } }));

  const item = await stripe.subscriptionItems.create({
    subscription: stripeSubscriptionId,
    price_data: {
      currency: "brl",
      product: product.id,
      unit_amount: Math.round(monthlyPriceBrl * 100),
      recurring: { interval: "month" },
    },
    metadata: { moduleCode },
  });
  return item.id;
}

export async function removeModuleFromStripeSubscription(subscriptionItemId: string): Promise<void> {
  const stripe = await getStripeClient();
  await stripe.subscriptionItems.del(subscriptionItemId);
}

// Resolve (ou cria, na primeira vez) o Customer Stripe deste tenant — cacheado em
// `Tenant.stripeCustomerId` pelo chamador (checkout.routes.ts) para nunca duplicar o
// cadastro numa segunda tentativa de checkout.
export async function findOrCreateStripeCustomer(existingId: string | null, email: string, name: string): Promise<string> {
  const stripe = await getStripeClient();
  if (existingId) {
    try {
      const existing = await stripe.customers.retrieve(existingId);
      if (!existing.deleted) return existingId;
    } catch {
      // customer id cacheado não existe mais no Stripe (ex.: troca de conta/ambiente) — recria abaixo.
    }
  }
  const created = await stripe.customers.create({ email, name });
  return created.id;
}

export interface StripeCheckoutLineItem {
  moduleCode: string | null; // null = item do plano base
  label: string;
  monthlyPriceBrl: number;
}

// Capítulo 9.3 — Checkout hospedado do Stripe para a contratação inicial de
// plano+módulos (nunca coleta dados de cartão diretamente na nossa API: o
// pagador preenche tudo na página hospedada do próprio Stripe).
export async function createStripeCheckoutSession(input: {
  customerId: string;
  items: StripeCheckoutLineItem[];
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
}) {
  const stripe = await getStripeClient();
  const line_items = await Promise.all(
    input.items.map(async (item) => {
      const query = item.moduleCode ? `metadata['moduleCode']:'${item.moduleCode}'` : `metadata['moduleCode']:'PLAN_BASE'`;
      const existingProducts = await stripe.products.search({ query, limit: 1 });
      const product =
        existingProducts.data[0] ??
        (await stripe.products.create({ name: `Filitech ERP — ${item.label}`, metadata: { moduleCode: item.moduleCode ?? "PLAN_BASE" } }));
      return {
        price_data: {
          currency: "brl",
          product: product.id,
          unit_amount: Math.round(item.monthlyPriceBrl * 100),
          recurring: { interval: "month" as const },
        },
        quantity: 1,
      };
    }),
  );

  return stripe.checkout.sessions.create({
    mode: "subscription",
    customer: input.customerId,
    line_items,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    metadata: input.metadata,
    subscription_data: { metadata: input.metadata },
  });
}

// Passo 2 — assinatura recorrente com cobrança automática (Capítulo 2.7.3).
export async function createRecurringSubscription(stripeCustomerId: string, priceId: string, paymentMethodId: string) {
  const stripe = await getStripeClient();
  await stripe.paymentMethods.attach(paymentMethodId, { customer: stripeCustomerId });
  await stripe.customers.update(stripeCustomerId, {
    invoice_settings: { default_payment_method: paymentMethodId },
  });

  return stripe.subscriptions.create({
    customer: stripeCustomerId,
    items: [{ price: priceId }],
    collection_method: "charge_automatically",
    payment_settings: { payment_method_types: ["card"], save_default_payment_method: "on_subscription" },
    expand: ["latest_invoice.payment_intent"],
  });
}

// Capítulo 2.7.6 — cancelamento self-service. `atPeriodEnd=true` agenda o fim da
// cobrança para o fechamento do ciclo vigente (acesso mantido até lá); `false` cancela
// e encerra o acesso imediatamente (usado só dentro da janela de arrependimento do
// Art. 49 CDC, combinado com o reembolso integral da última cobrança).
export async function cancelStripeSubscription(stripeSubscriptionId: string, atPeriodEnd: boolean) {
  const stripe = await getStripeClient();
  if (atPeriodEnd) {
    return stripe.subscriptions.update(stripeSubscriptionId, { cancel_at_period_end: true });
  }
  return stripe.subscriptions.cancel(stripeSubscriptionId);
}

// Desfaz um cancelamento agendado para o fim do ciclo (ainda não efetivado no Stripe).
export async function undoStripeScheduledCancellation(stripeSubscriptionId: string) {
  const stripe = await getStripeClient();
  return stripe.subscriptions.update(stripeSubscriptionId, { cancel_at_period_end: false });
}

// Reembolso integral da última fatura paga (Art. 49 CDC) — busca o PaymentIntent da
// invoice mais recente da assinatura e emite o refund total via Stripe.
export async function refundLatestStripeInvoice(stripeSubscriptionId: string): Promise<string | null> {
  const stripe = await getStripeClient();
  const invoices = await stripe.invoices.list({ subscription: stripeSubscriptionId, status: "paid", limit: 1 });
  const invoice = invoices.data[0];
  const paymentIntentId = typeof invoice?.payment_intent === "string" ? invoice.payment_intent : invoice?.payment_intent?.id;
  if (!paymentIntentId) return null;
  const refund = await stripe.refunds.create({ payment_intent: paymentIntentId });
  return refund.id;
}

// GAP DE AUDITORIA FECHADO (Rodada 6, Capítulo 2.8) — a recompensa do indicador
// (`Subscription.creditBalanceMonths`) era gravada só localmente e NUNCA refletia na
// cobrança de verdade. Usa o "customer balance" nativo do Stripe (crédito acumulado
// que se abate automaticamente na(s) próxima(s) fatura(s), suportando inclusive mais
// de um mês de crédito de uma vez): um valor negativo aqui é crédito a favor do
// cliente, nunca débito.
export async function grantStripeCustomerBalanceCredit(stripeCustomerId: string, amountBrlCents: number, description: string): Promise<void> {
  if (amountBrlCents <= 0) return;
  const stripe = await getStripeClient();
  await stripe.customers.createBalanceTransaction(stripeCustomerId, {
    amount: -Math.round(amountBrlCents),
    currency: "brl",
    description,
  });
}

// Desconto de primeiro ciclo para o tenant INDICADO (Capítulo 2.8) — cupom
// `duration: "once"` criado sob demanda (nunca reaproveitado entre tenants
// diferentes, já que `percent_off` pode variar por SystemParameter) e aplicado
// diretamente na assinatura: o Stripe abate automaticamente na PRÓXIMA fatura
// gerada e nunca mais depois disso.
export async function applyStripeFirstCycleDiscount(stripeSubscriptionId: string, percentOff: number): Promise<void> {
  if (percentOff <= 0) return;
  const stripe = await getStripeClient();
  const coupon = await stripe.coupons.create({
    percent_off: percentOff,
    duration: "once",
    name: `Desconto de indicação — primeiro ciclo (${percentOff}%)`,
  });
  await stripe.subscriptions.update(stripeSubscriptionId, { coupon: coupon.id });
}

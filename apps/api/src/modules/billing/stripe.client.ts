// apps/api/src/modules/billing/stripe.client.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 2.7.3/20.1 — Stripe real via SDK oficial,
// nunca reimplementação manual de assinatura/HMAC.
import Stripe from "stripe";

// Em ambientes onde a chave ainda não foi configurada pelo administrador da
// plataforma (painel admin → Integrações, Capítulo 20.9), não derrubamos o
// processo inteiro na inicialização: o SDK é construído com um placeholder e
// qualquer chamada real falhará de forma controlada (401 do Stripe), permitindo
// que o restante do sistema (módulos que não dependem de billing) funcione.
if (!process.env.STRIPE_SECRET_KEY) {
  // eslint-disable-next-line no-console
  console.warn(
    "[billing] STRIPE_SECRET_KEY não configurada — integração Stripe operará em modo inativo até ser configurada no painel admin.",
  );
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "sk_test_not_configured_placeholder", {
  apiVersion: "2025-02-24.acacia",
});

// Passo 1 — SetupIntent para salvar cartão sem cobrar (Capítulo 2.7.3).
export async function createSetupIntent(stripeCustomerId: string) {
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

// Passo 2 — assinatura recorrente com cobrança automática (Capítulo 2.7.3).
export async function createRecurringSubscription(stripeCustomerId: string, priceId: string, paymentMethodId: string) {
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

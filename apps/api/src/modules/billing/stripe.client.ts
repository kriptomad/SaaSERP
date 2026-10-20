// apps/api/src/modules/billing/stripe.client.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 2.7.3/20.1 — Stripe real via SDK oficial,
// nunca reimplementação manual de assinatura/HMAC.
import Stripe from "stripe";
import crypto from "node:crypto";
import { getPlatformSecret } from "../../lib/platform-secrets";

// fa-w6-bl-no-explicit-proration-policy — antes, toda chamada que mudava
// quantity/items de um subscription item (assento extra, módulo à la carte,
// troca de plano base) dependia do comportamento PADRÃO do Stripe para
// proration (que É `create_prorations`, mas implícito — uma mudança futura do
// SDK/API ou de configuração da conta Stripe poderia alterar silenciosamente o
// comportamento de cobrança sem qualquer sinal no código). Explicitamos
// `create_prorations` (cobra/credita a diferença proporcional na PRÓXIMA
// fatura, nunca gera uma fatura avulsa imediata) porque é o que já documentamos
// em todo o resto do billing (Capítulo 2.7/2.9): mudanças de assento/módulo
// nunca geram cobrança instantânea fora do ciclo, sempre refletem no próximo
// fechamento — compatível com `always_invoice` seria uma mudança de UX maior
// (cobrança imediata) não indicada em nenhum outro ponto da Bible.
const SUBSCRIPTION_ITEM_PRORATION_BEHAVIOR = "create_prorations" as const;

// Chave de idempotência determinística para mutações de subscription item:
// mesmo princípio de `createStripeCheckoutSession` (chave explícita evita
// duplicação em retry), mas aqui derivada do tenant + tipo de mudança + um
// bucket de tempo de 1 minuto — curto o bastante para nunca colidir entre duas
// mudanças legítimas e distintas (ex.: duas reconciliações de assento minutos
// depois uma da outra), longo o bastante para absorver o retry automático do
// BullMQ/cliente HTTP da própria chamada que falhou.
function subscriptionItemIdempotencyKey(tenantId: string, changeType: string, extra: string): string {
  const timeBucket = Math.floor(Date.now() / 60_000);
  return crypto.createHash("sha256").update(`${tenantId}:${changeType}:${extra}:${timeBucket}`).digest("hex");
}

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
  tenantId: string,
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
    await stripe.subscriptionItems.update(
      existingSeatItemId,
      { quantity: extraSeatCount, proration_behavior: SUBSCRIPTION_ITEM_PRORATION_BEHAVIOR },
      { idempotencyKey: subscriptionItemIdempotencyKey(tenantId, "seat-update", `${existingSeatItemId}:${extraSeatCount}`) },
    );
    return existingSeatItemId;
  }

  // CORREÇÃO DE AUDITORIA (fa-seatbilling-stripe-local-not-atomic): o gap real não
  // está na transação local (reconcileSeatBillingWithProvider já serializa por
  // pg_advisory_xact_lock por tenant) — está aqui: se `stripe.subscriptionItems
  // .create` tiver sucesso mas a persistência local subsequente de
  // `stripeSeatSubscriptionItemId` falhar/nunca commitar (crash do processo,
  // timeout de rede na resposta, etc.), a próxima reconciliação chega aqui de novo
  // com `existingSeatItemId === null` e criaria um SEGUNDO item de assento na
  // mesma assinatura Stripe — cobrando o tenant em duplicidade. Antes de criar,
  // consultamos os subscription items JÁ existentes na assinatura e procuramos por
  // um que já use o mesmo Price de assento extra; se encontrado, reconciliamos
  // nele (atualizando a quantity) em vez de criar um novo, e devolvemos o id real
  // para o chamador persistir — fechando a janela de duplicação do lado Stripe.
  const existingItems = await stripe.subscriptionItems.list({ subscription: stripeSubscriptionId, limit: 100 });
  const orphanedSeatItem = existingItems.data.find((item) => item.price.id === extraSeatPriceId);
  if (orphanedSeatItem) {
    await stripe.subscriptionItems.update(
      orphanedSeatItem.id,
      { quantity: extraSeatCount, proration_behavior: SUBSCRIPTION_ITEM_PRORATION_BEHAVIOR },
      { idempotencyKey: subscriptionItemIdempotencyKey(tenantId, "seat-update", `${orphanedSeatItem.id}:${extraSeatCount}`) },
    );
    return orphanedSeatItem.id;
  }

  const item = await stripe.subscriptionItems.create(
    {
      subscription: stripeSubscriptionId,
      price: extraSeatPriceId,
      quantity: extraSeatCount,
      proration_behavior: SUBSCRIPTION_ITEM_PRORATION_BEHAVIOR,
    },
    { idempotencyKey: subscriptionItemIdempotencyKey(tenantId, "seat-create", stripeSubscriptionId) },
  );
  return item.id;
}

// Capítulo 2.6 — cobrança real de módulo à la carte ativado/desativado pelo
// lojista. Usa `price_data` inline (em vez de um Price ID fixo pré-cadastrado)
// porque o valor (`Module.monthlyPrice`) já é mantido no banco e pode variar
// por ambiente/promoção — mesma filosofia de "nunca hardcoded" do restante do
// cliente Stripe deste arquivo.
export async function addModuleToStripeSubscription(
  tenantId: string,
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

  const item = await stripe.subscriptionItems.create(
    {
      subscription: stripeSubscriptionId,
      price_data: {
        currency: "brl",
        product: product.id,
        unit_amount: Math.round(monthlyPriceBrl * 100),
        recurring: { interval: "month" },
      },
      proration_behavior: SUBSCRIPTION_ITEM_PRORATION_BEHAVIOR,
      metadata: { moduleCode },
    },
    { idempotencyKey: subscriptionItemIdempotencyKey(tenantId, "module-add", `${stripeSubscriptionId}:${moduleCode}`) },
  );
  return item.id;
}

// Capítulo 2.7/fa-w6-bl-no-plan-downgrade-workflow — troca do PLANO BASE de uma
// assinatura (upgrade/downgrade entre `Plan.code`s), distinto do item de assento
// extra e dos itens de módulo à la carte (cada um já rastreado por um id próprio:
// `Subscription.stripeSeatSubscriptionItemId`/`TenantModule.stripeSubscriptionItemId`).
// Não existe uma coluna dedicada para o id do item do plano base nem um Price ID
// fixo (o checkout original também usa `price_data` inline via o mesmo Product
// genérico "PLAN_BASE" — `createStripeCheckoutSession` — nunca um Price
// pré-cadastrado, pois `Plan.basePrice` pode mudar), então aqui resolvemos:
// (1) o item certo listando TODOS os subscription items da assinatura e
// excluindo os ids já conhecidos (assento + todos os módulos ativos do tenant,
// informados pelo chamador) — o item restante é, por eliminação, o do plano base;
// (2) o novo valor via `price_data` inline, mesmo Product "PLAN_BASE" do checkout.
// Se a assinatura tiver mais de um item restante (nunca deveria acontecer no fluxo
// normal, mas um item órfão de uma falha anterior não pode travar a troca de
// plano), usa o primeiro e sinaliza `ambiguous: true` para o chamador decidir se loga.
export async function updateBasePlanSubscriptionItem(input: {
  tenantId: string;
  stripeSubscriptionId: string;
  excludeItemIds: string[];
  newPlanLabel: string;
  newPlanMonthlyPriceBrl: number;
}): Promise<{ itemId: string; ambiguous: boolean }> {
  const stripe = await getStripeClient();
  const items = await stripe.subscriptionItems.list({ subscription: input.stripeSubscriptionId, limit: 100 });
  const candidates = items.data.filter((item) => !input.excludeItemIds.includes(item.id));
  if (candidates.length === 0) {
    throw new Error(`Nenhum subscription item de plano base encontrado na assinatura Stripe ${input.stripeSubscriptionId} (todos os itens correspondem a assento/módulos conhecidos).`);
  }
  const basePlanItem = candidates[0];

  const existingProducts = await stripe.products.search({ query: `metadata['moduleCode']:'PLAN_BASE'`, limit: 1 });
  const product = existingProducts.data[0] ?? (await stripe.products.create({ name: `Filitech ERP — ${input.newPlanLabel}`, metadata: { moduleCode: "PLAN_BASE" } }));

  await stripe.subscriptionItems.update(
    basePlanItem.id,
    {
      price_data: {
        currency: "brl",
        product: product.id,
        unit_amount: Math.round(input.newPlanMonthlyPriceBrl * 100),
        recurring: { interval: "month" },
      },
      proration_behavior: SUBSCRIPTION_ITEM_PRORATION_BEHAVIOR,
    },
    { idempotencyKey: subscriptionItemIdempotencyKey(input.tenantId, "plan-change", `${basePlanItem.id}:${input.newPlanMonthlyPriceBrl}`) },
  );

  return { itemId: basePlanItem.id, ambiguous: candidates.length > 1 };
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
  idempotencyKey?: string;
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

  return stripe.checkout.sessions.create(
    {
      mode: "subscription",
      customer: input.customerId,
      line_items,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      metadata: input.metadata,
      subscription_data: { metadata: input.metadata },
    },
    // Chave de idempotência (Capítulo 9.3, mega-audit rodada 7): se o cliente
    // retransmitir a MESMA requisição de checkout (ex.: o backend timeout na
    // primeira tentativa mas o Stripe já havia processado), o Stripe retorna a
    // sessão JÁ criada em vez de criar uma segunda — evita sessões duplicadas por
    // retry, sem precisar de lógica própria de deduplicação aqui.
    input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined,
  );
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

// apps/api/src/modules/billing/webhooks.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 2.7/7.3/20.1 — processamento real de webhooks
// Stripe (assinatura HMAC via SDK oficial) e Asaas (authToken de 32+ chars, comparação
// de tempo constante), ambos convergindo para a régua de dunning única (Cap.2.7.4).
// Idempotência garantida por uma máquina de estados explícita (PROCESSING/
// SUCCEEDED/FAILED com lease) sobre o @@unique([provider, externalEventKey]) de
// BillingEvent — ver `claimBillingEvent` abaixo (fa-billing-webhook-idempotency-race).
//
// EXCEÇÃO INTENCIONAL AO ENVELOPE PADRÃO (fa-w6-api-webhook-envelope-inconsistent):
// toda rota deste arquivo responde `{received: true}` (ou um corpo vazio/200 simples
// para Stripe) em vez do envelope padrão `{success, data, error}` (Capítulo 9) usado
// em TODO o resto da API. Isso é DELIBERADO, não um esquecimento: Stripe, Asaas,
// Pluggy e iFood são consumidores externos que esperam um formato de ack específico
// (ou simplesmente qualquer 2xx) documentado pelo PRÓPRIO provedor — mudar para o
// envelope interno não quebraria nada tecnicamente (os provedores só checam o status
// HTTP), mas divergiria sem necessidade do contrato que cada SDK/dashboard de
// provedor já documenta e exibe nos logs de entrega deles, sem nenhum ganho real.
// Nunca "corrija" isto para `{success,data,error}` — webhooks de provedor externo
// são a única exceção legítima e permanente a essa convenção neste código.
import { Router, Request, Response } from "express";
import crypto from "node:crypto";
import { prismaUnscoped } from "@filitech/db";
import { getStripeClient } from "./stripe.client";
import { getPlatformSecret } from "../../lib/platform-secrets";
import {
  handlePaymentFailure,
  handlePaymentRecovered,
  handleSubscriptionCanceled,
  handlePaymentReversed,
  handleSubscriptionPastDue,
} from "./dunning.service";
import { invalidateTenantModuleCache } from "../../middlewares/gatekeeper.middleware";
import { createModuleLogger } from "../../lib/logger";
import { markWebhookEventProcessed, wasWebhookEventAlreadyProcessed } from "../../lib/webhook-replay-guard";

const log = createModuleLogger("billing-webhooks");

// Capítulo 9.3 — promove a Subscription interina (PENDING_CHECKOUT, id local) para a
// assinatura real (ACTIVE, externalSubscriptionId do provedor) na primeira confirmação
// de pagamento do Checkout, e ativa de uma vez todos os módulos que o lojista escolheu
// na calculadora (`pendingModuleCodes`). Compartilhado pelos dois webhooks (Stripe e
// Asaas) — cada um só precisa resolver `pendingSubscriptionId`/`externalSubscriptionId`/
// `currentPeriodEnd` do jeito específico do seu payload antes de chamar isto.
async function activatePendingSubscription(
  pendingSubscriptionId: string,
  externalSubscriptionId: string,
  currentPeriodEnd: Date | null,
  moduleItemIds: Record<string, string>,
): Promise<{ tenantId: string } | null> {
  const pending = await prismaUnscoped.subscription.findUnique({
    where: { id: pendingSubscriptionId },
    include: { plan: { select: { includedModules: true } } },
  });
  if (!pending || pending.status !== "PENDING_CHECKOUT") {
    return null; // já processado (reentrega do webhook) ou nunca existiu
  }

  // GAP DE AUDITORIA FECHADO (Rodada 6) — `Plan.includedModules` (ex.: LIQUOR_LEDGER
  // dentro de COMBO_ADEGA_PRO) nunca virava uma linha `TenantModule` ativa: só os
  // códigos escolhidos à la carte (`pendingModuleCodes`) eram sincronizados. Resultado
  // real: todo tenant de um plano/combo que "inclui" um módulo de nicho recebia 402
  // "módulo não contratado" do gatekeeper ao tentar usá-lo, mesmo pagando por ele. Agora
  // o conjunto desejado é a UNIÃO (inclusos do plano + à la carte do checkout), e
  // qualquer módulo ativo que não esteja mais nesse conjunto (downgrade de plano/troca
  // de seleção) é desativado — reflete o "substitui tudo" já documentado acima para
  // `pendingModuleCodes`.
  const desiredModuleCodes = new Set<string>([...pending.plan.includedModules, ...pending.pendingModuleCodes]);

  await prismaUnscoped.$transaction(async (tx) => {
    await tx.subscription.update({
      where: { id: pendingSubscriptionId },
      data: {
        externalSubscriptionId,
        status: "ACTIVE",
        firstChargedAt: new Date(),
        currentPeriodEnd,
        pendingModuleCodes: [],
      },
    });
    for (const moduleCode of desiredModuleCodes) {
      await tx.tenantModule.upsert({
        where: { tenantId_moduleCode: { tenantId: pending.tenantId, moduleCode } },
        update: { active: true, deactivatedAt: null, stripeSubscriptionItemId: moduleItemIds[moduleCode] ?? null },
        create: { tenantId: pending.tenantId, moduleCode, active: true, stripeSubscriptionItemId: moduleItemIds[moduleCode] ?? null },
      });
    }
    const currentlyActive = await tx.tenantModule.findMany({
      where: { tenantId: pending.tenantId, active: true },
      select: { moduleCode: true },
    });
    const toDeactivate = currentlyActive.map((m) => m.moduleCode).filter((code) => !desiredModuleCodes.has(code));
    if (toDeactivate.length > 0) {
      await tx.tenantModule.updateMany({
        where: { tenantId: pending.tenantId, moduleCode: { in: toDeactivate } },
        data: { active: false, deactivatedAt: new Date() },
      });
    }
  });

  await invalidateTenantModuleCache(pending.tenantId);
  log.info(
    { tenantId: pending.tenantId, subscriptionId: pendingSubscriptionId, moduleCodes: [...desiredModuleCodes] },
    "assinatura ativada via checkout",
  );
  return { tenantId: pending.tenantId };
}

export const stripeWebhookRouter = Router();
export const asaasWebhookRouter = Router();

// CORREÇÃO DE AUDITORIA (fa-billing-webhook-idempotency-race): o dedup anterior
// usava `BillingEvent.create()` como a própria prova de "evento concluído" — duas
// entregas concorrentes do MESMO evento (normal em Stripe/Asaas: timeout de rede,
// retry automático do provedor) podiam resultar em uma delas recebendo 200
// "duplicate" enquanto a OUTRA ainda processava; se esta segunda falhasse depois,
// `releaseBillingEvent` apagava a linha e o provedor nunca mais reentregava aquele
// evento (ele já tinha recebido um 200 de alguém). Modelado agora como uma máquina
// de estados explícita com lease (ver `BillingEventStatus` no schema):
//   PROCESSING → reivindicado; lease com prazo de expiração.
//   SUCCEEDED  → só gravado DEPOIS que a transação de negócio correspondente commitou.
//   FAILED     → liberado para nova tentativa (reentrega do provedor).
// Duplicatas que chegam enquanto o estado é PROCESSING e a lease ainda não expirou
// recebem um erro não-2xx (o provedor reenvia depois) — nunca mais um 200
// "duplicate" prematuro que poderia descartar um evento ainda em voo.
const BILLING_EVENT_LEASE_MS = 2 * 60 * 1000; // 2 minutos — folga generosa acima do tempo real de processamento de qualquer handler deste arquivo

type BillingEventClaim =
  | { outcome: "claimed" }
  | { outcome: "duplicate-succeeded" }
  | { outcome: "duplicate-processing" };

async function claimBillingEvent(
  provider: string,
  externalEventKey: string,
  subscriptionId: string,
  type: string,
  payload: unknown,
): Promise<BillingEventClaim> {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + BILLING_EVENT_LEASE_MS);

  try {
    await prismaUnscoped.billingEvent.create({
      data: { provider, externalEventKey, subscriptionId, type, payload: payload as any, status: "PROCESSING", leaseExpiresAt },
    });
    return { outcome: "claimed" };
  } catch (err: any) {
    if (err.code !== "P2002") throw err;
  }

  // Já existe uma linha para esta chave de idempotência — decide com base no
  // estado atual, nunca tratando "já existe" como sinônimo de "já concluído".
  const existing = await prismaUnscoped.billingEvent.findUnique({
    where: { provider_externalEventKey: { provider, externalEventKey } },
  });
  if (!existing) {
    // Corrida rara: a linha sumiu entre o create falho e este findUnique (nunca
    // deveria acontecer, pois esta tabela nunca mais faz DELETE) — tenta reclamar
    // de novo recursivamente, uma única vez.
    return claimBillingEvent(provider, externalEventKey, subscriptionId, type, payload);
  }

  if (existing.status === "SUCCEEDED") {
    return { outcome: "duplicate-succeeded" };
  }

  if (existing.status === "PROCESSING" && existing.leaseExpiresAt > now) {
    // Outra requisição concorrente está processando ESTE MESMO evento agora — não é
    // seguro responder 200 "duplicate" (o evento pode não ter sido commitado nem
    // falhado ainda). Responde não-2xx para o provedor reentregar mais tarde.
    return { outcome: "duplicate-processing" };
  }

  // status FAILED, ou PROCESSING com lease expirada (o processo anterior morreu/
  // travou antes de concluir) — reclama atomicamente a linha antes de reprocessar.
  const reclaimed = await prismaUnscoped.billingEvent.updateMany({
    where: {
      provider,
      externalEventKey,
      OR: [{ status: "FAILED" }, { status: "PROCESSING", leaseExpiresAt: { lte: now } }],
    },
    data: { status: "PROCESSING", leaseExpiresAt, payload: payload as any, type },
  });
  if (reclaimed.count === 0) {
    // Perdeu a corrida para outra requisição que reclamou a lease primeiro.
    return { outcome: "duplicate-processing" };
  }
  return { outcome: "claimed" };
}

// Só chamado DEPOIS que a transação de negócio correspondente já commitou —
// nunca antes, para que um crash entre "transação commitada" e "marcar SUCCEEDED"
// no pior caso apenas force um reprocessamento (idempotente) na próxima
// reentrega, nunca perca o evento silenciosamente.
async function markBillingEventSucceeded(provider: string, externalEventKey: string) {
  await prismaUnscoped.billingEvent.updateMany({ where: { provider, externalEventKey }, data: { status: "SUCCEEDED" } });
}

// Libera a chave de idempotência (marcando FAILED, nunca apagando a linha) para
// que a reentrega do provedor seja reprocessada em vez de descartada como
// duplicata — preserva o histórico completo do evento para auditoria.
async function markBillingEventFailed(provider: string, externalEventKey: string) {
  await prismaUnscoped.billingEvent.updateMany({ where: { provider, externalEventKey }, data: { status: "FAILED" } }).catch(() => undefined);
}

// Resposta padronizada para qualquer falha de processamento de webhook (handler de
// negócio lançou exceção): nunca expõe `err.message` cru ao provedor (pode vazar
// stack trace/detalhes internos de infraestrutura em um endpoint sem autenticação
// de usuário) — a mensagem pública é sempre genérica, e o erro real vai para o
// logger estruturado com o contexto completo para investigação.
function webhookProcessingFailedResponse(res: Response, err: unknown, context: Record<string, unknown>): Response {
  log.error({ err, ...context }, "falha ao processar webhook de billing");
  return res.status(500).json({
    success: false,
    data: null,
    error: { code: "WEBHOOK_PROCESSING_FAILED", message: "Falha ao processar o evento de webhook. Será reprocessado." },
  });
}

function respondToBillingEventClaim(res: Response, claim: BillingEventClaim): Response | null {
  if (claim.outcome === "duplicate-succeeded") {
    return res.json({ received: true, duplicate: true });
  }
  if (claim.outcome === "duplicate-processing") {
    // Não-2xx deliberado: o provedor (Stripe/Asaas) reentrega webhooks que não
    // recebem 2xx — nunca respondemos 200 para um evento cujo processamento
    // concorrente ainda não terminou nem falhou.
    return res.status(409).json({
      success: false,
      data: null,
      error: { code: "EVENT_PROCESSING_IN_PROGRESS", message: "Este evento já está sendo processado por outra requisição." },
    });
  }
  return null; // "claimed" — segue para o processamento normal
}

stripeWebhookRouter.post("/webhooks/stripe", async (req: Request, res: Response) => {
  const signature = req.headers["stripe-signature"];
  const endpointSecret = await getPlatformSecret("STRIPE_WEBHOOK_SECRET");

  if (!signature || !endpointSecret) {
    return res.status(400).json({
      success: false,
      data: null,
      error: { code: "MISSING_SIGNATURE", message: "Assinatura do webhook ausente ou segredo não configurado." },
    });
  }

  const stripe = await getStripeClient();
  let event: import("stripe").Stripe.Event;
  try {
    // req.body aqui é o Buffer bruto (ver middleware express.raw em server.ts) —
    // obrigatório para a verificação HMAC funcionar; nunca o corpo já parseado em JSON.
    event = stripe.webhooks.constructEvent(req.body, signature, endpointSecret);
  } catch (err) {
    // Nunca expõe a mensagem crua da verificação HMAC (pode vazar detalhes internos
    // do SDK/segredo) — loga o erro real via logger estruturado e responde com uma
    // mensagem pública genérica, seguindo o envelope padrão do resto da API.
    log.warn({ err }, "assinatura de webhook Stripe inválida");
    return res.status(400).json({
      success: false,
      data: null,
      error: { code: "INVALID_SIGNATURE", message: "Assinatura do webhook inválida." },
    });
  }

  // Capítulo 9.3 — conclusão do Checkout hospedado: tratado ANTES do lookup genérico
  // por externalSubscriptionId abaixo porque a Subscription local ainda está com o id
  // interino `pending:<uuid>` neste momento (só este evento sabe o id real do Stripe).
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as import("stripe").Stripe.Checkout.Session;
    const pendingSubscriptionId = session.metadata?.pendingSubscriptionId;
    const realSubscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
    if (!pendingSubscriptionId || !realSubscriptionId) {
      return res.json({ received: true, ignored: "missing-checkout-metadata" });
    }

    const claim = await claimBillingEvent("stripe", event.id, pendingSubscriptionId, event.type, session);
    const claimResponse = respondToBillingEventClaim(res, claim);
    if (claimResponse) return claimResponse;

    try {
      const stripeSubscription = await stripe.subscriptions.retrieve(realSubscriptionId);
      const currentPeriodEnd = new Date(stripeSubscription.current_period_end * 1000);
      const moduleItemIds: Record<string, string> = {};
      for (const item of stripeSubscription.items.data) {
        const product = item.price.product;
        const productId = typeof product === "string" ? product : product.id;
        const fullProduct = await stripe.products.retrieve(productId);
        const moduleCode = fullProduct.metadata?.moduleCode;
        if (moduleCode && moduleCode !== "PLAN_BASE") moduleItemIds[moduleCode] = item.id;
      }
      await activatePendingSubscription(pendingSubscriptionId, realSubscriptionId, currentPeriodEnd, moduleItemIds);
      await markBillingEventSucceeded("stripe", event.id);
    } catch (err) {
      await markBillingEventFailed("stripe", event.id);
      return webhookProcessingFailedResponse(res, err, { provider: "stripe", eventType: event.type, eventId: event.id });
    }

    return res.json({ received: true });
  }

  // GAP DE AUDITORIA FECHADO (mega-audit rodada 9): `charge.refunded` e
  // `charge.dispute.created` não têm `subscription`/`id`-de-assinatura diretamente no
  // payload (o objeto é um Charge/Dispute, não uma Invoice/Subscription) — é preciso
  // resolver a invoice associada para achar a assinatura. Tratado ANTES do lookup
  // genérico abaixo, que nunca encontraria nada para esses dois tipos de evento.
  if (event.type === "charge.refunded" || event.type === "charge.dispute.created") {
    const chargeOrDisputeObject = event.data.object as { invoice?: string | null; charge?: string | null };
    let invoiceId = chargeOrDisputeObject.invoice ?? null;
    if (!invoiceId && chargeOrDisputeObject.charge) {
      const charge = await stripe.charges.retrieve(chargeOrDisputeObject.charge);
      invoiceId = typeof charge.invoice === "string" ? charge.invoice : charge.invoice?.id ?? null;
    }
    if (!invoiceId) {
      return res.json({ received: true, ignored: "no-invoice-reference" });
    }
    const invoice = await stripe.invoices.retrieve(invoiceId);
    const invoiceSubscriptionId = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;
    if (!invoiceSubscriptionId) {
      return res.json({ received: true, ignored: "invoice-not-subscription-billing" });
    }
    const reversedSubscription = await prismaUnscoped.subscription.findUnique({
      where: { externalSubscriptionId: invoiceSubscriptionId },
      select: { id: true, tenantId: true },
    });
    if (!reversedSubscription) {
      return res.json({ received: true, ignored: "unknown-subscription" });
    }
    const reversalClaim = await claimBillingEvent("stripe", event.id, reversedSubscription.id, event.type, event.data.object);
    const reversalClaimResponse = respondToBillingEventClaim(res, reversalClaim);
    if (reversalClaimResponse) return reversalClaimResponse;
    try {
      await handlePaymentReversed(
        reversedSubscription.tenantId,
        reversedSubscription.id,
        event.type === "charge.dispute.created" ? "CHARGEBACK" : "REFUNDED",
        new Date(event.created * 1000),
      );
      await markBillingEventSucceeded("stripe", event.id);
    } catch (err) {
      await markBillingEventFailed("stripe", event.id);
      return webhookProcessingFailedResponse(res, err, { provider: "stripe", eventType: event.type, eventId: event.id });
    }
    return res.json({ received: true });
  }

  const object = event.data.object as { subscription?: string; id?: string };
  const externalSubscriptionId = object.subscription ?? object.id;

  if (!externalSubscriptionId) {
    return res.json({ received: true, ignored: "no-subscription-reference" });
  }

  const subscription = await prismaUnscoped.subscription.findUnique({
    where: { externalSubscriptionId },
    select: { id: true, tenantId: true },
  });

  if (!subscription) {
    return res.json({ received: true, ignored: "unknown-subscription" });
  }

  const claim = await claimBillingEvent("stripe", event.id, subscription.id, event.type, event.data.object);
  const claimResponse = respondToBillingEventClaim(res, claim);
  if (claimResponse) return claimResponse;

  const eventAt = new Date(event.created * 1000);

  try {
    switch (event.type) {
      case "invoice.payment_failed":
        await handlePaymentFailure(subscription.tenantId, subscription.id, object.id, eventAt, req.requestId);
        break;
      case "invoice.paid":
        // Confirmação real de pagamento (fatura efetivamente paga) — a fonte
        // preferencial para reativar, nunca apenas o status estrutural da assinatura.
        await handlePaymentRecovered(subscription.tenantId, subscription.id, eventAt);
        break;
      case "customer.subscription.updated": {
        const subscriptionObject = event.data.object as import("stripe").Stripe.Subscription;
        const status = subscriptionObject.status;
        if (status === "active") {
          // CORREÇÃO DE AUDITORIA (fa-billing-outoforder-active-reactivation): o status
          // estrutural "active" do objeto Subscription do Stripe não é, por si só, uma
          // confirmação de pagamento — pode refletir um estado transitório ou chegar
          // fora de ordem (ex.: gerado ANTES de um estorno subsequente, mas entregue
          // DEPOIS pela fila do Stripe). Antes de reativar, confirma que a invoice mais
          // recente desta assinatura está de fato paga; `handlePaymentRecovered` ainda
          // aplica a checagem monotônica de `eventAt` contra `lastFinancialEventAt`
          // como segunda camada de defesa contra reentrega fora de ordem.
          const latestInvoiceId =
            typeof subscriptionObject.latest_invoice === "string"
              ? subscriptionObject.latest_invoice
              : subscriptionObject.latest_invoice?.id;
          const latestInvoice = latestInvoiceId ? await stripe.invoices.retrieve(latestInvoiceId) : null;
          if (latestInvoice?.status === "paid") {
            await handlePaymentRecovered(subscription.tenantId, subscription.id, eventAt);
          } else {
            log.warn(
              { subscriptionId: subscription.id, latestInvoiceStatus: latestInvoice?.status },
              "customer.subscription.updated reportou status active sem confirmação de pagamento da invoice mais recente — reativação adiada até invoice.paid",
            );
          }
        } else if (status === "past_due" || status === "incomplete" || status === "paused") {
          // CORREÇÃO DE AUDITORIA (fa-billing-stripe-pastdue-unhandled): até aqui,
          // past_due/incomplete/paused caíam no default sem nenhuma ação — o tenant só
          // entrava em PAST_DUE se `invoice.payment_failed` chegasse separadamente (sem
          // garantia de ordem/entrega). Agora qualquer um destes três status já aciona a
          // régua de dunning (grace period), mesmo que o evento de fatura nunca chegue.
          await handleSubscriptionPastDue(subscription.tenantId, subscription.id, eventAt);
        } else if (status === "canceled" || status === "unpaid" || status === "incomplete_expired") {
          // GAP DE AUDITORIA FECHADO: cancelamento/status terminal reportado pelo
          // Stripe suspende IMEDIATAMENTE, sem esperar grace period/varredura diária.
          await handleSubscriptionCanceled(subscription.tenantId, subscription.id, eventAt);
        }
        break;
      }
      case "customer.subscription.deleted":
        await handleSubscriptionCanceled(subscription.tenantId, subscription.id, eventAt);
        break;
      default:
        break; // evento reconhecido mas sem ação de billing mapeada
    }
    await markBillingEventSucceeded("stripe", event.id);
  } catch (err) {
    await markBillingEventFailed("stripe", event.id);
    return webhookProcessingFailedResponse(res, err, { provider: "stripe", eventType: event.type, eventId: event.id });
  }

  return res.json({ received: true });
});

asaasWebhookRouter.post("/webhooks/asaas", async (req: Request, res: Response) => {
  const receivedToken = req.headers["asaas-access-token"] as string | undefined;
  const expectedToken = (await getPlatformSecret("ASAAS_WEBHOOK_TOKEN")) ?? "";

  const receivedBuf = Buffer.from(receivedToken ?? "");
  const expectedBuf = Buffer.from(expectedToken);
  const isValid =
    receivedBuf.length === expectedBuf.length && expectedBuf.length > 0 && crypto.timingSafeEqual(receivedBuf, expectedBuf);

  if (!isValid) {
    return res.status(401).json({
      success: false,
      data: null,
      error: { code: "INVALID_WEBHOOK_TOKEN", message: "Token de webhook inválido ou ausente." },
    });
  }

  const {
    event: eventType,
    payment,
  } = req.body as { event: string; payment?: { subscription?: string; id: string; externalReference?: string; value?: number; nextDueDate?: string } };

  // CORREÇÃO DE AUDITORIA (fa-w5-sec-asaas-unsigned-body): o Asaas identifica cada
  // evento de forma única pela combinação `event` (tipo) + `payment.id` (cobrança
  // afetada) — não existe um `payment.id` genérico reaproveitado entre eventos
  // distintos, então esta combinação serve como chave de deduplicação. Checagem de
  // replay ANTES de qualquer consulta ao banco (defesa em profundidade sobre a
  // máquina de estados `BillingEvent` já existente abaixo, que continua sendo a
  // garantia real de idempotência de negócio) — um reenvio do mesmo evento (retry
  // legítimo do Asaas, ou replay manual de alguém de posse do token estático) é
  // apenas reconhecido com 200, sem tocar no banco.
  const asaasReplayGuardKey = payment?.id ? `asaas-webhook:${eventType}:${payment.id}` : null;
  if (asaasReplayGuardKey && (await wasWebhookEventAlreadyProcessed(asaasReplayGuardKey))) {
    return res.json({ received: true, duplicate: true });
  }

  if (!payment?.subscription) {
    // Sem referência de assinatura: pode ser uma cobrança avulsa de Boleto/Pix emitida
    // pelo lojista a um cliente dele (PaymentCharge, Capítulo 9), não billing SaaS.
    if (payment?.id && (eventType === "PAYMENT_RECEIVED" || eventType === "PAYMENT_CONFIRMED")) {
      const charge = await prismaUnscoped.paymentCharge.findFirst({ where: { externalProviderId: payment.id } });
      if (charge && charge.status !== "PAID") {
        // CORREÇÃO DE AUDITORIA (mega-audit rodada 7): antes, o `PaymentCharge` e o
        // `AccountReceivable` eram atualizados em duas chamadas independentes — se a
        // segunda falhasse, o erro era só logado e a rota MESMO ASSIM respondia 200
        // para o Asaas, o que faz o Asaas NUNCA reenviar o evento (webhooks só são
        // retransmitidos pelo Asaas em resposta não-2xx). O `PaymentCharge` ficava
        // PAID para sempre com o `AccountReceivable` correspondente desatualizado,
        // sem nenhuma chance de autocorreção. Agora ambas as atualizações acontecem
        // na MESMA transação (tudo ou nada) e, se falhar, a rota responde 500 —
        // deixando o próprio mecanismo de retry do Asaas reentregar o webhook depois.
        await prismaUnscoped.$transaction(async (tx) => {
          const claimed = await tx.paymentCharge.updateMany({
            where: { id: charge.id, status: { notIn: ["PAID", "CANCELLED"] } },
            data: { status: "PAID", paidAt: new Date() },
          });
          if (claimed.count > 0) {
            await tx.accountReceivable.updateMany({
              where: { id: charge.accountReceivableId, status: { notIn: ["PAID", "CANCELLED"] } },
              data: { status: "PAID", paidAt: new Date() },
            });
          }
        });
      }
    }
    if (asaasReplayGuardKey) await markWebhookEventProcessed(asaasReplayGuardKey);
    return res.json({ received: true, ignored: "no-subscription-reference" });
  }

  const subscription = await prismaUnscoped.subscription.findUnique({
    where: { externalSubscriptionId: payment.subscription },
    select: { id: true, tenantId: true },
  });

  if (!subscription) {
    // Capítulo 9.3 — conclusão do Checkout hospedado: a Subscription local ainda tem o
    // id interino `pending:<uuid>` (nunca igual a `payment.subscription`, o id real do
    // Asaas), então o lookup acima sempre falha neste primeiro evento — resolvemos pelo
    // `externalReference` que `checkout.routes.ts` grava como sendo o id LOCAL da
    // Subscription pendente (ver `createAsaasCheckout({ externalReference: ... })`).
    if (payment.externalReference && (eventType === "PAYMENT_RECEIVED" || eventType === "PAYMENT_CONFIRMED")) {
      const pendingClaim = await claimBillingEvent("asaas", `${eventType}:${payment.id}`, payment.externalReference, eventType, req.body);
      const pendingClaimResponse = respondToBillingEventClaim(res, pendingClaim);
      if (pendingClaimResponse) return pendingClaimResponse;
      try {
        const nextDueDate = payment.nextDueDate ? new Date(payment.nextDueDate) : null;
        const currentPeriodEnd = nextDueDate
          ? new Date(nextDueDate.getFullYear(), nextDueDate.getMonth() + 1, nextDueDate.getDate())
          : null;
        const activated = await activatePendingSubscription(payment.externalReference, payment.subscription!, currentPeriodEnd, {});
        if (!activated) {
          return res.json({ received: true, ignored: "unknown-pending-subscription" });
        }
        await markBillingEventSucceeded("asaas", `${eventType}:${payment.id}`);
        if (asaasReplayGuardKey) await markWebhookEventProcessed(asaasReplayGuardKey);
      } catch (err) {
        await markBillingEventFailed("asaas", `${eventType}:${payment.id}`);
        return webhookProcessingFailedResponse(res, err, { provider: "asaas", eventType, paymentId: payment.id });
      }
      return res.json({ received: true });
    }
    return res.json({ received: true, ignored: "unknown-subscription" });
  }

  const claim = await claimBillingEvent("asaas", `${eventType}:${payment.id}`, subscription.id, eventType, req.body);
  const claimResponse = respondToBillingEventClaim(res, claim);
  if (claimResponse) return claimResponse;

  // NOTA: o payload de webhook do Asaas não expõe um timestamp de evento granular
  // equivalente ao `event.created` do Stripe — usamos o instante de recebimento como
  // melhor aproximação disponível. A checagem monotônica em dunning.service.ts ainda
  // se aplica (nunca regride um estado mais recente), apenas com resolução menor que
  // a do Stripe para este provedor especificamente.
  const eventAt = new Date();

  try {
    switch (eventType) {
      case "PAYMENT_OVERDUE":
      case "PAYMENT_FAILED":
        await handlePaymentFailure(subscription.tenantId, subscription.id, payment.id, eventAt, req.requestId);
        break;
      case "PAYMENT_RECEIVED":
      case "PAYMENT_CONFIRMED":
        await handlePaymentRecovered(subscription.tenantId, subscription.id, eventAt);
        break;
      // GAP DE AUDITORIA FECHADO (mega-audit rodada 9): reembolso/chargeback do
      // Asaas não tinha tratamento algum — o tenant continuava ACTIVE mesmo com o
      // dinheiro já devolvido ao cliente.
      case "PAYMENT_REFUNDED":
        await handlePaymentReversed(subscription.tenantId, subscription.id, "REFUNDED", eventAt);
        break;
      case "PAYMENT_CHARGEBACK_REQUESTED":
      case "PAYMENT_CHARGEBACK_DISPUTE":
        await handlePaymentReversed(subscription.tenantId, subscription.id, "CHARGEBACK", eventAt);
        break;
      default:
        break;
    }
    await markBillingEventSucceeded("asaas", `${eventType}:${payment.id}`);
    if (asaasReplayGuardKey) await markWebhookEventProcessed(asaasReplayGuardKey);
  } catch (err) {
    await markBillingEventFailed("asaas", `${eventType}:${payment.id}`);
    return webhookProcessingFailedResponse(res, err, { provider: "asaas", eventType, paymentId: payment.id });
  }

  return res.json({ received: true });
});

// apps/api/src/modules/billing/webhooks.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 2.7/7.3/20.1 — processamento real de webhooks
// Stripe (assinatura HMAC via SDK oficial) e Asaas (authToken de 32+ chars, comparação
// de tempo constante), ambos convergindo para a régua de dunning única (Cap.2.7.4).
// Idempotência garantida pelo @@unique([provider, externalEventKey]) de BillingEvent —
// webhooks reentregues (comportamento normal de Stripe/Asaas) nunca reprocessam 2x.
import { Router, Request, Response } from "express";
import crypto from "node:crypto";
import { prismaUnscoped } from "@filitech/db";
import { getStripeClient } from "./stripe.client";
import { getPlatformSecret } from "../../lib/platform-secrets";
import { handlePaymentFailure, handlePaymentRecovered, handleSubscriptionCanceled } from "./dunning.service";
import { invalidateTenantModuleCache } from "../../middlewares/gatekeeper.middleware";
import { createModuleLogger } from "../../lib/logger";

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

async function recordBillingEventOnce(provider: string, externalEventKey: string, subscriptionId: string, type: string, payload: unknown) {
  try {
    await prismaUnscoped.billingEvent.create({
      data: { provider, externalEventKey, subscriptionId, type, payload: payload as any },
    });
    return true; // primeira vez que este evento é visto
  } catch (err: any) {
    if (err.code === "P2002") {
      return false; // já processado (reentrega do provedor) — ignora
    }
    throw err;
  }
}

// Se o processamento falhar, libera a chave de idempotência para que a reentrega do provedor seja reprocessada (e não descartada como duplicata).
async function releaseBillingEvent(provider: string, externalEventKey: string) {
  await prismaUnscoped.billingEvent.deleteMany({ where: { provider, externalEventKey } }).catch(() => undefined);
}

stripeWebhookRouter.post("/webhooks/stripe", async (req: Request, res: Response) => {
  const signature = req.headers["stripe-signature"];
  const endpointSecret = await getPlatformSecret("STRIPE_WEBHOOK_SECRET");

  if (!signature || !endpointSecret) {
    return res.status(400).json({ error: { code: "MISSING_SIGNATURE" } });
  }

  const stripe = await getStripeClient();
  let event: import("stripe").Stripe.Event;
  try {
    // req.body aqui é o Buffer bruto (ver middleware express.raw em server.ts) —
    // obrigatório para a verificação HMAC funcionar; nunca o corpo já parseado em JSON.
    event = stripe.webhooks.constructEvent(req.body, signature, endpointSecret);
  } catch (err) {
    return res.status(400).json({ error: { code: "INVALID_SIGNATURE", message: (err as Error).message } });
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

    const isNew = await recordBillingEventOnce("stripe", event.id, pendingSubscriptionId, event.type, session);
    if (!isNew) {
      return res.json({ received: true, duplicate: true });
    }

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
    } catch (err) {
      await releaseBillingEvent("stripe", event.id);
      return res.status(500).json({ error: { code: "WEBHOOK_PROCESSING_FAILED", message: (err as Error).message } });
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

  const isNew = await recordBillingEventOnce("stripe", event.id, subscription.id, event.type, event.data.object);
  if (!isNew) {
    return res.json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case "invoice.payment_failed":
        await handlePaymentFailure(subscription.tenantId, subscription.id, object.id);
        break;
      case "invoice.paid":
        await handlePaymentRecovered(subscription.tenantId, subscription.id);
        break;
      case "customer.subscription.updated": {
        const status = (event.data.object as { status?: string }).status;
        // Só recupera se o Stripe reporta a assinatura saudável — um update com status past_due/unpaid não pode reativar o tenant.
        if (status === "active") {
          await handlePaymentRecovered(subscription.tenantId, subscription.id);
        } else if (status === "canceled" || status === "unpaid" || status === "incomplete_expired") {
          // GAP DE AUDITORIA FECHADO: cancelamento/status terminal reportado pelo
          // Stripe suspende IMEDIATAMENTE, sem esperar grace period/varredura diária.
          await handleSubscriptionCanceled(subscription.tenantId, subscription.id);
        }
        break;
      }
      case "customer.subscription.deleted":
        await handleSubscriptionCanceled(subscription.tenantId, subscription.id);
        break;
      default:
        break; // evento reconhecido mas sem ação de billing mapeada
    }
  } catch (err) {
    await releaseBillingEvent("stripe", event.id);
    return res.status(500).json({ error: { code: "WEBHOOK_PROCESSING_FAILED", message: (err as Error).message } });
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
    return res.status(401).json({ error: { code: "INVALID_WEBHOOK_TOKEN" } });
  }

  const {
    event: eventType,
    payment,
  } = req.body as { event: string; payment?: { subscription?: string; id: string; externalReference?: string; value?: number; nextDueDate?: string } };

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
      const isNewPending = await recordBillingEventOnce("asaas", `${eventType}:${payment.id}`, payment.externalReference, eventType, req.body);
      if (!isNewPending) {
        return res.json({ received: true, duplicate: true });
      }
      try {
        const nextDueDate = payment.nextDueDate ? new Date(payment.nextDueDate) : null;
        const currentPeriodEnd = nextDueDate
          ? new Date(nextDueDate.getFullYear(), nextDueDate.getMonth() + 1, nextDueDate.getDate())
          : null;
        const activated = await activatePendingSubscription(payment.externalReference, payment.subscription!, currentPeriodEnd, {});
        if (!activated) {
          return res.json({ received: true, ignored: "unknown-pending-subscription" });
        }
      } catch (err) {
        await releaseBillingEvent("asaas", `${eventType}:${payment.id}`);
        return res.status(500).json({ error: { code: "WEBHOOK_PROCESSING_FAILED", message: (err as Error).message } });
      }
      return res.json({ received: true });
    }
    return res.json({ received: true, ignored: "unknown-subscription" });
  }

  const isNew = await recordBillingEventOnce("asaas", `${eventType}:${payment.id}`, subscription.id, eventType, req.body);
  if (!isNew) {
    return res.json({ received: true, duplicate: true });
  }

  try {
    switch (eventType) {
      case "PAYMENT_OVERDUE":
      case "PAYMENT_FAILED":
        await handlePaymentFailure(subscription.tenantId, subscription.id, payment.id);
        break;
      case "PAYMENT_RECEIVED":
      case "PAYMENT_CONFIRMED":
        await handlePaymentRecovered(subscription.tenantId, subscription.id);
        break;
      default:
        break;
    }
  } catch (err) {
    await releaseBillingEvent("asaas", `${eventType}:${payment.id}`);
    return res.status(500).json({ error: { code: "WEBHOOK_PROCESSING_FAILED", message: (err as Error).message } });
  }

  return res.json({ received: true });
});

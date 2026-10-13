// apps/api/src/modules/billing/webhooks.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 2.7/7.3/20.1 — processamento real de webhooks
// Stripe (assinatura HMAC via SDK oficial) e Asaas (authToken de 32+ chars, comparação
// de tempo constante), ambos convergindo para a régua de dunning única (Cap.2.7.4).
// Idempotência garantida pelo @@unique([provider, externalEventKey]) de BillingEvent —
// webhooks reentregues (comportamento normal de Stripe/Asaas) nunca reprocessam 2x.
import { Router, Request, Response } from "express";
import crypto from "node:crypto";
import { prismaUnscoped } from "@filitech/db";
import { stripe } from "./stripe.client";
import { handlePaymentFailure, handlePaymentRecovered } from "./dunning.service";

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
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !endpointSecret) {
    return res.status(400).json({ error: { code: "MISSING_SIGNATURE" } });
  }

  let event: import("stripe").Stripe.Event;
  try {
    // req.body aqui é o Buffer bruto (ver middleware express.raw em server.ts) —
    // obrigatório para a verificação HMAC funcionar; nunca o corpo já parseado em JSON.
    event = stripe.webhooks.constructEvent(req.body, signature, endpointSecret);
  } catch (err) {
    return res.status(400).json({ error: { code: "INVALID_SIGNATURE", message: (err as Error).message } });
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
        await handlePaymentFailure(subscription.tenantId, subscription.id);
        break;
      case "invoice.paid":
        await handlePaymentRecovered(subscription.tenantId, subscription.id);
        break;
      case "customer.subscription.updated":
        // Só recupera se o Stripe reporta a assinatura saudável — um update com status past_due/unpaid não pode reativar o tenant.
        if ((event.data.object as { status?: string }).status === "active") {
          await handlePaymentRecovered(subscription.tenantId, subscription.id);
        }
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
  const expectedToken = process.env.ASAAS_WEBHOOK_TOKEN ?? "";

  const receivedBuf = Buffer.from(receivedToken ?? "");
  const expectedBuf = Buffer.from(expectedToken);
  const isValid =
    receivedBuf.length === expectedBuf.length && expectedBuf.length > 0 && crypto.timingSafeEqual(receivedBuf, expectedBuf);

  if (!isValid) {
    return res.status(401).json({ error: { code: "INVALID_WEBHOOK_TOKEN" } });
  }

  const { event: eventType, payment } = req.body as { event: string; payment?: { subscription?: string; id: string } };

  if (!payment?.subscription) {
    return res.json({ received: true, ignored: "no-subscription-reference" });
  }

  const subscription = await prismaUnscoped.subscription.findUnique({
    where: { externalSubscriptionId: payment.subscription },
    select: { id: true, tenantId: true },
  });

  if (!subscription) {
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
        await handlePaymentFailure(subscription.tenantId, subscription.id);
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

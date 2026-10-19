// apps/api/tests/billing/billing-webhooks.test.ts
// GAP DE AUDITORIA FECHADO (fa-test-billing-webhook-missing): nenhum teste real
// existia para os webhooks de billing (Stripe/Asaas, webhooks.routes.ts) — a
// validação de assinatura HMAC, a idempotência via `BillingEvent` e a régua de
// dunning nunca tinham sido exercitadas. Suíte END-TO-END via `supertest` contra o
// app Express real (sem mock de Prisma/Stripe SDK): a verificação de assinatura
// Stripe usa o SDK oficial `stripe.webhooks.generateTestHeaderString` (gera uma
// assinatura HMAC-SHA256 REAL offline, sem chamada de rede) contra o mesmo segredo
// resolvido por `getPlatformSecret` (fallback de variável de ambiente, Capítulo
// 20.1) — garantindo que `constructEvent` execute a validação de verdade, nunca
// mockada.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import Stripe from "stripe";
import { prismaUnscoped } from "@filitech/db";
import { app } from "../../src/server";
import { invalidatePlatformSecretCache } from "../../src/lib/platform-secrets";

const STRIPE_WEBHOOK_SECRET = "whsec_test_canario_billing_webhook_0123456789";
const ASAAS_WEBHOOK_TOKEN = "asaas-token-canario-de-teste-32-chars-minimo-0123456789";

function uniqueSlug(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

describe("Webhooks de billing — assinatura, idempotência e replay (Stripe + Asaas)", () => {
  let tenantId: string;
  let planId: string;

  beforeAll(async () => {
    // Resolvido via env fallback de getPlatformSecret (nenhuma linha em
    // PlatformSecret é criada por esta suíte) — invalida o cache em memória para
    // garantir que o valor novo seja lido mesmo que outra suíte tenha rodado antes.
    process.env.STRIPE_WEBHOOK_SECRET = STRIPE_WEBHOOK_SECRET;
    process.env.ASAAS_WEBHOOK_TOKEN = ASAAS_WEBHOOK_TOKEN;
    invalidatePlatformSecretCache("STRIPE_WEBHOOK_SECRET");
    invalidatePlatformSecretCache("ASAAS_WEBHOOK_TOKEN");

    const tenant = await prismaUnscoped.tenant.create({
      data: {
        slug: uniqueSlug("billing-webhook"),
        legalName: "Canário Billing Webhook LTDA",
        tradeName: "Canário Billing Webhook",
        tenantType: "PERSONAL",
        status: "ACTIVE",
      },
    });
    tenantId = tenant.id;

    const plan = await prismaUnscoped.plan.upsert({
      where: { code: "TEST_PLAN_WEBHOOK_CANARIO" },
      update: {},
      create: { code: "TEST_PLAN_WEBHOOK_CANARIO", label: "Plano de Teste (canário webhook)", basePrice: 99, includedModules: [] },
    });
    planId = plan.id;
  });

  afterAll(async () => {
    await prismaUnscoped.billingEvent.deleteMany({ where: { subscription: { tenantId } } });
    await prismaUnscoped.subscription.deleteMany({ where: { tenantId } });
    await prismaUnscoped.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    await prismaUnscoped.$disconnect();
  });

  async function createActiveSubscription(externalSubscriptionId: string) {
    return prismaUnscoped.subscription.create({
      data: {
        tenantId,
        planId,
        provider: "stripe",
        externalSubscriptionId,
        status: "ACTIVE",
        failedPaymentAttempts: 0,
      },
    });
  }

  function signedStripeRequest(payloadObject: unknown) {
    const payload = JSON.stringify(payloadObject);
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: STRIPE_WEBHOOK_SECRET });
    return { payload, header };
  }

  describe("Stripe — assinatura HMAC real via SDK oficial", () => {
    it("assinatura VÁLIDA processa o evento e aplica o efeito de negócio esperado", async () => {
      const subscription = await createActiveSubscription(`sub_${uniqueSlug("valid")}`);
      const eventPayload = {
        id: `evt_${uniqueSlug("valid")}`,
        type: "invoice.payment_failed",
        data: { object: { subscription: subscription.externalSubscriptionId, id: `in_${uniqueSlug("invoice")}` } },
      };
      const { payload, header } = signedStripeRequest(eventPayload);

      const res = await request(app)
        .post("/webhooks/stripe")
        .set("Content-Type", "application/json")
        .set("stripe-signature", header)
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);

      const reloaded = await prismaUnscoped.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
      expect(reloaded.failedPaymentAttempts).toBe(1);
      expect(reloaded.status).toBe("PAST_DUE");

      const reloadedTenant = await prismaUnscoped.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      expect(reloadedTenant.status).toBe("PAST_DUE");
    });

    it("assinatura INVÁLIDA (forjada) rejeita com 400 e NÃO aplica nenhum efeito", async () => {
      const subscription = await createActiveSubscription(`sub_${uniqueSlug("invalidsig")}`);
      const eventPayload = {
        id: `evt_${uniqueSlug("invalidsig")}`,
        type: "invoice.payment_failed",
        data: { object: { subscription: subscription.externalSubscriptionId, id: "in_x" } },
      };
      const payload = JSON.stringify(eventPayload);

      const res = await request(app)
        .post("/webhooks/stripe")
        .set("Content-Type", "application/json")
        .set("stripe-signature", "t=1,v1=0000000000000000000000000000000000000000000000000000000000000000")
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_SIGNATURE");

      const reloaded = await prismaUnscoped.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
      expect(reloaded.failedPaymentAttempts).toBe(0);
      expect(reloaded.status).toBe("ACTIVE");
    });

    it("payload ADULTERADO depois de assinado (corpo != o que foi assinado) rejeita com 400", async () => {
      const subscription = await createActiveSubscription(`sub_${uniqueSlug("tampered")}`);
      const originalPayload = {
        id: `evt_${uniqueSlug("tampered")}`,
        type: "invoice.payment_failed",
        data: { object: { subscription: subscription.externalSubscriptionId, id: "in_original" } },
      };
      const { header } = signedStripeRequest(originalPayload);
      // Corpo realmente enviado é DIFERENTE do que gerou a assinatura — simula um
      // atacante reaproveitando um header de assinatura válido com um payload trocado.
      const tamperedPayload = JSON.stringify({ ...originalPayload, data: { object: { subscription: subscription.externalSubscriptionId, id: "in_ADULTERADO" } } });

      const res = await request(app)
        .post("/webhooks/stripe")
        .set("Content-Type", "application/json")
        .set("stripe-signature", header)
        .send(tamperedPayload);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_SIGNATURE");

      const reloaded = await prismaUnscoped.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
      expect(reloaded.failedPaymentAttempts).toBe(0);
    });

    it("evento DUPLICADO/reentregue (mesmo event.id) só aplica o efeito UMA vez", async () => {
      const subscription = await createActiveSubscription(`sub_${uniqueSlug("dup")}`);
      const eventPayload = {
        id: `evt_${uniqueSlug("dup")}`, // mesmo id nas duas entregas — comportamento real de retry do Stripe
        type: "invoice.payment_failed",
        data: { object: { subscription: subscription.externalSubscriptionId, id: "in_dup" } },
      };
      const { payload, header } = signedStripeRequest(eventPayload);

      const first = await request(app).post("/webhooks/stripe").set("Content-Type", "application/json").set("stripe-signature", header).send(payload);
      expect(first.status).toBe(200);
      expect(first.body.duplicate).toBeUndefined();

      const second = await request(app).post("/webhooks/stripe").set("Content-Type", "application/json").set("stripe-signature", header).send(payload);
      expect(second.status).toBe(200);
      expect(second.body.duplicate).toBe(true);

      const reloaded = await prismaUnscoped.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
      // Reentregue duas vezes, mas o contador de falhas só incrementou UMA vez.
      expect(reloaded.failedPaymentAttempts).toBe(1);

      const billingEvents = await prismaUnscoped.billingEvent.findMany({ where: { subscriptionId: subscription.id } });
      expect(billingEvents).toHaveLength(1);
    });

    it("eventos fora de ordem (recuperação processada antes da falha mais recente) não quebram o estado final", async () => {
      const subscription = await createActiveSubscription(`sub_${uniqueSlug("outoforder")}`);

      // Processa primeiro um evento de RECUPERAÇÃO (invoice.paid) mesmo sem ter
      // havido falha registrada ainda nesta suíte — simula o provedor entregando
      // eventos fora da ordem cronológica original.
      const recoveredEvent = { id: `evt_${uniqueSlug("recovered")}`, type: "invoice.paid", data: { object: { subscription: subscription.externalSubscriptionId, id: "in_recovered" } } };
      const recoveredRequest = signedStripeRequest(recoveredEvent);
      const recoveredRes = await request(app)
        .post("/webhooks/stripe")
        .set("Content-Type", "application/json")
        .set("stripe-signature", recoveredRequest.header)
        .send(recoveredRequest.payload);
      expect(recoveredRes.status).toBe(200);

      // Em seguida chega (fora de ordem) o evento de FALHA, com um event.id novo e
      // distinto — não é replay do mesmo evento, é um evento realmente diferente
      // entregue depois do que logicamente deveria ter vindo antes.
      const failedEvent = { id: `evt_${uniqueSlug("failed-after")}`, type: "invoice.payment_failed", data: { object: { subscription: subscription.externalSubscriptionId, id: "in_failed_after" } } };
      const failedRequest = signedStripeRequest(failedEvent);
      const failedRes = await request(app)
        .post("/webhooks/stripe")
        .set("Content-Type", "application/json")
        .set("stripe-signature", failedRequest.header)
        .send(failedRequest.payload);
      expect(failedRes.status).toBe(200);

      // O sistema nunca quebra (sem 500) e o estado final reflete corretamente o
      // ÚLTIMO evento processado (falha), sem exceção não tratada mesmo processando
      // fora da ordem cronológica.
      const reloaded = await prismaUnscoped.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
      expect(reloaded.status).toBe("PAST_DUE");
      expect(reloaded.failedPaymentAttempts).toBe(1);

      const billingEvents = await prismaUnscoped.billingEvent.findMany({ where: { subscriptionId: subscription.id } });
      expect(billingEvents).toHaveLength(2); // dois eventos distintos, ambos registrados
    });
  });

  describe("Asaas — token de webhook (comparação timing-safe)", () => {
    async function postAsaas(body: unknown, token: string | undefined) {
      const req = request(app).post("/webhooks/asaas");
      if (token !== undefined) req.set("asaas-access-token", token);
      return req.send(body as Record<string, unknown>);
    }

    it("token VÁLIDO processa o evento de pagamento recebido", async () => {
      const subscription = await createActiveSubscription(`asaas_sub_${uniqueSlug("valid")}`);
      await prismaUnscoped.subscription.update({ where: { id: subscription.id }, data: { status: "PAST_DUE", failedPaymentAttempts: 2 } });

      const res = await postAsaas(
        { event: "PAYMENT_RECEIVED", payment: { id: `pay_${uniqueSlug("x")}`, subscription: subscription.externalSubscriptionId } },
        ASAAS_WEBHOOK_TOKEN,
      );

      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);

      const reloaded = await prismaUnscoped.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
      expect(reloaded.status).toBe("ACTIVE");
      expect(reloaded.failedPaymentAttempts).toBe(0);
    });

    it("token INVÁLIDO/ausente rejeita com 401 e não altera nenhum estado", async () => {
      const subscription = await createActiveSubscription(`asaas_sub_${uniqueSlug("invalid")}`);

      const wrongToken = await postAsaas({ event: "PAYMENT_RECEIVED", payment: { id: "pay_1", subscription: subscription.externalSubscriptionId } }, "token-totalmente-errado");
      expect(wrongToken.status).toBe(401);

      const missingToken = await postAsaas({ event: "PAYMENT_RECEIVED", payment: { id: "pay_1", subscription: subscription.externalSubscriptionId } }, undefined);
      expect(missingToken.status).toBe(401);

      const reloaded = await prismaUnscoped.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
      expect(reloaded.status).toBe("ACTIVE"); // estado original preservado
    });

    it("evento DUPLICADO (mesmo eventType+payment.id) só aplica o efeito uma vez", async () => {
      const subscription = await createActiveSubscription(`asaas_sub_${uniqueSlug("dup")}`);
      const paymentId = `pay_${uniqueSlug("dup")}`;
      const body = { event: "PAYMENT_OVERDUE", payment: { id: paymentId, subscription: subscription.externalSubscriptionId } };

      const first = await postAsaas(body, ASAAS_WEBHOOK_TOKEN);
      expect(first.status).toBe(200);
      expect(first.body.duplicate).toBeUndefined();

      const second = await postAsaas(body, ASAAS_WEBHOOK_TOKEN);
      expect(second.status).toBe(200);
      expect(second.body.duplicate).toBe(true);

      const reloaded = await prismaUnscoped.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
      expect(reloaded.failedPaymentAttempts).toBe(1); // nunca 2
    });
  });
});

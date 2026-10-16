// apps/api/src/modules/billing/checkout.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 9.3 — contrato real de
// `POST /api/billing/checkout` (até a mega-audit rodada 5 esta rota não existia:
// a calculadora de assinatura dinâmica da landing nunca finalizava compra de
// verdade). Converte um tenant em TRIAL (sem nenhuma Subscription ainda — ver
// auth.routes.ts signup) na sua primeira contratação paga de plano+módulos, OU
// reabre uma tentativa anterior não concluída do mesmo tenant.
//
// NUNCA coleta dado de cartão diretamente: o pagamento é sempre feito na página
// hospedada do próprio PSP (Stripe Checkout Session / Asaas Checkout), que só
// confirma a contratação de fato via webhook (webhooks.routes.ts) — por isso a
// Subscription criada aqui nasce em status PENDING_CHECKOUT com um id interino
// (`pending:<uuid>`) em vez do id real do provedor, só promovido a ACTIVE quando
// o pagamento é efetivamente confirmado.
import { randomUUID } from "node:crypto";
import { Router, Request, Response } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";
import { hasManageSubscriptionPermission } from "./modules.routes";
import { findOrCreateStripeCustomer, createStripeCheckoutSession, StripeCheckoutLineItem } from "./stripe.client";
import { createAsaasCustomer, createAsaasCheckout } from "./asaas.client";
import { getPlatformSecret } from "../../lib/platform-secrets";
import { createModuleLogger } from "../../lib/logger";

// CORREÇÃO DE AUDITORIA (mega-audit round 7): distingue uma rejeição DEFINITIVA do
// provedor (ex.: cartão/parâmetro inválido, erro de autenticação — o provedor
// respondeu e disse "não") de um erro de REDE AMBÍGUO (timeout/conexão caída antes
// de qualquer resposta — o provedor pode ou não ter processado a requisição do
// nosso lado). Antes, QUALQUER erro aqui apagava a `Subscription` PENDING_CHECKOUT
// local e decrementava o cupom — no caso ambíguo, isso pode descartar prematuramente
// um registro local cujo checkout no provedor na verdade foi criado (mesmo que o
// cliente nunca tenha recebido a URL, por não ter havido resposta a tempo). Erros
// ambíguos NUNCA disparam a limpeza automática aqui — ficam para o job de varredura
// de `PENDING_CHECKOUT` expirado decidir com segurança (após confirmar, via
// reconsulta ao provedor quando aplicável, que nenhum pagamento foi de fato
// concluído).
function isDefiniteProviderRejection(gateway: "STRIPE" | "ASAAS", error: unknown): boolean {
  if (gateway === "STRIPE") {
    const stripeError = error as { type?: string; statusCode?: number } | undefined;
    // `StripeConnectionError`/ausência de `statusCode` = nunca chegou resposta do
    // Stripe (ambíguo). Qualquer outro `type` do SDK (StripeInvalidRequestError,
    // StripeCardError, StripeAPIError com statusCode, StripeAuthenticationError...)
    // significa que o Stripe respondeu de fato — rejeição definitiva.
    return typeof stripeError?.type === "string" && stripeError.type !== "StripeConnectionError" && typeof stripeError.statusCode === "number";
  }
  // Asaas: `asaasRequest()` só lança `Asaas API error (status): ...` quando a
  // resposta HTTP chegou com `!response.ok` — qualquer outro erro (fetch falhou,
  // timeout, DNS, etc.) nunca teve resposta e é tratado como ambíguo.
  return error instanceof Error && error.message.startsWith("Asaas API error (");
}

export const checkoutRouter = Router();

const log = createModuleLogger("billing-checkout");

const err = (res: Response, status: number, code: string, message: string) =>
  res.status(status).json({ success: false, data: null, error: { code, message } });

class AlreadySubscribedError extends Error {}

const checkoutSchema = z.object({
  planCode: z.string().min(1),
  selectedModuleCodes: z.array(z.string().min(1)).default([]),
  billingCycle: z.literal("MONTHLY").default("MONTHLY"),
  paymentGateway: z.enum(["STRIPE", "ASAAS"]),
  couponCode: z.string().min(1).optional(),
});

class InvalidCouponError extends Error {}

async function resolveAppBaseUrl(): Promise<string> {
  return (await getPlatformSecret("APP_BASE_URL")) ?? "https://app.filitecherp.com.br";
}

// POST /api/billing/checkout
checkoutRouter.post("/api/billing/checkout", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;

  if (!(await hasManageSubscriptionPermission(role, userId))) {
    return err(res, 403, "FORBIDDEN", "Seu nível de acesso não permite contratar/alterar a assinatura.");
  }

  const parsed = checkoutSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const input = parsed.data;

  const [tenant, owner, plan] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId } }),
    prisma.user.findFirst({ where: { tenantId, role: "OWNER" }, orderBy: { createdAt: "asc" } }),
    prisma.plan.findUnique({ where: { code: input.planCode } }),
  ]);
  if (!tenant) return err(res, 404, "NOT_FOUND", "Tenant não encontrado.");
  if (!owner) return err(res, 500, "OWNER_NOT_FOUND", "Nenhum usuário OWNER encontrado para este tenant.");
  if (!plan || !plan.active) return err(res, 404, "PLAN_NOT_FOUND", `Plano "${input.planCode}" não existe ou foi descontinuado.`);

  // GAP DE AUDITORIA FECHADO (Rodada 6) — a checagem de "já tem assinatura ativa"
  // rodava solta, antes da validação de módulos. Mantida aqui cedo (falha rápida),
  // mas a decisão definitiva de bloquear/prosseguir é refeita dentro da transação
  // abaixo, que é quem efetivamente serializa a concorrência.
  const existingActivePrecheck = await prisma.subscription.findFirst({
    where: { tenantId, status: { in: ["ACTIVE", "PAST_DUE"] } },
  });
  if (existingActivePrecheck) {
    return err(
      res,
      409,
      "ALREADY_SUBSCRIBED",
      "Este tenant já possui uma assinatura ativa — use a troca de plano/ativação de módulos em vez de um novo checkout.",
    );
  }

  const uniqueModuleCodes = Array.from(new Set(input.selectedModuleCodes));
  const modules = uniqueModuleCodes.length
    ? await prisma.module.findMany({ where: { code: { in: uniqueModuleCodes } } })
    : [];
  const foundCodes = new Set(modules.map((m) => m.code));
  const invalidCodes = uniqueModuleCodes.filter((c) => !foundCodes.has(c));
  if (invalidCodes.length > 0) {
    return err(res, 404, "MODULE_NOT_FOUND", `Módulo(s) inexistente(s): ${invalidCodes.join(", ")}.`);
  }
  const inactiveCodes = modules.filter((m) => !m.active).map((m) => m.code);
  if (inactiveCodes.length > 0) {
    return err(res, 409, "MODULE_DISCONTINUED", `Módulo(s) descontinuado(s): ${inactiveCodes.join(", ")}.`);
  }

  // Módulos já inclusos de graça no plano (Plan.includedModules) nunca entram como
  // linha de cobrança extra — só o que o lojista selecionou FORA do que já é incluso.
  const billableModules = modules.filter((m) => !plan.includedModules.includes(m.code));
  const breakdown = [
    { code: plan.code, label: `${plan.label} (base)`, price: Number(plan.basePrice) },
    ...billableModules.map((m) => ({ code: m.code, label: m.label, price: Number(m.monthlyPrice) })),
  ];
  const computedMrr = breakdown.reduce((sum, item) => sum + item.price, 0);

  // GAP DE AUDITORIA FECHADO: cupons eram cadastrados pelo painel admin
  // (marketing.routes.ts) mas NUNCA aplicados em nenhum fluxo de checkout —
  // o lojista nunca conseguia de fato usar um cupom, e `redemptionCount` nunca
  // era incrementado em lugar nenhum do código. Validação completa aqui:
  // existe/ativo, dentro da janela validFrom/validUntil, escopo bate com o
  // plano ou algum módulo selecionado (ou é GLOBAL), e ainda há saldo de
  // `maxRedemptions`. O desconto é aplicado SEMPRE sobre a linha base do plano
  // (nunca deixa o total ficar negativo) para funcionar identicamente nos dois
  // gateways sem depender de objetos de cupom específicos do Stripe/Asaas.
  let appliedCoupon: { id: string; code: string; discountAmount: number } | null = null;
  if (input.couponCode) {
    const coupon = await prisma.discountCoupon.findUnique({ where: { code: input.couponCode } });
    const now = new Date();
    const scopeMatches =
      coupon &&
      (coupon.scopeType === "GLOBAL" ||
        (coupon.scopeType === "PLAN" && coupon.scopeReferenceId === plan.id) ||
        (coupon.scopeType === "MODULE" && coupon.scopeReferenceId != null && billableModules.some((m) => m.id === coupon.scopeReferenceId)));
    if (
      !coupon ||
      !coupon.active ||
      !scopeMatches ||
      coupon.validFrom > now ||
      coupon.validUntil < now ||
      (coupon.maxRedemptions != null && coupon.redemptionCount >= coupon.maxRedemptions)
    ) {
      return err(res, 400, "INVALID_COUPON", "Cupom inválido, expirado, fora de escopo ou esgotado.");
    }
    const rawDiscount =
      coupon.discountType === "PERCENTAGE" ? (computedMrr * Number(coupon.discountValue)) / 100 : Number(coupon.discountValue);
    const discountAmount = Math.min(Math.round(rawDiscount * 100) / 100, computedMrr);
    appliedCoupon = { id: coupon.id, code: coupon.code, discountAmount };
  }
  const discountedBreakdown = appliedCoupon
    ? breakdown.map((item, index) =>
        index === 0 ? { ...item, price: Math.round((item.price - appliedCoupon!.discountAmount) * 100) / 100 } : item,
      )
    : breakdown;
  const finalMrr = Math.round((computedMrr - (appliedCoupon?.discountAmount ?? 0)) * 100) / 100;

  // GAP DE AUDITORIA FECHADO (Rodada 6) — a checagem de "já tem assinatura ativa" +
  // o descarte de tentativa anterior + a criação da nova linha PENDING_CHECKOUT
  // rodavam como 3 operações soltas: duas requisições concorrentes do mesmo tenant
  // (duplo clique, aba duplicada) podiam ambas passar pela checagem antes de
  // qualquer uma escrever, resultando em 2 linhas PENDING_CHECKOUT e 2 checkouts
  // abertos no provedor para o mesmo tenant. Serializable fatia o acesso: a segunda
  // transação concorrente recebe um erro de conflito (P2034) do Postgres, nunca
  // duas linhas vivas ao mesmo tempo.
  let pendingSubscription;
  try {
    pendingSubscription = await prisma.$transaction(
      async (tx) => {
        const existingActive = await tx.subscription.findFirst({
          where: { tenantId, status: { in: ["ACTIVE", "PAST_DUE"] } },
        });
        if (existingActive) {
          throw new AlreadySubscribedError();
        }

        // Reclama o saldo do cupom DENTRO da mesma transação serializable — nunca
        // duas contratações concorrentes com o mesmo cupom no limite (ex.: 1 uso
        // restante) podem ambas passar: a condição `redemptionCount < maxRedemptions`
        // (ou cupom ilimitado) é reavaliada atomicamente aqui, e `updateMany`
        // retorna `count: 0` se outra transação já consumiu o último uso.
        // Revalida o cupom DENTRO da transação serializable (leitura fresca) antes
        // de incrementar `redemptionCount` — se duas contratações concorrentes
        // disputarem o último uso de um cupom, o isolamento SERIALIZABLE do
        // Postgres detecta o conflito de escrita e aborta uma delas com P2034
        // (já tratado no catch abaixo como "CONCURRENT_CHECKOUT_CONFLICT"), nunca
        // deixando o cupom ser usado além do limite configurado.
        if (appliedCoupon) {
          const freshCoupon = await tx.discountCoupon.findUnique({ where: { id: appliedCoupon.id } });
          if (
            !freshCoupon ||
            !freshCoupon.active ||
            (freshCoupon.maxRedemptions != null && freshCoupon.redemptionCount >= freshCoupon.maxRedemptions)
          ) {
            throw new InvalidCouponError();
          }
          await tx.discountCoupon.update({ where: { id: appliedCoupon.id }, data: { redemptionCount: { increment: 1 } } });
        }

        // Descarta qualquer tentativa anterior não concluída deste tenant — nunca
        // acumula linhas órfãs em PENDING_CHECKOUT (o lojista pode mudar de ideia de
        // plano/módulos e tentar de novo quantas vezes quiser antes de efetivamente
        // pagar).
        // CORREÇÃO DE AUDITORIA (mega-audit rodada 7): o `deleteMany` abaixo apagava
        // tentativas anteriores SEM NUNCA devolver o saldo de um cupom que havia sido
        // resgatado por elas (`pendingCouponId`) — um lojista que aplicasse um cupom,
        // abandonasse o checkout e tentasse de novo consumia PERMANENTEMENTE um uso do
        // cupom por uma tentativa que nunca virou pagamento de verdade. Agora devolve
        // o saldo de cada cupom pendente órfão antes de apagar as linhas.
        const stalePending = await tx.subscription.findMany({
          where: { tenantId, status: "PENDING_CHECKOUT" },
          select: { id: true, pendingCouponId: true },
        });
        for (const stale of stalePending) {
          if (stale.pendingCouponId) {
            await tx.discountCoupon.update({ where: { id: stale.pendingCouponId }, data: { redemptionCount: { decrement: 1 } } }).catch(() => undefined);
          }
        }
        await tx.subscription.deleteMany({ where: { tenantId, status: "PENDING_CHECKOUT" } });

        return tx.subscription.create({
          data: {
            tenantId,
            planId: plan.id,
            provider: input.paymentGateway.toLowerCase(),
            externalSubscriptionId: `pending:${randomUUID()}`,
            status: "PENDING_CHECKOUT",
            pendingModuleCodes: billableModules.map((m) => m.code),
            pendingCouponId: appliedCoupon?.id ?? null,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (caughtErr) {
    if (caughtErr instanceof InvalidCouponError) {
      return err(res, 409, "COUPON_REDEMPTION_CONFLICT", "Este cupom acabou de atingir o limite de usos. Tente sem cupom ou contate o suporte.");
    }
    if (caughtErr instanceof AlreadySubscribedError) {
      return err(
        res,
        409,
        "ALREADY_SUBSCRIBED",
        "Este tenant já possui uma assinatura ativa — use a troca de plano/ativação de módulos em vez de um novo checkout.",
      );
    }
    if (caughtErr instanceof Prisma.PrismaClientKnownRequestError && caughtErr.code === "P2034") {
      return err(res, 409, "CONCURRENT_CHECKOUT_CONFLICT", "Outra solicitação de checkout para este tenant está em andamento. Tente novamente em instantes.");
    }
    throw caughtErr;
  }

  const appBaseUrl = await resolveAppBaseUrl();
  const successUrl = `${appBaseUrl}/billing/checkout/success?subscriptionId=${pendingSubscription.id}`;
  const cancelUrl = `${appBaseUrl}/billing/checkout/cancelled?subscriptionId=${pendingSubscription.id}`;

  try {
    let checkoutRedirectUrl: string;

    if (input.paymentGateway === "STRIPE") {
      const customerId = await findOrCreateStripeCustomer(tenant.stripeCustomerId, owner.email, tenant.tradeName);
      if (customerId !== tenant.stripeCustomerId) {
        await prisma.tenant.update({ where: { id: tenantId }, data: { stripeCustomerId: customerId } });
      }

      const items: StripeCheckoutLineItem[] = [
        { moduleCode: null, label: `${plan.label} (base)`, monthlyPriceBrl: discountedBreakdown[0].price },
        ...billableModules.map((m) => ({ moduleCode: m.code, label: m.label, monthlyPriceBrl: Number(m.monthlyPrice) })),
      ];

      const session = await createStripeCheckoutSession({
        customerId,
        items,
        successUrl,
        cancelUrl,
        metadata: { pendingSubscriptionId: pendingSubscription.id, tenantId, planCode: plan.code, couponCode: appliedCoupon?.code ?? "" },
        idempotencyKey: `checkout-session:${pendingSubscription.id}`,
      });
      if (!session.url) throw new Error("Stripe não retornou uma URL de checkout.");
      checkoutRedirectUrl = session.url;
    } else {
      let customerId = tenant.asaasCustomerId;
      if (!customerId) {
        const created = await createAsaasCustomer({
          name: tenant.legalName,
          cpfCnpj: tenant.cnpj ?? "",
          email: owner.email,
          externalReference: tenantId,
        });
        customerId = created.id;
        await prisma.tenant.update({ where: { id: tenantId }, data: { asaasCustomerId: customerId } });
      }

      const nextDueDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10); // D+1 — Asaas exige nextDueDate futura
      const checkout = await createAsaasCheckout({
        customer: customerId,
        items: discountedBreakdown.map((item) => ({ name: item.label, value: item.price })),
        totalValue: finalMrr,
        nextDueDate,
        successUrl,
        cancelUrl,
        expiredUrl: cancelUrl,
        externalReference: pendingSubscription.id,
      });
      checkoutRedirectUrl = checkout.link;
    }

    return res.status(201).json({
      success: true,
      data: {
        subscriptionId: pendingSubscription.id,
        computedMrr: finalMrr,
        breakdown: discountedBreakdown,
        couponApplied: appliedCoupon ? { code: appliedCoupon.code, discountAmount: appliedCoupon.discountAmount } : null,
        checkoutRedirectUrl,
      },
      error: null,
    });
  } catch (caughtErr) {
    const definiteRejection = isDefiniteProviderRejection(input.paymentGateway, caughtErr);
    if (definiteRejection) {
      // Rejeição definitiva (o provedor respondeu recusando): seguro apagar a linha
      // PENDING_CHECKOUT órfã e devolver o saldo do cupom, pois temos certeza de que
      // nenhum checkout de fato foi criado do lado do provedor.
      await prisma.subscription.delete({ where: { id: pendingSubscription.id } }).catch(() => undefined);
      if (appliedCoupon) {
        await prisma.discountCoupon.update({ where: { id: appliedCoupon.id }, data: { redemptionCount: { decrement: 1 } } }).catch(() => undefined);
      }
    } else {
      // Erro ambíguo (timeout/conexão caída antes de qualquer resposta do provedor):
      // NÃO apaga a Subscription nem devolve o cupom — o provedor pode ter processado
      // a requisição mesmo sem confirmar para nós. A linha PENDING_CHECKOUT permanece
      // e é resolvida com segurança depois por `expire-stale-pending-checkouts`
      // (expira automaticamente após 24h sem webhook de confirmação).
      log.warn(
        { tenantId, paymentGateway: input.paymentGateway, pendingSubscriptionId: pendingSubscription.id },
        "erro ambíguo ao criar checkout — mantendo PENDING_CHECKOUT para reconciliação posterior em vez de limpar imediatamente",
      );
    }
    log.error({ tenantId, paymentGateway: input.paymentGateway, definiteRejection, err: caughtErr }, "falha ao criar checkout de assinatura");
    return err(res, 502, "CHECKOUT_PROVIDER_ERROR", "Não foi possível iniciar o checkout com o provedor de pagamento. Tente novamente em instantes.");
  }
});

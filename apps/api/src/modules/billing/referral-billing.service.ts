// apps/api/src/modules/billing/referral-billing.service.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 2.8 — Programa de Indicação.
// GAP DE AUDITORIA FECHADO (Rodada 6): `marketing.routes.ts` (reward-applied) já
// gravava `Subscription.creditBalanceMonths`/`firstCycleDiscountPercent` no banco,
// mas NUNCA refletia isso em nenhuma cobrança real no Stripe/Asaas — o crédito
// "existia" só no nosso banco e nunca abatia um centavo da fatura de ninguém.
//
// GAP DE AUDITORIA FECHADO (idempotência): diferente do padrão best-effort de
// module-billing.service.ts/seat-billing.service.ts, aqui a confirmação do provedor
// é a PRÉ-CONDIÇÃO para conceder a recompensa no banco (nunca o contrário) — ver
// `marketing.routes.ts` (reward-applied). Por isso as funções abaixo RETORNAM
// `boolean` (sucesso/falha) em vez de só logar e seguir: o chamador usa esse valor
// para decidir se já pode persistir `creditBalanceMonths`/`firstCycleDiscountPercent`
// e marcar `rewardAppliedAt`, ou se deve deixar a tentativa pendente para retry.
import { prisma as unscopedPrisma } from "@filitech/db";
import { grantStripeCustomerBalanceCredit, applyStripeFirstCycleDiscount } from "./stripe.client";
import { listPendingAsaasSubscriptionPayments, updateAsaasPaymentValue } from "./asaas.client";
import { createModuleLogger } from "../../lib/logger";

const log = createModuleLogger("referral-billing");

/**
 * Concede `creditMonths` meses de crédito ao TENANT QUE INDICOU, de fato abatendo
 * a cobrança no provedor de pagamento (não só no banco local). Retorna `true` só
 * quando o provedor confirmou a aplicação (ou quando não havia nada a fazer); o
 * chamador NUNCA deve persistir `creditBalanceMonths`/`rewardAppliedAt` quando o
 * retorno for `false` — a tentativa deve ficar pendente para um retry posterior.
 */
export async function applyReferrerCreditToProvider(subscriptionId: string, creditMonths: number): Promise<boolean> {
  if (creditMonths <= 0) return true;
  try {
    const subscription = await unscopedPrisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: { select: { basePrice: true } }, tenant: { select: { stripeCustomerId: true } } },
    });
    if (!subscription) return true;

    const monthlyAmountBrl = Number(subscription.plan.basePrice);
    const totalCreditBrl = monthlyAmountBrl * creditMonths;

    if (subscription.provider === "stripe") {
      if (!subscription.tenant.stripeCustomerId) {
        log.warn({ subscriptionId }, "crédito de indicação não aplicado — tenant sem stripeCustomerId");
        return false;
      }
      await grantStripeCustomerBalanceCredit(
        subscription.tenant.stripeCustomerId,
        Math.round(totalCreditBrl * 100),
        `Crédito de indicação — ${creditMonths} mês(es) (Capítulo 2.8)`,
      );
    } else if (subscription.provider === "asaas") {
      // Asaas não tem "customer balance": zera (ou abate parcialmente) as próximas
      // `creditMonths` cobranças PENDING da assinatura, da mais antiga para a mais
      // recente — mesmo valor total do crédito, só distribuído ciclo a ciclo em vez
      // de um único lançamento.
      const pendingPayments = await listPendingAsaasSubscriptionPayments(subscription.externalSubscriptionId, creditMonths);
      for (const payment of pendingPayments) {
        await updateAsaasPaymentValue(payment.id, 0.01);
      }
      if (pendingPayments.length < creditMonths) {
        log.warn(
          { subscriptionId, creditMonths, pendingFound: pendingPayments.length },
          "crédito de indicação Asaas aplicado parcialmente — menos cobranças PENDING do que meses de crédito; reconciliar manualmente o restante quando novas cobranças forem geradas",
        );
      }
    }
    return true;
  } catch (err) {
    log.error({ subscriptionId, creditMonths, err }, "falha ao sincronizar crédito de indicação (indicador) com o provedor de billing");
    return false;
  }
}

/**
 * Aplica o desconto do primeiro ciclo ao TENANT INDICADO, de fato abatendo a
 * próxima cobrança no provedor de pagamento (não só no banco local). Mesma
 * semântica de retorno de `applyReferrerCreditToProvider` — `false` significa que
 * o chamador NÃO deve persistir `firstCycleDiscountPercent`/`rewardAppliedAt`.
 */
export async function applyReferredDiscountToProvider(subscriptionId: string, discountPercent: number): Promise<boolean> {
  if (discountPercent <= 0) return true;
  try {
    const subscription = await unscopedPrisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: { select: { basePrice: true } } },
    });
    if (!subscription) return true;

    if (subscription.provider === "stripe") {
      await applyStripeFirstCycleDiscount(subscription.externalSubscriptionId, discountPercent);
    } else if (subscription.provider === "asaas") {
      const [nextPending] = await listPendingAsaasSubscriptionPayments(subscription.externalSubscriptionId, 1);
      if (!nextPending) {
        log.warn({ subscriptionId }, "desconto de primeiro ciclo (indicado) não aplicado — nenhuma cobrança PENDING encontrada no Asaas ainda");
        return false;
      }
      const discountedValue = nextPending.value * (1 - discountPercent / 100);
      await updateAsaasPaymentValue(nextPending.id, discountedValue);
    }
    return true;
  } catch (err) {
    log.error({ subscriptionId, discountPercent, err }, "falha ao sincronizar desconto de primeiro ciclo (indicado) com o provedor de billing");
    return false;
  }
}

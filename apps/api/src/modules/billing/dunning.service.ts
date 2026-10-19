// apps/api/src/modules/billing/dunning.service.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 2.7.4 — Régua de Dunning unificada Stripe/Asaas.
import { prismaUnscoped, Prisma } from "@filitech/db";
import { notifyTenantPaymentFailed, notifyTenant } from "../notifications/notify.service";
import { createModuleLogger } from "../../lib/logger";

const log = createModuleLogger("dunning-service");

const RETRY_SCHEDULE_DAYS = [1, 3, 5, 7]; // mesma cadência do Stripe Smart Retries

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

// CORREÇÃO DE AUDITORIA (fa-billing-outoforder-active-reactivation): todo handler de
// evento financeiro recebe agora `eventAt` — o timestamp do EVENTO no provedor
// (Stripe `event.created`, convertido para Date; Asaas não expõe um timestamp de
// evento tão granular, então o chamador usa a melhor aproximação disponível, nunca
// `new Date()` do instante em que NÓS recebemos o webhook). Eventos atrasados
// (reentrega, fila do provedor, retry) que chegam DEPOIS de um evento
// cronologicamente mais novo já aplicado são ignorados aqui — nunca revertem um
// estado mais recente só porque chegaram por último na nossa fila. Esta função é
// chamada de DENTRO de uma transação já aberta (tx) para que a checagem e a
// atualização de `lastFinancialEventAt` sejam atômicas com o resto da mudança de
// estado: devolve `false` (e o chamador deve abortar a mudança de estado) quando o
// evento é mais velho que o último já aplicado.
async function claimEventOrdering(tx: Prisma.TransactionClient, subscriptionId: string, eventAt: Date): Promise<boolean> {
  const current = await tx.subscription.findUnique({ where: { id: subscriptionId }, select: { lastFinancialEventAt: true } });
  if (current?.lastFinancialEventAt && current.lastFinancialEventAt > eventAt) {
    return false; // evento fora de ordem — ignorado, nunca aplicado por cima de um estado mais novo
  }
  await tx.subscription.update({ where: { id: subscriptionId }, data: { lastFinancialEventAt: eventAt } });
  return true;
}

export async function handlePaymentFailure(
  tenantId: string,
  subscriptionId: string,
  externalPaymentId?: string,
  eventAt: Date = new Date(),
) {
  // CORREÇÃO DE AUDITORIA (fa-dunning-notification-inside-transaction): a notificação
  // (e-mail/push/WhatsApp, I/O externo real) era disparada DE DENTRO do callback do
  // `$transaction`, prolongando os locks de linha abertos pelos updates acima pela
  // latência inteira do provedor de notificação, e — pior — uma falha de rede no
  // envio da notificação propagava como exceção e fazia a transação INTEIRA (que já
  // havia persistido o estado financeiro real: PAST_DUE, tentativas, grace period)
  // dar rollback por um motivo que não tem nada a ver com a integridade do billing.
  // Agora a transação só persiste o estado + os dados necessários para notificar, e
  // a notificação é entregue DEPOIS do commit, fora de qualquer lock — uma falha no
  // envio nunca desfaz o estado financeiro já gravado.
  const result = await prismaUnscoped.$transaction(async (tx) => {
    const ordered = await claimEventOrdering(tx, subscriptionId, eventAt);
    if (!ordered) {
      return { skipped: "out-of-order" as const };
    }

    const current = await tx.subscription.findUnique({
      where: { id: subscriptionId },
      select: { lastFailedPaymentExternalId: true },
    });
    // CORREÇÃO DE AUDITORIA (mega-audit rodada 7): se o chamador souber o ID do
    // pagamento externo que falhou (Asaas payment.id / Stripe invoice id) e for
    // EXATAMENTE o mesmo da última falha já contabilizada, isto é um evento
    // semanticamente duplicado do provedor (ex.: Asaas PAYMENT_OVERDUE seguido de
    // PAYMENT_FAILED para o mesmo pagamento) — não incrementa de novo.
    if (externalPaymentId && current?.lastFailedPaymentExternalId === externalPaymentId) {
      return { skipped: "duplicate-payment" as const };
    }

    const subscription = await tx.subscription.update({
      where: { id: subscriptionId },
      data: {
        failedPaymentAttempts: { increment: 1 },
        lastFailedPaymentExternalId: externalPaymentId ?? undefined,
      },
    });

    const attempt = subscription.failedPaymentAttempts;
    const retryInDays = RETRY_SCHEDULE_DAYS[Math.min(attempt - 1, RETRY_SCHEDULE_DAYS.length - 1)];
    const nextRetryAt = addDays(new Date(), retryInDays);

    await tx.subscription.update({ where: { id: subscriptionId }, data: { nextRetryAt, status: "PAST_DUE" } });

    await tx.tenant.update({
      where: { id: tenantId },
      data: { status: "PAST_DUE", gracePeriodEndsAt: attempt === 1 ? addDays(new Date(), 7) : undefined },
    });

    if (attempt >= RETRY_SCHEDULE_DAYS.length) {
      await tx.subscription.update({ where: { id: subscriptionId }, data: { status: "SUSPENDED" } });
      await tx.tenant.update({ where: { id: tenantId }, data: { status: "SUSPENDED" } });
    }

    return { skipped: null as null, attempt, nextRetryAt };
  });

  if (result.skipped) {
    return result;
  }

  // Entrega da notificação FORA da transação já commitada — nunca bloqueia nem
  // reverte o estado financeiro já persistido acima.
  try {
    await notifyTenantPaymentFailed(tenantId, { attempt: result.attempt!, nextRetryAt: result.nextRetryAt! });
  } catch (err) {
    log.error({ tenantId, subscriptionId, err }, "falha ao entregar notificação de falha de pagamento (estado financeiro já commitado)");
  }

  return result;
}

// GAP DE AUDITORIA FECHADO: eventos de cancelamento definitivo da assinatura no
// provedor (ex.: Stripe `customer.subscription.deleted`, ou `updated` com status
// "canceled"/"unpaid"/"incomplete_expired") só eram refletidos no Filitech pela
// varredura diária de `suspend-overdue-tenants.worker.ts` (até 24h de atraso) ou
// nunca, se o tenant nunca chegasse a `PAST_DUE` internamente (ex.: cancelamento
// voluntário direto no portal do Stripe, sem nenhuma fatura ter falhado antes).
// Diferente de `handlePaymentFailure` (que ainda dá o grace period padrão), aqui
// o provedor já decidiu definitivamente que a assinatura acabou — suspende
// imediatamente, sem esperar o grace period nem a varredura diária.
export async function handleSubscriptionCanceled(tenantId: string, subscriptionId: string, eventAt: Date = new Date()) {
  const applied = await prismaUnscoped.$transaction(async (tx) => {
    const ordered = await claimEventOrdering(tx, subscriptionId, eventAt);
    if (!ordered) return false;
    await tx.subscription.update({ where: { id: subscriptionId }, data: { status: "SUSPENDED" } });
    await tx.tenant.update({ where: { id: tenantId }, data: { status: "SUSPENDED", gracePeriodEndsAt: null } });
    return true;
  });
  if (!applied) return;
  await notifyTenant({
    tenantId,
    category: "BILLING_DUNNING",
    severity: "CRITICAL",
    title: "Assinatura cancelada",
    body: "Sua assinatura foi cancelada junto ao provedor de pagamento e o acesso ao sistema foi suspenso. Reative o plano para continuar usando o Filitech ERP.",
    linkRoute: "/configuracoes/cobranca",
    sourceType: "SUBSCRIPTION",
    sourceId: tenantId,
  });
}

// CORREÇÃO DE AUDITORIA (fa-billing-stripe-pastdue-unhandled): `customer.subscription.updated`
// com status "past_due"/"incomplete"/"paused" caía no `default` do switch em
// webhooks.routes.ts e não transicionava o tenant nenhuma, confiando inteiramente
// em `invoice.payment_failed` chegar separadamente (o que nem sempre acontece na
// mesma ordem/garantia de entrega). Diferente de `handlePaymentFailure`, este
// handler NUNCA incrementa `failedPaymentAttempts` (isso já é feito por
// `invoice.payment_failed`/PAYMENT_OVERDUE) — apenas garante que o tenant entre em
// PAST_DUE com grace period, mesmo que o evento de fatura correspondente nunca
// chegue ou chegue fora de ordem.
export async function handleSubscriptionPastDue(tenantId: string, subscriptionId: string, eventAt: Date = new Date()) {
  await prismaUnscoped.$transaction(async (tx) => {
    const ordered = await claimEventOrdering(tx, subscriptionId, eventAt);
    if (!ordered) return;

    const subscription = await tx.subscription.findUnique({ where: { id: subscriptionId }, select: { status: true } });
    // Nunca rebaixa uma assinatura já SUSPENDED/CANCELLED de volta para PAST_DUE —
    // "past_due" é estritamente menos severo; se o provedor já reportou algo pior
    // (ou se já convergimos para SUSPENDED via `handlePaymentFailure`), não regride.
    if (!subscription || subscription.status === "SUSPENDED" || subscription.status === "CANCELLED") {
      return;
    }

    const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { gracePeriodEndsAt: true } });
    await tx.subscription.update({ where: { id: subscriptionId }, data: { status: "PAST_DUE" } });
    await tx.tenant.update({
      where: { id: tenantId },
      data: {
        status: "PAST_DUE",
        // Preserva um grace period já em andamento (ex.: já aberto por
        // `handlePaymentFailure`) — só abre um novo de 7 dias se nenhum existir.
        gracePeriodEndsAt: tenant?.gracePeriodEndsAt ?? addDays(new Date(), 7),
      },
    });
  });
}

// GAP DE AUDITORIA FECHADO (mega-audit rodada 9, ALTO): não existia tratamento
// algum para reembolso/estorno/chargeback reportado pelo provedor DEPOIS que o
// pagamento já havia sido confirmado (ex.: Stripe `charge.refunded` ou
// `charge.dispute.created`; Asaas `PAYMENT_REFUNDED`/`PAYMENT_CHARGEBACK_REQUESTED`).
// Sem isto, o dinheiro podia voltar para o cliente enquanto o tenant permanecia
// ACTIVE e com todos os módulos liberados — a Filitech ficaria prestando serviço
// de graça (ou pior, financiando o próprio calote) indefinidamente, pois nenhuma
// rotina de varredura cobre esse caso (ele não é "atraso de pagamento", é
// reversão de um pagamento já dado como recebido). Suspende imediatamente, assim
// como cancelamento definitivo — o lojista precisa regularizar com um novo
// pagamento para reativar.
export async function handlePaymentReversed(
  tenantId: string,
  subscriptionId: string,
  reason: "REFUNDED" | "CHARGEBACK",
  eventAt: Date = new Date(),
) {
  const applied = await prismaUnscoped.$transaction(async (tx) => {
    // CORREÇÃO DE AUDITORIA (fa-billing-outoforder-active-reactivation): uma reversão
    // é, por definição, o evento financeiro mais crítico/definitivo possível — sempre
    // reivindicamos o timestamp mais recente para ela (mesmo que um evento "mais
    // novo" já tenha sido aplicado) precisamente para que qualquer `active`
    // fora-de-ordem que chegue DEPOIS nunca consiga reverter esta suspensão (ver
    // checagem em `handlePaymentRecovered` abaixo, que exige `eventAt` estritamente
    // mais novo que `lastFinancialEventAt`).
    await tx.subscription.update({ where: { id: subscriptionId }, data: { lastFinancialEventAt: eventAt } });
    await tx.subscription.update({ where: { id: subscriptionId }, data: { status: "SUSPENDED" } });
    await tx.tenant.update({ where: { id: tenantId }, data: { status: "SUSPENDED", gracePeriodEndsAt: null } });
    return true;
  });
  if (!applied) return;
  await notifyTenant({
    tenantId,
    category: "BILLING_DUNNING",
    severity: "CRITICAL",
    title: reason === "CHARGEBACK" ? "Cobrança contestada (chargeback)" : "Pagamento estornado",
    body:
      reason === "CHARGEBACK"
        ? "O pagamento da sua assinatura foi contestado junto à operadora do cartão e o acesso ao sistema foi suspenso. Entre em contato com o suporte para regularizar."
        : "O pagamento da sua assinatura foi estornado e o acesso ao sistema foi suspenso. Realize um novo pagamento para reativar.",
    linkRoute: "/configuracoes/cobranca",
    sourceType: "SUBSCRIPTION",
    sourceId: tenantId,
  });
}

// CORREÇÃO DE AUDITORIA (fa-billing-outoforder-active-reactivation): reativar o
// tenant é a transição de MAIOR risco financeiro deste arquivo — um
// `customer.subscription.updated` com status "active" que chegue fora de ordem
// DEPOIS de uma reversão (`charge.refunded`/`charge.dispute.created`) já aplicada
// não pode reverter a suspensão só porque chegou por último na fila. Por isso,
// diferente dos outros handlers, aqui a comparação exige `eventAt` ESTRITAMENTE
// mais novo que `lastFinancialEventAt` (nunca `>=`) — um evento "active" com o
// MESMO instante ou mais antigo que uma reversão já processada é ignorado. A
// confirmação de que existe um pagamento de fato recebido (não apenas um status
// estrutural "active" do objeto Subscription do provedor) é responsabilidade do
// CHAMADOR (ver webhooks.routes.ts: só invoca isto a partir de `invoice.paid` —
// confirmação real de pagamento — ou de `customer.subscription.updated` após
// verificar a última invoice como paga).
export async function handlePaymentRecovered(tenantId: string, subscriptionId: string, eventAt: Date = new Date()) {
  const applied = await prismaUnscoped.$transaction(async (tx) => {
    const current = await tx.subscription.findUnique({
      where: { id: subscriptionId },
      select: { firstChargedAt: true, lastFinancialEventAt: true },
    });
    if (current?.lastFinancialEventAt && current.lastFinancialEventAt >= eventAt) {
      // Evento de recuperação é mais velho (ou do mesmo instante) que o último
      // evento financeiro já aplicado (possivelmente uma reversão/cancelamento
      // posterior) — nunca reativa por cima de um estado mais recente.
      return false;
    }
    await tx.subscription.update({
      where: { id: subscriptionId },
      data: {
        lastFinancialEventAt: eventAt,
        failedPaymentAttempts: 0,
        nextRetryAt: null,
        status: "ACTIVE",
        // Primeira cobrança bem-sucedida desta assinatura — base da janela de
        // arrependimento do Art. 49 CDC (Capítulo 2.7.6). Nunca sobrescrita depois.
        firstChargedAt: current?.firstChargedAt ?? new Date(),
      },
    });
    await tx.tenant.update({ where: { id: tenantId }, data: { status: "ACTIVE", gracePeriodEndsAt: null } });
    return true;
  });
  return applied;
}

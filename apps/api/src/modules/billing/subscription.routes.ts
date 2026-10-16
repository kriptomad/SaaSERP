// apps/api/src/modules/billing/subscription.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 2.7.6 — autoatendimento de cancelamento de
// assinatura (Art. 49 CDC: direito de arrependimento em até 7 dias corridos da
// primeira cobrança, com reembolso integral e cancelamento imediato; fora dessa
// janela, cancelamento é sempre agendado para o fim do ciclo vigente, nunca imediato,
// para não cortar acesso de um período já pago).
import { Router, Request, Response } from "express";
import { prisma, prismaUnscoped } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";
import { hasManageSubscriptionPermission } from "./modules.routes";
import { cancelStripeSubscription, refundLatestStripeInvoice, undoStripeScheduledCancellation } from "./stripe.client";
import { cancelAsaasSubscription, refundAsaasPayment } from "./asaas.client";

export const subscriptionRouter = Router();

const REGRET_WINDOW_DAYS = 7;

const err = (res: Response, status: number, code: string, message: string) =>
  res.status(status).json({ success: false, data: null, error: { code, message } });

function withinRegretWindow(firstChargedAt: Date | null): boolean {
  if (!firstChargedAt) return false;
  const elapsedMs = Date.now() - firstChargedAt.getTime();
  return elapsedMs <= REGRET_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

// Extrai o id do pagamento mais recente registrado pelos webhooks, usado para o
// reembolso Asaas (o payload bruto do evento PAYMENT_CONFIRMED/PAYMENT_RECEIVED traz
// `payment.id`, nunca persistido em coluna própria — só dentro do Json do BillingEvent).
async function findLatestAsaasPaymentId(subscriptionId: string): Promise<string | null> {
  const event = await prismaUnscoped.billingEvent.findFirst({
    where: { subscriptionId, provider: "asaas", type: { in: ["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"] } },
    orderBy: { createdAt: "desc" },
  });
  const payload = event?.payload as { payment?: { id?: string } } | undefined;
  return payload?.payment?.id ?? null;
}

// GET /billing/subscription — estado atual para a tela de autoatendimento do lojista.
subscriptionRouter.get("/billing/subscription", requireAuth, async (req: Request, res: Response) => {
  const { tenantId } = req.session!;
  const subscription = await prisma.subscription.findFirst({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    include: { plan: { select: { code: true, label: true, basePrice: true } } },
  });
  if (!subscription) return err(res, 404, "NOT_FOUND", "Nenhuma assinatura encontrada para este tenant.");

  return res.json({
    success: true,
    data: {
      ...subscription,
      inRegretWindow: withinRegretWindow(subscription.firstChargedAt),
      regretWindowDays: REGRET_WINDOW_DAYS,
    },
    error: null,
  });
});

// POST /billing/subscription/cancel
subscriptionRouter.post("/billing/subscription/cancel", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;

  if (!(await hasManageSubscriptionPermission(role, userId))) {
    return err(res, 403, "FORBIDDEN", "Seu nível de acesso não permite cancelar a assinatura.");
  }

  const subscription = await prisma.subscription.findFirst({ where: { tenantId }, orderBy: { createdAt: "desc" } });
  if (!subscription) return err(res, 404, "NOT_FOUND", "Nenhuma assinatura encontrada para este tenant.");
  if (subscription.status === "CANCELLED") return err(res, 409, "ALREADY_CANCELLED", "Esta assinatura já está cancelada.");
  if (subscription.cancelRequestedAt) {
    return res.json({ success: true, data: subscription, error: null });
  }

  // CORREÇÃO DE AUDITORIA (mega-audit rodada 9, CRÍTICO): o check acima
  // (`findFirst` seguido de chamadas de rede ao provedor + reembolso) não era
  // atômico — duas requisições concorrentes (ex.: duplo-clique no botão
  // "Cancelar assinatura") passavam AMBAS pela checagem antes de qualquer uma
  // persistir `cancelRequestedAt`, podendo disparar DOIS reembolsos para a MESMA
  // cobrança (dinheiro real saindo em duplicidade da conta da Filitech). Agora a
  // "reivindicação" de `cancelRequestedAt` é uma operação condicional atômica no
  // banco (`updateMany` com `WHERE cancelRequestedAt IS NULL`), executada ANTES de
  // qualquer chamada ao Stripe/Asaas — só a requisição que vence a corrida (count
  // === 1) prossegue para reembolsar; a perdedora recebe a assinatura já
  // atualizada pela vencedora, sem reembolsar nada.
  const claim = await prisma.subscription.updateMany({
    where: { id: subscription.id, cancelRequestedAt: null, status: { not: "CANCELLED" } },
    data: { cancelRequestedAt: new Date() },
  });
  if (claim.count === 0) {
    // Perdeu a corrida: outra requisição já reivindicou o cancelamento. Devolve o
    // estado atual (já atualizado pela vencedora ou prestes a ser) em vez de
    // tentar reembolsar de novo.
    const current = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
    return res.json({ success: true, data: current, error: null });
  }

  const immediate = withinRegretWindow(subscription.firstChargedAt);

  if (immediate) {
    // Art. 49 CDC — cancela e reembolsa integralmente a última cobrança, encerrando
    // o acesso agora mesmo (não houve tempo de "uso justo" do serviço).
    let refundId: string | null = null;
    if (subscription.provider === "stripe") {
      await cancelStripeSubscription(subscription.externalSubscriptionId, false);
      refundId = await refundLatestStripeInvoice(subscription.externalSubscriptionId);
    } else {
      await cancelAsaasSubscription(subscription.externalSubscriptionId);
      const paymentId = await findLatestAsaasPaymentId(subscription.id);
      if (paymentId) {
        await refundAsaasPayment(paymentId);
        refundId = paymentId;
      }
    }

    const updated = await prisma.$transaction([
      prisma.subscription.update({
        where: { id: subscription.id },
        data: { status: "CANCELLED", cancelAtPeriodEnd: true },
      }),
      prisma.tenant.update({ where: { id: tenantId }, data: { status: "CANCELLED" } }),
    ]);

    return res.json({ success: true, data: { ...updated[0], refunded: Boolean(refundId), refundId }, error: null });
  }

  // Fora da janela de arrependimento: agenda o cancelamento para o fim do ciclo
  // vigente — o tenant mantém acesso integral até `currentPeriodEnd`. O cancelamento
  // de fato no provedor é reconciliado por `enforceScheduledCancellations` (worker),
  // pois o Asaas não suporta agendamento nativo (diferente do Stripe `cancel_at_period_end`).
  if (subscription.provider === "stripe") {
    await cancelStripeSubscription(subscription.externalSubscriptionId, true);
  }

  const updated = await prisma.subscription.update({
    where: { id: subscription.id },
    data: { cancelAtPeriodEnd: true },
  });

  return res.json({ success: true, data: updated, error: null });
});

// POST /billing/subscription/cancel/undo — desiste do cancelamento agendado, desde
// que ainda não tenha virado CANCELLED (cancelamento imediato dentro da janela de
// arrependimento, por já envolver reembolso executado, não é reversível por aqui).
subscriptionRouter.post("/billing/subscription/cancel/undo", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasManageSubscriptionPermission(role, userId))) {
    return err(res, 403, "FORBIDDEN", "Seu nível de acesso não permite gerenciar a assinatura.");
  }

  const subscription = await prisma.subscription.findFirst({ where: { tenantId }, orderBy: { createdAt: "desc" } });
  if (!subscription) return err(res, 404, "NOT_FOUND", "Nenhuma assinatura encontrada para este tenant.");
  if (subscription.status === "CANCELLED") return err(res, 409, "ALREADY_CANCELLED", "Esta assinatura já foi cancelada e reembolsada — não é possível desfazer.");
  if (!subscription.cancelRequestedAt) return err(res, 409, "NOT_SCHEDULED", "Não há cancelamento agendado para desfazer.");

  if (subscription.provider === "stripe") {
    await undoStripeScheduledCancellation(subscription.externalSubscriptionId);
  }

  const updated = await prisma.subscription.update({
    where: { id: subscription.id },
    data: { cancelRequestedAt: null, cancelAtPeriodEnd: false },
  });

  return res.json({ success: true, data: updated, error: null });
});

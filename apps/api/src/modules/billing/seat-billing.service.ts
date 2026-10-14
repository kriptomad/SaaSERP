// apps/api/src/modules/billing/seat-billing.service.ts
// Capítulo 2.9 (Usuários Adicionais) — cobrança por assento. Regra de negócio:
// todo plano BUSINESS libera `Plan.includedUserSeats` usuários ATIVOS sem custo
// extra; cada usuário ativo além desse teto soma `Plan.extraUserSeatPrice` ao
// valor cobrado no próximo ciclo. Nunca bloqueia a criação do usuário em si — o
// bloqueio de acesso por inadimplência já é tratado pelo tenant-lockout
// middleware (Capítulo 2.2); este serviço cuida estritamente da precificação.
//
// Planos PERSONAL (B2C) têm includedUserSeats/extraUserSeatPrice nulos — não
// existe conceito de headcount pago no Filitech Pessoal, então o excedente é
// sempre zero para esse público.
import { Prisma, TenantScopedPrismaClient, TenantScopedTransactionClient } from "@filitech/db";
import { syncSeatQuantityWithStripe } from "./stripe.client";
import { createModuleLogger } from "../../lib/logger";

const log = createModuleLogger("seat-billing");

export interface SeatBillingSummary {
  activeUserCount: number;
  includedUserSeats: number | null;
  extraSeatCount: number;
  extraUserSeatPrice: Prisma.Decimal | null;
  extraMonthlyCharge: Prisma.Decimal;
}

/**
 * Calcula o excedente de assentos (usuários ativos acima do incluso no plano)
 * e o valor mensal adicional resultante. Chamado tanto pela rota de criação de
 * usuário (para exibir o aviso de custo extra antes de confirmar) quanto pelo
 * motor de faturamento recorrente (Capítulo 2.7), que soma `extraMonthlyCharge`
 * ao `basePrice` do plano na geração da próxima cobrança.
 */
export async function calculateSeatBilling(
  prisma: TenantScopedPrismaClient | TenantScopedTransactionClient,
  tenantId: string,
): Promise<SeatBillingSummary> {
  const subscription = await prisma.subscription.findFirst({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    include: { plan: true },
  });

  const includedUserSeats = subscription?.plan.includedUserSeats ?? null;
  const extraUserSeatPrice = subscription?.plan.extraUserSeatPrice ?? null;

  const activeUserCount = await prisma.user.count({ where: { tenantId, active: true } });

  // Plano sem conceito de assento pago (PERSONAL, ou BUSINESS legado sem teto
  // configurado) nunca gera cobrança extra.
  if (includedUserSeats === null || extraUserSeatPrice === null) {
    return {
      activeUserCount,
      includedUserSeats,
      extraSeatCount: 0,
      extraUserSeatPrice,
      extraMonthlyCharge: new Prisma.Decimal(0),
    };
  }

  const extraSeatCount = Math.max(0, activeUserCount - includedUserSeats);
  const extraMonthlyCharge = extraUserSeatPrice.mul(extraSeatCount);

  return { activeUserCount, includedUserSeats, extraSeatCount, extraUserSeatPrice, extraMonthlyCharge };
}

/**
 * Reconcilia o excedente de assentos com o provedor de billing (Stripe) após
 * qualquer criação/desativação de usuário. É deliberadamente "best-effort":
 * uma falha aqui (provider != stripe, Price de assento ainda não configurado
 * pelo admin da plataforma, ou erro de rede com o Stripe) NUNCA deve impedir a
 * operação de gestão de usuários em si — apenas fica registrada em log para
 * reconciliação manual/próxima tentativa, já que o valor real cobrado é
 * recalculado a cada ciclo de qualquer forma (Capítulo 2.7).
 */
export async function reconcileSeatBillingWithProvider(prisma: TenantScopedPrismaClient, tenantId: string): Promise<void> {
  const subscription = await prisma.subscription.findFirst({ where: { tenantId }, orderBy: { createdAt: "desc" } });
  if (!subscription || subscription.provider !== "stripe") return;

  const seatPriceParam = await prisma.systemParameter.findUnique({ where: { key: "STRIPE_EXTRA_SEAT_PRICE_ID" } });
  if (!seatPriceParam?.value) {
    log.warn({ tenantId }, "STRIPE_EXTRA_SEAT_PRICE_ID não configurado — excedente de assentos não sincronizado com o Stripe");
    return;
  }

  const seatBilling = await calculateSeatBilling(prisma, tenantId);

  try {
    const itemId = await syncSeatQuantityWithStripe(
      subscription.externalSubscriptionId,
      subscription.stripeSeatSubscriptionItemId,
      seatPriceParam.value,
      seatBilling.extraSeatCount,
    );
    if (itemId !== subscription.stripeSeatSubscriptionItemId) {
      await prisma.subscription.update({ where: { id: subscription.id }, data: { stripeSeatSubscriptionItemId: itemId } });
    }
  } catch (err) {
    log.error({ tenantId, err }, "falha ao sincronizar excedente de assentos com o Stripe");
  }
}

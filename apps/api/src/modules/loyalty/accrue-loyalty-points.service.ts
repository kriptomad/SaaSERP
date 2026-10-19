// apps/api/src/modules/loyalty/accrue-loyalty-points.service.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 4.1.1 — fecha a pendência explícita
// documentada em loyalty.routes.ts: o PDV/Sale nunca creditava pontos EARN.
// Chamado dentro da MESMA transação Prisma que finaliza a Sale (close-sale.service.ts),
// nunca em um job assíncrono separado — o saldo de pontos precisa refletir a venda
// imediatamente, inclusive para permitir resgate na venda seguinte do mesmo cliente
// minutos depois.
import { Prisma, TenantScopedTransactionClient } from "@filitech/db";

export interface AccrueLoyaltyPointsInput {
  tenantId: string;
  clientId: string | null;
  saleId: string;
  totalAmount: Prisma.Decimal;
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

export async function accrueLoyaltyPoints(tx: TenantScopedTransactionClient, input: AccrueLoyaltyPointsInput): Promise<void> {
  if (!input.clientId) return; // venda sem cliente identificado (CPF na nota não informado) nunca acumula pontos

  // findUnique por campo @unique real (tenantId) — nunca findFirst sem filtro aqui,
  // pois o único índice de busca é exatamente esse unique composto pelo schema.
  const program = await tx.loyaltyProgram.findUnique({ where: { tenantId: input.tenantId } });
  if (!program?.active) return;

  const earnedPoints = Math.floor(input.totalAmount.mul(program.pointsPerCurrencyUnit).toNumber());
  if (earnedPoints <= 0) return;

  // CORREÇÃO DE AUDITORIA (idempotência por venda): sem esta checagem, reprocessar
  // o fechamento da mesma venda (retry de rede, replay de fila, dupla submissão)
  // creditava pontos de fidelidade uma segunda vez para a mesma `saleId`. A checagem
  // roda ANTES do upsert de saldo — se já existe um lançamento EARN para esta venda,
  // o saldo nunca chega a ser incrementado de novo (nunca só "silencia" o erro depois
  // do incremento já ter sido aplicado). `@@unique([saleId, type])` no schema
  // (migration 20261114090000) é a defesa de banco para a corrida entre duas
  // chamadas concorrentes desta função para a mesma venda.
  const alreadyAccrued = await tx.loyaltyTransaction.findUnique({ where: { saleId_type: { saleId: input.saleId, type: "EARN" } } });
  if (alreadyAccrued) return;

  // O cliente já foi validado como pertencente a este tenant por quem chamou esta
  // função (sales.routes.ts) antes de abrir a transação — aqui apenas upsert da conta.
  const account = await tx.loyaltyAccount.upsert({
    where: { clientId: input.clientId },
    create: { tenantId: input.tenantId, clientId: input.clientId, pointsBalance: earnedPoints },
    update: { pointsBalance: { increment: earnedPoints } },
  });

  try {
    await tx.loyaltyTransaction.create({
      data: {
        loyaltyAccountId: account.id,
        type: "EARN",
        points: earnedPoints,
        saleId: input.saleId,
        expiresAt: program.pointsExpireAfterDays ? addDays(new Date(), program.pointsExpireAfterDays) : null,
      },
    });
  } catch (err: any) {
    // Corrida entre duas chamadas concorrentes para a MESMA venda: a constraint
    // única do banco (`@@unique([saleId, type])`) rejeita a segunda inserção com
    // P2002. Propaga o erro para abortar e reverter TODA a transação de fechamento
    // da venda (close-sale.service.ts), inclusive o incremento de saldo acima —
    // nunca deixa o saldo incrementado sem o lançamento correspondente.
    throw err;
  }
}

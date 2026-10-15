// apps/api/src/modules/cash-register/close-cash-register.service.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 6.7 — Sangria e Suprimento de Caixa /
// Fechamento de Caixa. Dinheiro esperado = fundo de troco inicial + soma de
// pagamentos em espécie das vendas do turno − troco devolvido − sangrias +
// suprimentos. Cartão/Pix NUNCA entram nesta soma — ficam fora da gaveta física,
// sua conferência é via extrato do adquirente (Capítulo 17.4), não via contagem de
// dinheiro. divergenceAmount só é calculado DEPOIS da contagem confirmada — gaveta
// cega (Capítulo 4.1): o operador nunca vê o valor esperado antes de contar.
import { Prisma, TenantScopedTransactionClient } from "@filitech/db";

export async function closeCashRegister(tx: TenantScopedTransactionClient, cashRegisterId: string, countedAmount: Prisma.Decimal) {
  // GAP DE AUDITORIA FECHADO: antes, nenhum lock pessimista protegia o `CashRegister`
  // durante o fechamento — um `registerCashMovement` (sangria/suprimento) concorrente
  // na mesma gaveta podia commitar entre a leitura de `movements`/`sales` aqui e o
  // `update` final, fazendo o fechamento ignorar silenciosamente aquele movimento
  // (ou, pior, duas chamadas de fechamento simultâneas calcularem `expectedAmount`
  // com bases diferentes). `SELECT ... FOR UPDATE` bloqueia a linha do caixa até o
  // commit desta transação — mesmo padrão já usado em deduct-stock-fefo.service.ts.
  await tx.$queryRaw`SELECT id FROM cash_registers WHERE id = ${cashRegisterId} FOR UPDATE`;

  const register = await tx.cashRegister.findUniqueOrThrow({
    where: { id: cashRegisterId },
    include: { sales: { include: { payments: true } }, movements: true },
  });

  const cashSalesTotal = register.sales
    .flatMap((s) => s.payments)
    .filter((p) => p.method === "CASH")
    .reduce((sum, p) => sum.add(p.amount), new Prisma.Decimal(0));

  const changeGivenTotal = register.sales
    .flatMap((s) => s.payments)
    .reduce((sum, p) => sum.add(p.changeDue), new Prisma.Decimal(0));

  const withdrawals = register.movements
    .filter((m) => m.type === "WITHDRAWAL")
    .reduce((sum, m) => sum.add(m.amount), new Prisma.Decimal(0));

  const injections = register.movements
    .filter((m) => m.type === "INJECTION")
    .reduce((sum, m) => sum.add(m.amount), new Prisma.Decimal(0));

  const expectedAmount = register.openingAmount.add(cashSalesTotal).sub(changeGivenTotal).sub(withdrawals).add(injections);
  const divergenceAmount = countedAmount.sub(expectedAmount);

  return tx.cashRegister.update({
    where: { id: cashRegisterId },
    data: { status: "CLOSED", closingAmount: countedAmount, expectedAmount, divergenceAmount, closedAt: new Date() },
  });
}

export async function registerCashMovement(
  tx: TenantScopedTransactionClient,
  input: { cashRegisterId: string; type: "WITHDRAWAL" | "INJECTION"; amount: Prisma.Decimal; reason: string; performedByUserId: string },
) {
  if (!input.reason?.trim()) {
    throw new Error("Sangria/suprimento exige motivo obrigatório.");
  }

  // GAP DE AUDITORIA FECHADO: mesmo lock pessimista de `closeCashRegister` acima —
  // sem ele, uma sangria/suprimento podia ser inserida exatamente entre a leitura de
  // `movements` e o `update` final de um fechamento concorrente da MESMA gaveta,
  // silenciosamente ficando de fora do cálculo de `expectedAmount` daquele
  // fechamento (o commit do fechamento já teria passado). O `FOR UPDATE` aqui força
  // esta transação a esperar o commit/rollback de um fechamento em andamento (e
  // vice-versa) antes de prosseguir — serializando as duas operações na mesma
  // gaveta, nunca intercalando-as.
  const [register] = await tx.$queryRaw<{ status: string }[]>`
    SELECT status FROM cash_registers WHERE id = ${input.cashRegisterId} FOR UPDATE
  `;
  if (!register || register.status !== "OPEN") {
    throw new Error("Caixa não está aberto — sangria/suprimento exige um caixa com status OPEN.");
  }

  // GAP DE AUDITORIA FECHADO (Capítulo 6.7, Rodada 15): o `AuditLog` global
  // (Capítulo 13) é exclusivo de ações do PAINEL DE PLATAFORMA — sua FK
  // `platformAdminUserId` é obrigatória e não aceita usuários de tenant, então
  // JAMAIS deve ser usado para sangria/suprimento de caixa (isso quebraria o
  // invariante "AuditLog = apenas ações do dono da plataforma"). O registro
  // imutável e auditável de sangria/suprimento já É o próprio
  // `CashRegisterMovement`: nenhuma rota de UPDATE/DELETE existe para este
  // modelo (apenas `create`, ver cash-register.routes.ts), `reason` é
  // obrigatório, e `performedByUserId`/`createdAt` identificam quem e quando —
  // o mesmo padrão de "ledger imutável" usado por `StockMovement`/`AuditLog`.
  return tx.cashRegisterMovement.create({
    data: {
      cashRegisterId: input.cashRegisterId,
      type: input.type,
      amount: input.amount,
      reason: input.reason,
      performedByUserId: input.performedByUserId,
    },
  });
}

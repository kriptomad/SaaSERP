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

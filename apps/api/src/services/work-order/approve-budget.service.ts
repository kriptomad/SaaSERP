// apps/api/src/services/work-order/approve-budget.service.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 6.4 — Controle ACID de Concorrência na
// aprovação de orçamento de O.S. via link de WhatsApp (token de uso único). Risco
// real: clique duplo do cliente ou edição simultânea do técnico. Usa lock otimista
// por token consumível (UPDATE ... WHERE condicional atômico) em vez de lock
// pessimista — mais barato para este fluxo de baixa contenção.
//
// CORREÇÃO DE AUDITORIA: a assinatura original recebia `TenantScopedPrismaClient`,
// mas o endpoint que chama esta função (`POST /work-orders/budget-approval/:token`)
// é deliberadamente público (sem `requireAuth`) — o cliente final que aprova o
// orçamento via link de WhatsApp nunca tem conta/sessão no sistema. Sem sessão,
// `tenantContextMiddleware` nunca chama `runWithTenantContext`, então qualquer
// query através do client tenant-scoped lançava
// "Tentativa de acesso ao banco fora de um contexto de tenant autenticado" —
// ou seja, TODA aprovação de orçamento por WhatsApp quebrava com 500. Corrigido
// para `PrismaClient` cru (`prismaUnscoped`): a segurança aqui nunca dependeu de
// tenantId, e sim do token de uso único de 256 bits, que já é a autorização.
import { PrismaClient } from "@filitech/db";

export class BudgetAlreadyProcessedError extends Error {}
export class BudgetExpiredError extends Error {}

export async function approveBudget(prisma: PrismaClient, approvalToken: string) {
  return prisma.$transaction(async (tx) => {
    // UPDATE condicional: só afeta a linha se o token ainda corresponder e não
    // tiver sido consumido — "count === 0" indica corrida já resolvida por outra
    // requisição concorrente, sem necessidade de lock explícito.
    const result = await tx.$executeRaw`
      UPDATE work_orders
      SET status = 'IN_REPAIR', "budgetApprovedAt" = NOW(), "budgetApprovalToken" = NULL
      WHERE "budgetApprovalToken" = ${approvalToken}
        AND status = 'AWAITING_APPROVAL'
        AND "budgetValidUntil" > NOW()
    `;

    if (result === 0) {
      const workOrder = await tx.workOrder.findFirst({ where: { budgetApprovalToken: approvalToken } });
      if (workOrder && workOrder.budgetValidUntil && workOrder.budgetValidUntil < new Date()) {
        throw new BudgetExpiredError("Orçamento expirado. Solicite um novo orçamento ao técnico.");
      }
      throw new BudgetAlreadyProcessedError("Este orçamento já foi aprovado ou não está mais pendente.");
    }

    return tx.workOrder.findFirstOrThrow({ where: { budgetApprovalToken: approvalToken } });
  });
}

// apps/api/src/modules/notifications/notify.service.ts
// Sistema central de notificações real (Capítulo 8.4) — grava direto no banco
// (model Notification). O fan-out multicanal (WhatsApp/e-mail/push) descrito no
// Capítulo 20.2/20.8 é consumido por um worker BullMQ dedicado (próxima fase);
// esta função é o ÚNICO ponto de entrada usado por todo o resto do sistema, então
// quando o worker for acoplado, nenhum chamador precisa mudar.
import { prismaUnscoped } from "@filitech/db";

export interface NotifyTenantInput {
  tenantId: string;
  userId?: string | null;
  category:
    | "WORK_ORDER_STATUS"
    | "SUPPORT_TICKET_UPDATE"
    | "CASH_FLOW_ALERT"
    | "BILLING_DUNNING"
    | "ACCOUNTING_TASK_REMINDER"
    | "STOCK_LOW"
    | "FISCAL_DOCUMENT_REJECTED"
    | "SYSTEM_ANNOUNCEMENT"
    | "VACCINE_REMINDER";
  title: string;
  body: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  linkRoute?: string;
  sourceType: string;
  sourceId?: string;
}

export async function notifyTenant(input: NotifyTenantInput) {
  return prismaUnscoped.notification.create({
    data: {
      tenantId: input.tenantId,
      userId: input.userId ?? null,
      category: input.category,
      title: input.title,
      body: input.body,
      severity: input.severity,
      linkRoute: input.linkRoute,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
    },
  });
}

// Capítulo 2.7.4 — notificação de falha de pagamento, disparada pela régua de dunning.
export async function notifyTenantPaymentFailed(tenantId: string, info: { attempt: number; nextRetryAt: Date }) {
  return notifyTenant({
    tenantId,
    category: "BILLING_DUNNING",
    title: "Falha no pagamento da assinatura",
    body: `Tentativa ${info.attempt} de cobrança falhou. Próxima tentativa em ${info.nextRetryAt.toLocaleDateString("pt-BR")}.`,
    severity: info.attempt >= 3 ? "CRITICAL" : "WARNING",
    linkRoute: "/configuracoes/cobranca",
    sourceType: "SUBSCRIPTION",
  });
}

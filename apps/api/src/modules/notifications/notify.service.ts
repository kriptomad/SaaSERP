// apps/api/src/modules/notifications/notify.service.ts
// Sistema central de notificações real (Capítulo 8.4) — grava direto no banco
// (model Notification) e, quando há um usuário-alvo específico, dispara o fan-out
// multicanal real (WhatsApp/e-mail/push) descrito no Capítulo 20.2/20.8, respeitando
// a `NotificationPreference` do usuário. `notifyTenant()` é o ÚNICO ponto de entrada
// usado por todo o resto do sistema.
//
// GAP DE AUDITORIA FECHADO: esta função só gravava a Notification e nunca enviava
// nada de verdade — havia inclusive uma fila BullMQ (`whatsappNotificationsQueue`,
// lib/queue.ts) declarada mas sem nenhum produtor. Agora: WhatsApp é enfileirado (job
// assíncrono, retry/backoff via BullMQ, mesmo padrão de enqueueFiscalEmission), e-mail
// e push são disparados direto (fire-and-forget, nunca bloqueiam o caller).
import { prismaUnscoped } from "@filitech/db";
import { whatsappNotificationsQueue, smsNotificationsQueue } from "../../lib/queue";
import { sendTransactionalEmail } from "./channels/email.channel";
import { sendExpoPushNotifications } from "./channels/push.channel";
import { createModuleLogger } from "../../lib/logger";
import { broadcastToTenant } from "../../lib/sse";

const log = createModuleLogger("notify.service");

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
    | "VACCINE_REMINDER"
    | "TEF_CONFIRMATION_FAILED";
  title: string;
  body: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  linkRoute?: string;
  sourceType: string;
  sourceId?: string;
  /** fa-w4-obs-no-request-id — id da requisição HTTP que originou esta notificação
   * (quando aplicável, ex.: webhook de billing recebido — ver
   * modules/billing/webhooks.routes.ts/dunning.service.ts), propagado apenas para
   * o job WhatsApp/SMS eventualmente enfileirado abaixo, para correlação de log no
   * worker. Opcional: a maioria das chamadas a `notifyTenant` vem de workers/crons
   * sem requisição HTTP de origem. */
  requestId?: string;
}

// Mesmos defaults de notification-settings.routes.ts para categorias ainda sem linha
// de NotificationPreference (upsert nunca aconteceu para aquele usuário/categoria).
const DEFAULT_CHANNELS = { inApp: true, email: true, push: false, whatsapp: false, sms: false };

// Categoria de NotificationPreference: GAP DE AUDITORIA FECHADO (Rodada 6, MÉDIO) —
// VACCINE_REMINDER e TEF_CONFIRMATION_FAILED agora fazem parte do catálogo completo
// (idêntico a `notification-settings.routes.ts`/CATEGORIES); antes, `notifyTenant`
// com essas categorias pulava TODO o fan-out multicanal (WhatsApp/SMS/e-mail/push)
// silenciosamente — só o registro in-app era gravado.
const PREFERENCE_CATEGORIES = new Set([
  "WORK_ORDER_STATUS",
  "SUPPORT_TICKET_UPDATE",
  "CASH_FLOW_ALERT",
  "BILLING_DUNNING",
  "ACCOUNTING_TASK_REMINDER",
  "STOCK_LOW",
  "FISCAL_DOCUMENT_REJECTED",
  "SYSTEM_ANNOUNCEMENT",
  "VACCINE_REMINDER",
  "TEF_CONFIRMATION_FAILED",
]);

async function enqueueWhatsAppJob(tenantId: string, toPhone: string, body: string, requestId?: string): Promise<void> {
  try {
    // Mesmo padrão de attempts/backoff usado por enqueueFiscalEmission
    // (modules/fiscal/queues/fiscal-emission.queue.ts): 5 tentativas, backoff
    // exponencial a partir de 5s.
    await whatsappNotificationsQueue.add(
      "send-whatsapp-notification",
      { tenantId, toPhone, body, requestId },
      { attempts: 5, backoff: { type: "exponential", delay: 5_000 }, removeOnComplete: true },
    );
  } catch (error) {
    // Redis/BullMQ fora do ar nunca pode derrubar a transação de negócio do caller
    // (ex.: fechar uma venda, aprovar uma OS) — loga e segue.
    log.error({ tenantId, err: error }, "falha ao enfileirar notificação WhatsApp");
  }
}

async function enqueueSmsJob(tenantId: string, toPhone: string, body: string, requestId?: string): Promise<void> {
  try {
    // Mesmo padrão de enqueueWhatsAppJob.
    await smsNotificationsQueue.add(
      "send-sms-notification",
      { tenantId, toPhone, body, requestId },
      { attempts: 5, backoff: { type: "exponential", delay: 5_000 }, removeOnComplete: true },
    );
  } catch (error) {
    log.error({ tenantId, err: error }, "falha ao enfileirar notificação SMS");
  }
}

async function dispatchUserChannels(input: NotifyTenantInput): Promise<void> {
  if (!input.userId || !PREFERENCE_CATEGORIES.has(input.category)) {
    // Notificação tenant-wide (ex.: SYSTEM_ANNOUNCEMENT sem userId) — não há um único
    // usuário para resolver canais/preferências; broadcast multicanal para todos os
    // usuários do tenant é um escopo/feature diferente, fora do escopo desta função.
    return;
  }

  const [preference, user, pushDevices] = await Promise.all([
    prismaUnscoped.notificationPreference.findUnique({
      where: { userId_category: { userId: input.userId, category: input.category as any } },
    }),
    // GAP DE AUDITORIA FECHADO (cross-tenant leak): este `findUnique` usa
    // `prismaUnscoped` (sem tenant scoping automático), então um `userId` de outro
    // tenant (ex.: reaproveitado/mismatched por engano no caller) resultaria no envio
    // de e-mail/WhatsApp/SMS/push para um usuário de OUTRO tenant. Filtra por
    // `tenantId` diretamente no `where` para garantir que o usuário resolvido
    // pertence ao mesmo tenant do evento disparado.
    prismaUnscoped.user.findFirst({
      where: { id: input.userId, tenantId: input.tenantId },
      select: { email: true, whatsappPhone: true },
    }),
    prismaUnscoped.pushDeviceToken.findMany({
      where: { userId: input.userId, revokedAt: null },
      select: { expoPushToken: true },
    }),
  ]);
  if (!user) {
    log.error(
      { tenantId: input.tenantId, userId: input.userId },
      "dispatchUserChannels: usuário não encontrado no tenant informado — notificação multicanal abortada (possível cross-tenant mismatch)",
    );
    return;
  }

  const channels = {
    email: preference?.email ?? DEFAULT_CHANNELS.email,
    push: preference?.push ?? DEFAULT_CHANNELS.push,
    whatsapp: preference?.whatsapp ?? DEFAULT_CHANNELS.whatsapp,
    sms: preference?.sms ?? DEFAULT_CHANNELS.sms,
  };

  if (channels.whatsapp && user.whatsappPhone) {
    await enqueueWhatsAppJob(input.tenantId, user.whatsappPhone, `${input.title}\n\n${input.body}`, input.requestId);
  }

  // Reaproveita o mesmo `User.whatsappPhone` (E.164) como destino do SMS — não existe
  // um segundo campo de telefone redundante só para este canal (ver nota em
  // schema.prisma/NotificationPreference.sms).
  if (channels.sms && user.whatsappPhone) {
    await enqueueSmsJob(input.tenantId, user.whatsappPhone, `${input.title}: ${input.body}`, input.requestId);
  }

  if (channels.email) {
    // Fire-and-forget: falha de entrega de e-mail nunca pode bloquear o caller.
    sendTransactionalEmail(input.tenantId, user.email, input.title, `<p>${input.body}</p>`).catch((error) => {
      log.error({ tenantId: input.tenantId, err: error }, "falha ao enviar e-mail de notificação");
    });
  }

  if (channels.push && pushDevices.length > 0) {
    const tokens = pushDevices.map((d) => d.expoPushToken);
    sendExpoPushNotifications(tokens, input.title, input.body, { linkRoute: input.linkRoute, category: input.category }).catch((error) => {
      log.error({ tenantId: input.tenantId, err: error }, "falha ao enviar push de notificação");
    });
  }
}

export async function notifyTenant(input: NotifyTenantInput) {
  const notification = await prismaUnscoped.notification.create({
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

  // Fan-out multicanal nunca bloqueia nem derruba a criação da Notification acima —
  // qualquer falha de canal (Redis fora do ar, provedor não configurado, etc.) é
  // tratada e logada dentro de dispatchUserChannels/enqueueWhatsAppJob.
  await dispatchUserChannels(input).catch((error) => {
    log.error({ tenantId: input.tenantId, err: error }, "falha no fan-out multicanal");
  });

  // Empurra ao vivo para quem estiver com o stream SSE aberto (Capítulo 8.2) — não
  // bloqueia nem falha a criação caso ninguém esteja conectado no momento.
  broadcastToTenant(input.tenantId, "notification", notification, input.userId ?? null);

  return notification;
}

// Capítulo 2.7.4 — notificação de falha de pagamento, disparada pela régua de dunning.
export async function notifyTenantPaymentFailed(
  tenantId: string,
  info: { attempt: number; nextRetryAt: Date },
  // fa-w4-obs-no-request-id: id da requisição HTTP do webhook Stripe/Asaas que
  // disparou esta falha de pagamento (ver dunning.service.ts/webhooks.routes.ts).
  requestId?: string,
) {
  return notifyTenant({
    tenantId,
    category: "BILLING_DUNNING",
    title: "Falha no pagamento da assinatura",
    body: `Tentativa ${info.attempt} de cobrança falhou. Próxima tentativa em ${info.nextRetryAt.toLocaleDateString("pt-BR")}.`,
    severity: info.attempt >= 3 ? "CRITICAL" : "WARNING",
    linkRoute: "/configuracoes/cobranca",
    sourceType: "SUBSCRIPTION",
    requestId,
  });
}

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
import { escapeHtml } from "../../lib/html-escape";
import { enforceRateLimit, RateLimitExceededError } from "../../lib/rate-limit";

const log = createModuleLogger("notify.service");

// fa-w5-notif-no-outbound-volume-cap — teto por tenant de envios externos (WhatsApp +
// SMS combinados, único orçamento compartilhado entre os dois canais — ambos
// consomem o mesmo "crédito" de confiança/custo por mensagem saindo do número
// compartilhado da plataforma) por hora e por dia. Reaproveita o MESMO primitivo
// Redis `INCR` + `EXPIRE` atômico já usado por login/signup/reset de senha
// (`lib/rate-limit.ts`) em vez de inventar um mecanismo de quota paralelo — a única
// diferença é que aqui o "limite excedido" é um 4xx de negócio para o caller de
// `notifyTenant` (ex.: um job de dunning/lembrete em massa), não uma resposta HTTP
// direta a um usuário final.
const TENANT_NOTIFICATION_HOURLY_CAP = Number(process.env.TENANT_NOTIFICATION_HOURLY_CAP ?? 500);
const TENANT_NOTIFICATION_DAILY_CAP = Number(process.env.TENANT_NOTIFICATION_DAILY_CAP ?? 2000);

export class TenantNotificationCapExceededError extends Error {}

/**
 * fa-w5-notif-no-outbound-volume-cap — chamado uma única vez por envio externo
 * (WhatsApp OU SMS) efetivamente enfileirado, nunca por `notifyTenant()` como um
 * todo (uma notificação pode não ter nenhum canal externo habilitado e não deve
 * consumir cota nenhuma). Lança `TenantNotificationCapExceededError` — o caller
 * (`enqueueWhatsAppJob`/`enqueueSmsJob`) trata isso como uma falha de enfileiramento
 * normal (loga e não propaga para o fluxo de negócio do caller original), mas com um
 * log de nível `warn` distinto e estruturado, pensado para alertar um operador de
 * que um tenant pode estar sendo usado para abuso (conta comprometida enviando spam
 * em massa, bug de loop em algum job, etc.) — nunca um "descarte silencioso".
 */
async function enforceTenantNotificationCap(tenantId: string): Promise<void> {
  const hourlyKey = `tenant-notif-cap:hourly:${tenantId}`;
  const dailyKey = `tenant-notif-cap:daily:${tenantId}`;
  try {
    await enforceRateLimit(hourlyKey, TENANT_NOTIFICATION_HOURLY_CAP, 3_600);
    await enforceRateLimit(dailyKey, TENANT_NOTIFICATION_DAILY_CAP, 86_400);
  } catch (err) {
    if (err instanceof RateLimitExceededError) {
      log.warn(
        {
          security: true,
          tenantId,
          hourlyCap: TENANT_NOTIFICATION_HOURLY_CAP,
          dailyCap: TENANT_NOTIFICATION_DAILY_CAP,
        },
        "fa-w5-notif-no-outbound-volume-cap: tenant excedeu a cota de envio externo (WhatsApp/SMS) — envio rejeitado",
      );
      throw new TenantNotificationCapExceededError(
        `Cota de envio de notificações externas excedida para este tenant (limite de ${TENANT_NOTIFICATION_HOURLY_CAP}/hora, ${TENANT_NOTIFICATION_DAILY_CAP}/dia).`,
      );
    }
    throw err;
  }
}

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
  /** fa-w5-notif-no-marketing-optout-enforcement — informe quando esta notificação
   * é endereçada a um CLIENTE final do tenant (model `Client`: tutor de pet,
   * cliente de oficina, etc.) em vez de (ou além de) um `User`/staff do tenant —
   * ex.: lembrete de vacina ao tutor do pet (client-records.routes.ts). Dispara o
   * fan-out WhatsApp/e-mail para o contato do `Client` (`dispatchClientChannels`),
   * sujeito à checagem de opt-in/opt-out de MARKETING (`isMarketingCategory`) —
   * categorias TRANSACTIONAL nunca são bloqueadas por falta de opt-in. Pode ser
   * combinado com `userId` (ex.: notifica o técnico responsável E o cliente final
   * do mesmo evento), são dispatch paths independentes. */
  recipientClientId?: string;
}

// fa-w5-notif-no-marketing-optout-enforcement — classificação TRANSACTIONAL vs
// MARKETING de cada categoria do catálogo (Capítulo 8.4/20.2). TRANSACTIONAL =
// ligada a uma transação/obrigação de segurança/compliance específica que o
// destinatário não pode razoavelmente recusar (OTP, recibo, status de uma O.S. que
// ele abriu, falha de pagamento da própria assinatura, lembrete de vacina de saúde
// do próprio pet). MARKETING = conteúdo promocional/informativo não ligado a uma
// transação específica, que um CLIENTE final pode legitimamente preferir não
// receber — hoje, dentro do catálogo existente, só `SYSTEM_ANNOUNCEMENT` se encaixa
// nessa definição (comunicados genéricos da plataforma/loja); todas as demais
// categorias são amarradas a um evento de negócio específico do próprio
// destinatário. Qualquer categoria NOVA adicionada ao catálogo deve ser
// explicitamente listada em um dos dois conjuntos — `isMarketingCategory` trata
// qualquer categoria ausente de `TRANSACTIONAL_CATEGORIES` como MARKETING por
// segurança (fail-closed: melhor bloquear um envio legítimo por engano de
// classificação do que vazar uma categoria nova sem checagem de opt-out nenhuma).
const TRANSACTIONAL_CATEGORIES = new Set<NotifyTenantInput["category"]>([
  "WORK_ORDER_STATUS",
  "SUPPORT_TICKET_UPDATE",
  "CASH_FLOW_ALERT",
  "BILLING_DUNNING",
  "ACCOUNTING_TASK_REMINDER",
  "STOCK_LOW",
  "FISCAL_DOCUMENT_REJECTED",
  "VACCINE_REMINDER",
  "TEF_CONFIRMATION_FAILED",
]);

function isMarketingCategory(category: NotifyTenantInput["category"]): boolean {
  return !TRANSACTIONAL_CATEGORIES.has(category);
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

async function enqueueWhatsAppJob(
  tenantId: string,
  toPhone: string,
  body: string,
  notificationId: string,
  requestId?: string,
): Promise<void> {
  try {
    // fa-w5-notif-no-outbound-volume-cap — checado ANTES do enfileiramento: um
    // tenant que já estourou a cota não acumula ainda mais jobs pendentes no Redis
    // (nem gasta uma das 5 tentativas de retry do BullMQ tentando enviar algo que
    // já sabemos que não deveria sair).
    await enforceTenantNotificationCap(tenantId);
    // Mesmo padrão de attempts/backoff usado por enqueueFiscalEmission
    // (modules/fiscal/queues/fiscal-emission.queue.ts): 5 tentativas, backoff
    // exponencial a partir de 5s. `notificationId` viaja no payload do job para que
    // o worker (fa-w5-notif-delivery-failure-silent-to-users) consiga atualizar
    // `Notification.deliveryStatus/deliveryError` de volta no sucesso/falha
    // terminal, via o listener central `completed`/`failed` em `worker.ts`.
    await whatsappNotificationsQueue.add(
      "send-whatsapp-notification",
      { tenantId, toPhone, body, notificationId, requestId },
      { attempts: 5, backoff: { type: "exponential", delay: 5_000 }, removeOnComplete: true },
    );
  } catch (error) {
    // Redis/BullMQ fora do ar (ou cota excedida) nunca pode derrubar a transação de
    // negócio do caller (ex.: fechar uma venda, aprovar uma OS) — loga e segue.
    log.error({ tenantId, err: error }, "falha ao enfileirar notificação WhatsApp");
  }
}

async function enqueueSmsJob(
  tenantId: string,
  toPhone: string,
  body: string,
  notificationId: string,
  requestId?: string,
): Promise<void> {
  try {
    // Mesmo padrão de enqueueWhatsAppJob (cota compartilhada WhatsApp+SMS).
    await enforceTenantNotificationCap(tenantId);
    await smsNotificationsQueue.add(
      "send-sms-notification",
      { tenantId, toPhone, body, notificationId, requestId },
      { attempts: 5, backoff: { type: "exponential", delay: 5_000 }, removeOnComplete: true },
    );
  } catch (error) {
    log.error({ tenantId, err: error }, "falha ao enfileirar notificação SMS");
  }
}

async function dispatchUserChannels(input: NotifyTenantInput, notificationId: string): Promise<void> {
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
    await enqueueWhatsAppJob(input.tenantId, user.whatsappPhone, `${input.title}\n\n${input.body}`, notificationId, input.requestId);
  }

  // Reaproveita o mesmo `User.whatsappPhone` (E.164) como destino do SMS — não existe
  // um segundo campo de telefone redundante só para este canal (ver nota em
  // schema.prisma/NotificationPreference.sms).
  if (channels.sms && user.whatsappPhone) {
    await enqueueSmsJob(input.tenantId, user.whatsappPhone, `${input.title}: ${input.body}`, notificationId, input.requestId);
  }

  if (channels.email) {
    // fa-w5-notif-email-html-injection — `input.title`/`input.body` contêm dados de
    // negócio potencialmente controlados por um usuário comum do tenant (ex.: nome
    // de um cliente/pet/produto digitado em algum cadastro, propagado para o texto
    // da notificação) — nunca podem ser interpolados crus dentro de `<p>...</p>`.
    // Fire-and-forget: falha de entrega de e-mail nunca pode bloquear o caller.
    sendTransactionalEmail(input.tenantId, user.email, escapeHtml(input.title), `<p>${escapeHtml(input.body)}</p>`).catch((error) => {
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

/**
 * fa-w5-notif-no-marketing-optout-enforcement — fan-out externo (WhatsApp/e-mail)
 * para um `Client` (CLIENTE final do tenant: tutor de pet, cliente de oficina etc.),
 * nunca um `User`/staff — contrato e checagens completamente independentes de
 * `dispatchUserChannels` (que resolve `NotificationPreference`/push device de um
 * usuário interno). Categorias classificadas MARKETING (`isMarketingCategory`) só
 * são enviadas a um Client que tenha opt-in explícito e ATIVO para mensagens
 * promocionais (`Client.whatsappOptInAt` preenchido e, se houver
 * `Client.whatsappOptOutAt`, que seja ANTERIOR ao opt-in mais recente — um opt-out
 * mais recente que o opt-in revoga o consentimento até um novo opt-in explícito).
 * Categorias TRANSACTIONAL (ex.: `VACCINE_REMINDER`) nunca são bloqueadas por
 * opt-out — são lembretes/avisos ligados a uma necessidade de segurança/saúde/
 * compliance específica do próprio cliente, não conteúdo promocional que ele possa
 * legitimamente recusar.
 */
async function dispatchClientChannels(input: NotifyTenantInput, notificationId: string): Promise<void> {
  if (!input.recipientClientId) return;

  const client = await prismaUnscoped.client.findFirst({
    where: { id: input.recipientClientId, tenantId: input.tenantId },
    select: { phone: true, email: true, whatsappOptInAt: true, whatsappOptOutAt: true },
  });
  if (!client) {
    log.error(
      { tenantId: input.tenantId, clientId: input.recipientClientId },
      "dispatchClientChannels: cliente não encontrado no tenant informado — notificação multicanal abortada (possível cross-tenant mismatch)",
    );
    return;
  }

  if (isMarketingCategory(input.category)) {
    const optedIn = Boolean(client.whatsappOptInAt) && (!client.whatsappOptOutAt || client.whatsappOptOutAt < client.whatsappOptInAt!);
    if (!optedIn) {
      log.warn(
        {
          tenantId: input.tenantId,
          clientId: input.recipientClientId,
          category: input.category,
        },
        "fa-w5-notif-no-marketing-optout-enforcement: envio MARKETING a cliente bloqueado — sem opt-in ativo (ou opt-out mais recente que o opt-in)",
      );
      return;
    }
  }

  if (client.phone) {
    await enqueueWhatsAppJob(input.tenantId, client.phone, `${input.title}\n\n${input.body}`, notificationId, input.requestId);
  }

  if (client.email) {
    // fa-w5-notif-email-html-injection — mesma disciplina de escaping de
    // dispatchUserChannels: `title`/`body` podem conter dados de negócio
    // controlados por um usuário comum do tenant.
    sendTransactionalEmail(input.tenantId, client.email, escapeHtml(input.title), `<p>${escapeHtml(input.body)}</p>`).catch((error) => {
      log.error({ tenantId: input.tenantId, err: error }, "falha ao enviar e-mail de notificação ao cliente");
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
  // tratada e logada dentro de dispatchUserChannels/dispatchClientChannels/
  // enqueueWhatsAppJob. Os dois dispatch paths são independentes (uma mesma
  // notificação pode opcionalmente ter `userId` E `recipientClientId`).
  await Promise.all([
    dispatchUserChannels(input, notification.id).catch((error) => {
      log.error({ tenantId: input.tenantId, err: error }, "falha no fan-out multicanal (usuário)");
    }),
    dispatchClientChannels(input, notification.id).catch((error) => {
      log.error({ tenantId: input.tenantId, err: error }, "falha no fan-out multicanal (cliente)");
    }),
  ]);

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

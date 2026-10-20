// apps/api/src/workers/whatsapp-notifications.worker.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 3.4 (fila `whatsapp-notifications`) e
// 20.2/20.8 — consumidor real do job "send-whatsapp-notification" enfileirado por
// notify.service.ts/enqueueWhatsAppJob. Fecha o gap crítico de auditoria em que a
// fila `whatsappNotificationsQueue` existia declarada (lib/queue.ts) mas nenhum
// worker nunca a consumia — toda preferência "whatsapp: true" nunca de fato enviava
// nada.
//
// Mesmo contrato de `runWithTenantContext` do fiscal-emission.worker.ts, mesmo que
// esta rotina não precise do Prisma Client tenant-scoped diretamente (o envio em si
// é feito por sendWhatsAppText via prismaUnscoped) — mantém o padrão consistente
// entre workers para qualquer helper futuro que dependa do contexto.
import { Worker, Job } from "bullmq";
import { runWithTenantContext } from "@filitech/db";
import { queueRedisConnection, QUEUE_NAMES } from "../lib/queue";
import { sendWhatsAppText } from "../modules/notifications/channels/whatsapp.channel";

interface SendWhatsAppNotificationJobData {
  tenantId: string;
  toPhone: string;
  body: string;
  /** fa-w4-obs-no-request-id — opcional, só para correlação de log (ver
   * modules/notifications/notify.service.ts). */
  requestId?: string;
}

export async function whatsappNotificationsProcessor(
  job: Job<SendWhatsAppNotificationJobData>,
): Promise<{ success: boolean }> {
  const { tenantId, toPhone, body } = job.data;

  return runWithTenantContext({ tenantId, userId: "system-worker", role: "SYSTEM_WORKER" }, async () => {
    const result = await sendWhatsAppText(tenantId, toPhone, body);
    if (!result.success) {
      // Falha (provedor não configurado, token expirado, rede fora do ar, etc.) vira
      // exceção propositalmente — é o sinal que o BullMQ usa para re-tentar com o
      // backoff exponencial configurado em notify.service.ts/enqueueWhatsAppJob (5
      // tentativas), mesmo padrão do fiscalEmissionProcessor.
      throw new Error(result.message);
    }
    return { success: true };
  });
}

export function startWhatsAppNotificationsWorker(): Worker {
  return new Worker<SendWhatsAppNotificationJobData>(QUEUE_NAMES.WHATSAPP_NOTIFICATIONS, whatsappNotificationsProcessor, {
    connection: queueRedisConnection,
    concurrency: 5,
  });
}

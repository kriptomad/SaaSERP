// apps/api/src/workers/sms-notifications.worker.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 3.4 (fila `sms-notifications`) e
// 20.2/20.8 — consumidor real do job "send-sms-notification" enfileirado por
// notify.service.ts/enqueueSmsJob. GAP DE AUDITORIA FECHADO (Mega-Audit Rodada 4).
//
// Espelha byte-a-byte o padrão de whatsapp-notifications.worker.ts.
import { Worker, Job } from "bullmq";
import { runWithTenantContext } from "@filitech/db";
import { queueRedisConnection, QUEUE_NAMES } from "../lib/queue";
import { sendSmsText } from "../modules/notifications/channels/sms.channel";

interface SendSmsNotificationJobData {
  tenantId: string;
  toPhone: string;
  body: string;
  /** fa-w4-obs-no-request-id — opcional, só para correlação de log (ver
   * modules/notifications/notify.service.ts). */
  requestId?: string;
}

export async function smsNotificationsProcessor(job: Job<SendSmsNotificationJobData>): Promise<{ success: boolean }> {
  const { tenantId, toPhone, body } = job.data;

  return runWithTenantContext({ tenantId, userId: "system-worker", role: "SYSTEM_WORKER" }, async () => {
    const result = await sendSmsText(tenantId, toPhone, body);
    if (!result.success) {
      // Mesmo contrato de retry de whatsappNotificationsProcessor: falha vira
      // exceção para o BullMQ re-tentar com o backoff exponencial configurado em
      // notify.service.ts/enqueueSmsJob.
      throw new Error(result.message);
    }
    return { success: true };
  });
}

export function startSmsNotificationsWorker(): Worker {
  return new Worker<SendSmsNotificationJobData>(QUEUE_NAMES.SMS_NOTIFICATIONS, smsNotificationsProcessor, {
    connection: queueRedisConnection,
    concurrency: 5,
  });
}

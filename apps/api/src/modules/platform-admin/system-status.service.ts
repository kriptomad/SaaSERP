// apps/api/src/modules/platform-admin/system-status.service.ts
// GAP DE AUDITORIA FECHADO (Mega-Audit Rodada 2, item 9, Capítulo 15.1/15.1.5):
// dashboard de status/saúde do sistema não existia — só o `/health` genérico
// (database+redis) usado por liveness probe. Este serviço agrega um snapshot real
// de saúde (banco, Redis, TODAS as filas BullMQ com profundidade/falhas, uptime do
// processo) para o painel interno de plataforma, e uma versão PÚBLICA simplificada
// (sem profundidade de fila/memória — informação operacional interna, nunca exposta
// a clientes) para a página de status pública (`GET /status`).
import { prismaUnscoped as prisma } from "@filitech/db";
import { redis } from "../../lib/redis";
import {
  QUEUE_NAMES,
  whatsappNotificationsQueue,
  fiscalEmissionQueue,
  nfeXmlIngestionQueue,
  reportGenerationQueue,
  suspendOverdueTenantsQueue,
  pluggySyncQueue,
  loyaltyPointsExpirationQueue,
  scheduledSubscriptionCancellationsQueue,
  webhookDeliveryQueue,
  personalRecurrenceGenerationQueue,
  personalBillRemindersQueue,
  dataExportGenerationQueue,
  dataImportValidationQueue,
  dataImportExecutionQueue,
  databaseBackupQueue,
} from "../../lib/queue";

const ALL_QUEUES = [
  whatsappNotificationsQueue,
  fiscalEmissionQueue,
  nfeXmlIngestionQueue,
  reportGenerationQueue,
  suspendOverdueTenantsQueue,
  pluggySyncQueue,
  loyaltyPointsExpirationQueue,
  scheduledSubscriptionCancellationsQueue,
  webhookDeliveryQueue,
  personalRecurrenceGenerationQueue,
  personalBillRemindersQueue,
  dataExportGenerationQueue,
  dataImportValidationQueue,
  dataImportExecutionQueue,
  databaseBackupQueue,
];

export type ComponentStatus = "operational" | "degraded" | "outage";

export interface QueueHealth {
  name: string;
  status: ComponentStatus;
  waiting: number;
  active: number;
  failed: number;
  delayed: number;
}

export interface SystemStatusSnapshot {
  overallStatus: ComponentStatus;
  checkedAt: string;
  database: { status: ComponentStatus; latencyMs: number | null };
  redis: { status: ComponentStatus; latencyMs: number | null };
  queues: QueueHealth[];
  processUptimeSeconds: number;
  nodeVersion: string;
}

// Limiar simples e honesto: uma fila com itens falhados acumulados é "degraded"
// (precisa de atenção humana), nunca "outage" — falha de job não derruba o sistema
// todo, é tratado individualmente por cada worker (retry/backoff já configurado por
// fila). Mais de 100 jobs aguardando processamento indica possível worker parado.
const DEGRADED_FAILED_THRESHOLD = 1;
const DEGRADED_WAITING_THRESHOLD = 100;

async function checkDatabase(): Promise<{ status: ComponentStatus; latencyMs: number | null }> {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: "operational", latencyMs: Date.now() - start };
  } catch {
    return { status: "outage", latencyMs: null };
  }
}

async function checkRedis(): Promise<{ status: ComponentStatus; latencyMs: number | null }> {
  const start = Date.now();
  try {
    await redis.ping();
    return { status: "operational", latencyMs: Date.now() - start };
  } catch {
    return { status: "outage", latencyMs: null };
  }
}

async function checkQueues(): Promise<QueueHealth[]> {
  return Promise.all(
    ALL_QUEUES.map(async (queue) => {
      try {
        const counts = await queue.getJobCounts("waiting", "active", "failed", "delayed");
        const waiting = counts.waiting ?? 0;
        const active = counts.active ?? 0;
        const failed = counts.failed ?? 0;
        const delayed = counts.delayed ?? 0;
        const status: ComponentStatus =
          failed >= DEGRADED_FAILED_THRESHOLD || waiting >= DEGRADED_WAITING_THRESHOLD ? "degraded" : "operational";
        return { name: queue.name, status, waiting, active, failed, delayed };
      } catch {
        // Fila inacessível (conexão Redis dedicada da fila caiu) — não é a mesma
        // conexão checada em checkRedis(), então reporta separadamente como outage.
        return { name: queue.name, status: "outage" as const, waiting: 0, active: 0, failed: 0, delayed: 0 };
      }
    }),
  );
}

function worstStatus(statuses: ComponentStatus[]): ComponentStatus {
  if (statuses.includes("outage")) return "outage";
  if (statuses.includes("degraded")) return "degraded";
  return "operational";
}

export async function getSystemStatusSnapshot(): Promise<SystemStatusSnapshot> {
  const [database, redisHealth, queues] = await Promise.all([checkDatabase(), checkRedis(), checkQueues()]);

  return {
    overallStatus: worstStatus([database.status, redisHealth.status, ...queues.map((q) => q.status)]),
    checkedAt: new Date().toISOString(),
    database,
    redis: redisHealth,
    queues,
    processUptimeSeconds: Math.round(process.uptime()),
    nodeVersion: process.version,
  };
}

// Mapeamento de nome técnico de fila -> nome de componente apresentável, usado
// tanto no painel interno quanto (de forma ainda mais resumida) na página pública.
export const QUEUE_DISPLAY_NAMES: Record<string, string> = {
  [QUEUE_NAMES.WHATSAPP_NOTIFICATIONS]: "Notificações WhatsApp",
  [QUEUE_NAMES.FISCAL_EMISSION]: "Emissão fiscal (NFC-e/NFe)",
  [QUEUE_NAMES.NFE_XML_INGESTION]: "Importação de XML de NF-e",
  [QUEUE_NAMES.REPORT_GENERATION]: "Geração de relatórios",
  [QUEUE_NAMES.SUSPEND_OVERDUE_TENANTS]: "Suspensão de inadimplentes",
  [QUEUE_NAMES.PLUGGY_SYNC]: "Sincronização bancária (Open Finance)",
  [QUEUE_NAMES.LOYALTY_POINTS_EXPIRATION]: "Expiração de pontos de fidelidade",
  [QUEUE_NAMES.SCHEDULED_SUBSCRIPTION_CANCELLATIONS]: "Cancelamentos agendados",
  [QUEUE_NAMES.WEBHOOK_DELIVERY]: "Entrega de webhooks",
  [QUEUE_NAMES.PERSONAL_RECURRENCE_GENERATION]: "Recorrências (Filitech Pessoal)",
  [QUEUE_NAMES.PERSONAL_BILL_REMINDERS]: "Lembretes de contas (Filitech Pessoal)",
  [QUEUE_NAMES.DATA_EXPORT_GENERATION]: "Exportação de dados",
  [QUEUE_NAMES.DATA_IMPORT_VALIDATION]: "Validação de importação de dados",
  [QUEUE_NAMES.DATA_IMPORT_EXECUTION]: "Execução de importação de dados",
  [QUEUE_NAMES.DATABASE_BACKUP]: "Backup do banco de dados",
};

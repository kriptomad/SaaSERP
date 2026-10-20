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
import { getPlatformSecret } from "../../lib/platform-secrets";
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

// GAP DE AUDITORIA FECHADO (mega-audit round de 100%, criticidade MEDIA): o modelo
// `IncidentEvent` existia no schema desde o round anterior mas nunca era escrito
// nem lido em lugar nenhum do código — página de status pública não tinha histórico
// de incidentes/changelog, só o status instantâneo. `recordIncidentTransitions`
// persiste automaticamente abertura/resolução de incidente por componente sempre
// que o status muda, usando o próprio IncidentEvent (resolvedAt null = incidente
// aberto) como estado — nenhuma tabela nova precisa existir. Chamado uma única vez
// por refresh real do cache público (nunca por leitura do painel interno/SSE, que
// atualiza a cada 5s e duplicaria incidentes por condição de corrida).
export const INCIDENT_COMPONENTS = {
  DATABASE: "Banco de dados",
  REDIS: "Redis / Cache",
  BACKGROUND_JOBS: "Processamento em segundo plano (filas)",
} as const;

function incidentDescription(component: keyof typeof INCIDENT_COMPONENTS, status: ComponentStatus): string {
  const label = INCIDENT_COMPONENTS[component];
  if (status === "outage") return `${label} está indisponível.`;
  return `${label} está operando de forma degradada (latência elevada ou backlog acumulado).`;
}

export async function recordIncidentTransitions(snapshot: SystemStatusSnapshot): Promise<void> {
  const backgroundJobsStatus = worstStatus(snapshot.queues.map((q) => q.status));
  const componentStatuses: Array<[keyof typeof INCIDENT_COMPONENTS, ComponentStatus]> = [
    ["DATABASE", snapshot.database.status],
    ["REDIS", snapshot.redis.status],
    ["BACKGROUND_JOBS", backgroundJobsStatus],
  ];

  for (const [component, status] of componentStatuses) {
    const openIncident = await prisma.incidentEvent.findFirst({
      where: { component, resolvedAt: null },
      orderBy: { startedAt: "desc" },
    });

    if (status === "operational") {
      if (openIncident) {
        await prisma.incidentEvent.update({ where: { id: openIncident.id }, data: { resolvedAt: new Date() } });
      }
      continue;
    }

    const severity = status === "outage" ? "CRITICAL" : "WARNING";
    if (!openIncident) {
      await prisma.incidentEvent.create({
        data: { component, severity, description: incidentDescription(component, status) },
      });
    } else if (openIncident.severity !== severity) {
      // Agravou/melhorou dentro do mesmo incidente aberto (ex.: degraded -> outage)
      // — atualiza severidade/descrição no mesmo registro em vez de abrir um
      // segundo incidente simultâneo para o mesmo componente.
      await prisma.incidentEvent.update({
        where: { id: openIncident.id },
        data: { severity, description: incidentDescription(component, status) },
      });
    }
  }
}

export interface QueueHealth {
  name: string;
  status: ComponentStatus;
  waiting: number;
  active: number;
  failed: number;
  delayed: number;
}

export interface IntegrationReadiness {
  name: string;
  configured: boolean;
  /** Fontes presentes (painel admin / env var) que compõem a leitura "configured" acima. */
  detail: string;
}

export interface SystemStatusSnapshot {
  overallStatus: ComponentStatus;
  checkedAt: string;
  database: { status: ComponentStatus; latencyMs: number | null };
  redis: { status: ComponentStatus; latencyMs: number | null };
  queues: QueueHealth[];
  processUptimeSeconds: number;
  nodeVersion: string;
  integrations: IntegrationReadiness[];
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

// fa-w5-boot-optional-integrations-lazy-failure: expõe no painel interno (nunca na
// página pública de status) se cada integração opcional está de fato pronta para
// uso — hoje a única forma de descobrir isso era deixar um usuário real bater numa
// rota que depende da integração e observar o erro. Usa `getPlatformSecret` (não
// `process.env` direto) porque Stripe/Asaas/Pluggy/R2 podem estar configurados pelo
// painel admin (`PlatformSecret`, cifrado no banco) em vez de variável de ambiente —
// mesma fonte de verdade que o restante do código de billing/integrações usa.
async function checkIntegrationReadiness(): Promise<IntegrationReadiness[]> {
  const [
    stripeSecretKey,
    stripeWebhookSecret,
    asaasApiKey,
    asaasWebhookToken,
    pluggyClientId,
    pluggyClientSecret,
    r2AccountId,
    r2AccessKeyId,
    r2SecretAccessKey,
    r2BucketName,
  ] = await Promise.all([
    getPlatformSecret("STRIPE_SECRET_KEY"),
    getPlatformSecret("STRIPE_WEBHOOK_SECRET"),
    getPlatformSecret("ASAAS_API_KEY"),
    getPlatformSecret("ASAAS_WEBHOOK_TOKEN"),
    getPlatformSecret("PLUGGY_CLIENT_ID"),
    getPlatformSecret("PLUGGY_CLIENT_SECRET"),
    getPlatformSecret("R2_ACCOUNT_ID"),
    getPlatformSecret("R2_ACCESS_KEY_ID"),
    getPlatformSecret("R2_SECRET_ACCESS_KEY"),
    getPlatformSecret("R2_BUCKET_NAME"),
  ]);

  const stripeConfigured = Boolean(stripeSecretKey) && Boolean(stripeWebhookSecret);
  const asaasConfigured = Boolean(asaasApiKey) && Boolean(asaasWebhookToken);
  const pluggyConfigured = Boolean(pluggyClientId) && Boolean(pluggyClientSecret);
  const r2Configured = Boolean(r2AccountId) && Boolean(r2AccessKeyId) && Boolean(r2SecretAccessKey) && Boolean(r2BucketName);

  return [
    {
      name: "Stripe",
      configured: stripeConfigured,
      detail: stripeConfigured
        ? "Secret key + webhook secret configurados."
        : "Incompleto — falta secret key e/ou webhook secret (checkout Stripe indisponível).",
    },
    {
      name: "Asaas",
      configured: asaasConfigured,
      detail: asaasConfigured
        ? "API key + webhook token configurados."
        : "Incompleto — falta API key e/ou webhook token (checkout Asaas indisponível).",
    },
    {
      name: "Open Finance (Pluggy)",
      configured: pluggyConfigured,
      detail: pluggyConfigured
        ? "Client ID + client secret configurados."
        : "Não configurado — sincronização bancária automática indisponível.",
    },
    {
      name: "Object Storage (Cloudflare R2)",
      configured: r2Configured,
      detail: r2Configured
        ? "Credenciais + bucket configurados."
        : "Não configurado — upload de arquivos (avatares, fotos de O.S., XMLs fiscais) indisponível.",
    },
  ];
}

export async function getSystemStatusSnapshot(): Promise<SystemStatusSnapshot> {
  const [database, redisHealth, queues, integrations] = await Promise.all([
    checkDatabase(),
    checkRedis(),
    checkQueues(),
    checkIntegrationReadiness(),
  ]);

  return {
    overallStatus: worstStatus([database.status, redisHealth.status, ...queues.map((q) => q.status)]),
    checkedAt: new Date().toISOString(),
    database,
    redis: redisHealth,
    queues,
    processUptimeSeconds: Math.round(process.uptime()),
    nodeVersion: process.version,
    integrations,
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

// apps/api/src/workers/tenant-offboarding-purge.worker.ts
// fa-w6-bl-no-offboarding-retention — Antes deste worker, um tenant que entrasse em
// SUSPENDED (inadimplência definitiva — `handlePaymentFailure`/
// `suspend-overdue-tenants.worker.ts` — ou trial SaaS expirado —
// `trial-expiry-enforcement.worker.ts`) permanecia com TODOS os seus dados de
// negócio (PII de clientes, histórico fiscal etc.) vivos no banco
// INDEFINIDAMENTE: nenhum mecanismo de expurgo/anonimização de offboarding
// existia. Isto é DISTINTO do expurgo de artefato de exportação LGPD em
// `data-retention-purge.worker.ts` (escopo deliberadamente conservador, nunca toca
// dado de negócio nenhum — ver nota de design completa nesse arquivo) e do
// "direito à eliminação" sob pedido explícito do titular em
// `data-deletion-processing.worker.ts` (gated por aprovação manual de um OWNER,
// por `Client` individual).
//
// Varre diariamente tenants SUSPENDED cujo `purgeAt` (`suspendedAt` + grace period
// configurável via `TENANT_PURGE_GRACE_DAYS`, padrão 90 dias — `lib/tenant-purge.ts`)
// já passou e que ainda não tiveram o offboarding processado
// (`deletionRequestedAt IS NULL`). Mesma filosofia de
// `data-deletion-processing.worker.ts`: NUNCA apaga o tenant nem suas linhas — um
// hard-delete em cascata destruiria histórico financeiro/fiscal referenciado por
// FK em todo o sistema, violando a própria obrigação legal de guarda. Apenas
// ANONIMIZA o PII diretamente identificável dos `Client`s do tenant.
//
// GUARDA DE RETENÇÃO FISCAL: um tenant com QUALQUER `FiscalDocument` emitido nunca
// é anonimizado automaticamente aqui — o prazo legal de guarda de documento fiscal
// no Brasil (tipicamente 5+ anos) pode exceder em muito o grace period de
// offboarding, e decidir essa política de retenção por categoria fiscal
// unilateralmente aqui seria tão arriscado quanto seria em
// `data-retention-purge.worker.ts` (ver nota lá: prazo curto demais destruiria
// registro exigido por lei, de forma irreversível). Em vez de expurgar, apenas
// FLAGGEA o tenant para revisão manual (`TenantAuditLog`) e pula — o tenant
// continua elegível na mesma varredura seguinte (nunca marca
// `deletionRequestedAt` para um tenant pulado), para que um operador humano decida
// o que fazer sem perder a visibilidade do caso.
import { Worker, Job } from "bullmq";
import crypto from "node:crypto";
import { prismaUnscoped } from "@filitech/db";
import { queueRedisConnection, QUEUE_NAMES, tenantOffboardingPurgeQueue, DEFAULT_RECURRING_JOB_OPTS } from "../lib/queue";
import { writeTenantAuditLog } from "../lib/tenant-audit-log";
import { createModuleLogger } from "../lib/logger";

const log = createModuleLogger("tenant-offboarding-purge");

const REPEATABLE_JOB_NAME = "daily-sweep";
const DAILY_CRON_5AM = "0 5 * * *";

/** Mesmo placeholder determinístico/não reversível de `data-deletion-processing.worker.ts`. */
function anonymizedClientPlaceholder(clientId: string): { name: string } {
  const shortHash = crypto.createHash("sha256").update(clientId).digest("hex").slice(0, 10);
  return { name: `Cliente Anonimizado (${shortHash})` };
}

export async function tenantOffboardingPurgeProcessor(_job: Job): Promise<{ anonymizedTenants: number; flaggedForReview: number }> {
  const now = new Date();

  const eligibleTenants = await prismaUnscoped.tenant.findMany({
    where: { status: "SUSPENDED", purgeAt: { lte: now }, deletionRequestedAt: null },
    select: { id: true },
  });

  let anonymizedTenants = 0;
  let flaggedForReview = 0;

  for (const tenant of eligibleTenants) {
    try {
      const fiscalDocumentCount = await prismaUnscoped.fiscalDocument.count({ where: { tenantId: tenant.id } });
      if (fiscalDocumentCount > 0) {
        await writeTenantAuditLog({
          tenantId: tenant.id,
          action: "TENANT_OFFBOARDING_PURGE_SKIPPED_LEGAL_HOLD",
          targetType: "Tenant",
          targetId: tenant.id,
          outcome: "DENIED",
          metadata: {
            fiscalDocumentCount,
            reason: "tenant possui documento(s) fiscal(is) sujeito(s) a guarda legal — expurgo automático bloqueado, revisão manual necessária",
          },
        });
        flaggedForReview += 1;
        continue;
      }

      const clients = await prismaUnscoped.client.findMany({ where: { tenantId: tenant.id }, select: { id: true } });
      await prismaUnscoped.$transaction(async (tx) => {
        for (const client of clients) {
          const placeholder = anonymizedClientPlaceholder(client.id);
          await tx.client.update({
            where: { id: client.id },
            data: { name: placeholder.name, email: null, phone: null, document: null },
          });
        }
        await tx.tenant.update({ where: { id: tenant.id }, data: { deletionRequestedAt: now } });
      });

      await writeTenantAuditLog({
        tenantId: tenant.id,
        action: "TENANT_OFFBOARDING_PURGE_COMPLETED",
        targetType: "Tenant",
        targetId: tenant.id,
        outcome: "SUCCESS",
        metadata: { anonymizedClients: clients.length },
      });
      anonymizedTenants += 1;
    } catch (error) {
      log.error({ tenantId: tenant.id, err: error }, "falha ao processar expurgo/anonimização de offboarding do tenant — tentará de novo na próxima varredura");
    }
  }

  if (anonymizedTenants > 0 || flaggedForReview > 0) {
    log.info({ anonymizedTenants, flaggedForReview }, "varredura de expurgo/anonimização de offboarding de tenants concluída");
  }

  return { anonymizedTenants, flaggedForReview };
}

export function startTenantOffboardingPurgeWorker(): Worker {
  return new Worker(QUEUE_NAMES.TENANT_OFFBOARDING_PURGE, tenantOffboardingPurgeProcessor, {
    connection: queueRedisConnection,
    // Ação de alto risco (anonimização irreversível de PII) — mesmo princípio de
    // `data-deletion-processing.worker.ts`: nunca dois jobs desta fila em paralelo.
    concurrency: 1,
  });
}

export async function scheduleTenantOffboardingPurgeJob(): Promise<void> {
  await tenantOffboardingPurgeQueue.upsertJobScheduler(
    REPEATABLE_JOB_NAME,
    { pattern: DAILY_CRON_5AM },
    { name: REPEATABLE_JOB_NAME, opts: DEFAULT_RECURRING_JOB_OPTS },
  );
}

// apps/api/src/worker.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 3 — topologia "API Node.js xN | BullMQ Workers":
// processo Node.js dedicado, separado da API HTTP, que consome as filas BullMQ.
// Iniciado via `npm run worker` (ver package.json), nunca dentro do processo do Express.
import "dotenv/config";
import { startSuspendOverdueTenantsWorker, scheduleSuspendOverdueTenantsJob } from "./workers/suspend-overdue-tenants.worker";
import { startFiscalEmissionWorker } from "./workers/fiscal-emission.worker";
import { startWhatsAppNotificationsWorker } from "./workers/whatsapp-notifications.worker";
import { startPluggySyncWorker } from "./workers/pluggy-sync.worker";

async function main() {
  const suspendOverdueTenantsWorker = startSuspendOverdueTenantsWorker();
  await scheduleSuspendOverdueTenantsJob();
  const fiscalEmissionWorker = startFiscalEmissionWorker();
  const whatsappNotificationsWorker = startWhatsAppNotificationsWorker();
  const pluggySyncWorker = startPluggySyncWorker();

  for (const worker of [suspendOverdueTenantsWorker, fiscalEmissionWorker, whatsappNotificationsWorker, pluggySyncWorker]) {
    worker.on("completed", (job) => {
      // eslint-disable-next-line no-console
      console.log(`[worker:${job.queueName}] job ${job.id} concluído:`, job.returnvalue);
    });

    worker.on("failed", (job, error) => {
      // eslint-disable-next-line no-console
      console.error(`[worker:${job?.queueName}] job ${job?.id} falhou:`, error);
    });
  }

  // eslint-disable-next-line no-console
  console.log("[filitech-worker] processo de filas BullMQ iniciado.");
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("[filitech-worker] falha fatal na inicialização:", error);
  process.exit(1);
});

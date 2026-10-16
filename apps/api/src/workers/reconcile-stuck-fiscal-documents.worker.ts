// apps/api/src/workers/reconcile-stuck-fiscal-documents.worker.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 6.6/20.3 — rede de segurança para
// `FiscalDocument` que ficou travado em PENDING sem nunca ter um job de emissão
// enfileirado com sucesso (ex.: Redis momentaneamente fora do ar no exato instante
// do `enqueueFiscalEmission()` em close-sale.service.ts, e o PDV nunca repetiu a
// mesma requisição de fechamento de venda com a mesma chave de idempotência para
// acionar o caminho de replay). Sem esta varredura, o documento fiscal da venda
// ficaria PENDING para sempre — a venda em si já está completa (estoque baixado,
// pagamento registrado), só a nota fiscal nunca seria emitida.
//
// Reenfileirar é seguro mesmo se já existir um job anterior ainda rodando:
// `emitFiscalDocument()` é idempotente (retorna imediatamente se o documento já
// avançou para AUTHORIZED/CANCELLED) — na pior hipótese, dois jobs concorrentes
// leem o mesmo PENDING e um deles vence a corrida, o outro fica noop.
import { Worker, Job } from "bullmq";
import { prismaUnscoped } from "@filitech/db";
import { queueRedisConnection, QUEUE_NAMES, reconcileStuckFiscalDocumentsQueue } from "../lib/queue";
import { enqueueFiscalEmission } from "../modules/fiscal/queues/fiscal-emission.queue";
import { createModuleLogger } from "../lib/logger";

const REPEATABLE_JOB_NAME = "reconcile-stuck-fiscal-documents";
const EVERY_10_MINUTES_CRON = "*/10 * * * *";
// Margem de segurança: só considera "travado" um FiscalDocument PENDING criado há
// mais de 5 minutos — evita reenfileirar em cima de uma venda que acabou de fechar
// e cujo job original ainda está na fila/sendo processado normalmente.
const STUCK_THRESHOLD_MS = 5 * 60 * 1000;

const log = createModuleLogger("reconcile-stuck-fiscal-documents");

export async function reconcileStuckFiscalDocumentsProcessor(_job: Job): Promise<{ requeued: number }> {
  const threshold = new Date(Date.now() - STUCK_THRESHOLD_MS);

  const stuck = await prismaUnscoped.fiscalDocument.findMany({
    where: { status: "PENDING", createdAt: { lte: threshold } },
    select: { id: true, tenantId: true, saleId: true },
    take: 500, // teto por execução — próxima varredura (10 min depois) pega o restante
  });

  let requeued = 0;
  for (const doc of stuck) {
    try {
      await enqueueFiscalEmission({ fiscalDocumentId: doc.id, tenantId: doc.tenantId });
      requeued += 1;
    } catch (error) {
      log.error({ fiscalDocumentId: doc.id, saleId: doc.saleId, err: error }, "falha ao reenfileirar documento fiscal travado — tentará de novo na próxima varredura");
    }
  }

  if (requeued > 0) {
    log.warn({ requeued }, "documentos fiscais PENDING travados foram reenfileirados para emissão");
  }

  return { requeued };
}

export function startReconcileStuckFiscalDocumentsWorker(): Worker {
  return new Worker(QUEUE_NAMES.RECONCILE_STUCK_FISCAL_DOCUMENTS, reconcileStuckFiscalDocumentsProcessor, {
    connection: queueRedisConnection,
  });
}

export async function scheduleReconcileStuckFiscalDocumentsJob(): Promise<void> {
  await reconcileStuckFiscalDocumentsQueue.upsertJobScheduler(
    REPEATABLE_JOB_NAME,
    { pattern: EVERY_10_MINUTES_CRON },
    { name: REPEATABLE_JOB_NAME },
  );
}

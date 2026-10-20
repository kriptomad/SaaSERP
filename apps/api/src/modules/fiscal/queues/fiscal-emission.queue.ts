// apps/api/src/modules/fiscal/queues/fiscal-emission.queue.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 6.6/20.3 — enfileira a emissão fiscal real via
// Focus NFe em BullMQ, nunca síncrono dentro da transação de banco que fecha a venda
// (closeSale, Capítulo 6.6), para não segurar o lock de estoque esperando resposta de
// rede externa.
import { fiscalEmissionQueue } from "../../../lib/queue";

export interface EnqueueFiscalEmissionInput {
  fiscalDocumentId: string;
  tenantId: string;
  /** fa-w4-obs-no-request-id: id da requisição HTTP que originou este job (quando
   * aplicável — ex.: fechamento de venda via POST /sales), propagado para que o
   * worker (workers/fiscal-emission.worker.ts) e seus logs possam ser
   * correlacionados de volta à requisição original. Opcional: jobs enfileirados
   * fora de um contexto HTTP (ex.: reconcile-stuck-fiscal-documents.worker.ts) não
   * têm um requestId de origem. */
  requestId?: string;
}

export async function enqueueFiscalEmission(input: EnqueueFiscalEmissionInput): Promise<void> {
  await fiscalEmissionQueue.add(
    "emit-fiscal-document",
    { fiscalDocumentId: input.fiscalDocumentId, tenantId: input.tenantId, requestId: input.requestId },
    {
      attempts: 5,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: true,
    },
  );
}

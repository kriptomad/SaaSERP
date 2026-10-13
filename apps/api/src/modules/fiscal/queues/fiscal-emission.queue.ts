// apps/api/src/modules/fiscal/queues/fiscal-emission.queue.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 6.6/20.3 — enfileira a emissão fiscal real via
// Focus NFe em BullMQ, nunca síncrono dentro da transação de banco que fecha a venda
// (closeSale, Capítulo 6.6), para não segurar o lock de estoque esperando resposta de
// rede externa.
import { fiscalEmissionQueue } from "../../../lib/queue";

export interface EnqueueFiscalEmissionInput {
  fiscalDocumentId: string;
  tenantId: string;
}

export async function enqueueFiscalEmission(input: EnqueueFiscalEmissionInput): Promise<void> {
  await fiscalEmissionQueue.add(
    "emit-fiscal-document",
    { fiscalDocumentId: input.fiscalDocumentId, tenantId: input.tenantId },
    {
      attempts: 5,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: true,
    },
  );
}

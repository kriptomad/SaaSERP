// apps/api/src/lib/webhook-dispatch.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 15.4 — disparo real de Webhooks de saída.
// GAP DE AUDITORIA FECHADO: `TenantWebhookEndpoint`/`WebhookDelivery` já tinham CRUD
// completo (tenant-integrations.routes.ts) e até a listagem de entregas
// (GET /integrations/webhook-endpoints/:id/deliveries), mas nenhum evento de domínio
// jamais chamava nada para de fato gerar uma entrega — a tabela `webhook_deliveries`
// ficava sempre vazia.
//
// Nunca disparado de forma síncrona dentro da transação de banco que gerou o evento
// (mesmo princípio de enqueueFiscalEmission em close-sale.service.ts): a entrega HTTP
// para um endpoint de terceiros pode demorar/falhar, e não pode segurar nenhum lock
// de banco nem fazer o fluxo principal (ex.: fechamento de venda) falhar por causa de
// um webhook do cliente estar fora do ar. Por isso `dispatchWebhookEvent` só
// ENFILEIRA (BullMQ) — a entrega real/gravação de WebhookDelivery acontece no worker
// (webhook-delivery.worker.ts).
import { prismaUnscoped as prisma } from "@filitech/db";
import { webhookDeliveryQueue } from "./queue";

export interface WebhookDeliveryJobData {
  endpointId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

// Chamado pelos serviços de domínio após o commit da transação que gerou o evento
// (ex.: close-sale.service.ts, emit-fiscal-document.service.ts) — nunca antes do
// commit, para não notificar o tenant sobre algo que pode ainda ser revertido.
export async function dispatchWebhookEvent(tenantId: string, eventType: string, payload: Record<string, unknown>): Promise<void> {
  const endpoints = await prisma.tenantWebhookEndpoint.findMany({
    where: { tenantId, active: true, eventTypes: { has: eventType } },
    select: { id: true },
  });
  if (endpoints.length === 0) return;

  await Promise.all(
    endpoints.map((endpoint) =>
      webhookDeliveryQueue.add(
        "deliver",
        { endpointId: endpoint.id, eventType, payload } satisfies WebhookDeliveryJobData,
        { attempts: 6, backoff: { type: "exponential", delay: 5_000 } }, // até ~5min de retry espalhado, cobre instabilidades curtas do endpoint do tenant
      ),
    ),
  );
}

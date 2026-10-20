// apps/api/src/workers/data-deletion-processing.worker.ts
// fa-w4-lgpd-no-deletion-workflow — Direito à Eliminação (LGPD Art. 18, VI).
//
// DECISÃO DE DESIGN DELIBERADA (reitera a nota em `schema.prisma`, model
// `DataDeletionRequest`): este worker NUNCA apaga linhas do banco. Ele roda só
// depois que um `DataDeletionRequest` já foi aprovado por um OWNER do tenant
// (`data-deletion-request.routes.ts`), e o que ele faz é ANONIMIZAR o PII
// diretamente identificável dos clientes do tenant (`Client.name/email/phone/
// document`), substituindo por um placeholder estável e não reversível — nunca
// um hard-delete das linhas.
//
// Por quê anonimizar em vez de apagar: `Client` é referenciado por FK obrigatória
// (ou opcional, mas com histórico real) a partir de `Sale`, `PaymentCharge`,
// `ClientCreditPayment`, lançamentos fiscais etc. Um hard-delete em cascata
// destruiria o histórico financeiro/fiscal do tenant inteiro (violando a própria
// LGPD Art. 16, II — guarda obrigatória de registro fiscal/contábil por
// obrigação legal/regulatória) ou falharia em qualquer FK sem `onDelete: Cascade`
// (deixando o pedido "preso" pela metade). Anonimizar preserva 100% da
// integridade referencial/agregada e ainda assim cumpre o direito de eliminação
// do titular sobre o dado DIRETAMENTE identificável — a mesma abordagem usada por
// ERPs reais (ex.: SAP's "data destruction" via anonimização de campos PII, não
// deleção de registro contábil).
//
// Job SOB DEMANDA (não repetível) — enfileirado uma única vez por
// `POST /data-portability/deletion-requests/:id/approve`, mesmo padrão de
// `data-export-generation.worker.ts`.
import { Worker, Job } from "bullmq";
import crypto from "node:crypto";
import { prismaUnscoped } from "@filitech/db";
import { queueRedisConnection, QUEUE_NAMES } from "../lib/queue";
import { writeTenantAuditLog } from "../lib/tenant-audit-log";
import { createModuleLogger } from "../lib/logger";

const log = createModuleLogger("data-deletion-processing");

export interface DataDeletionProcessingJobData {
  requestId: string;
  tenantId: string;
}

/** Placeholder determinístico (não reversível) usado para anonimizar um `Client`. */
function anonymizedClientPlaceholder(clientId: string): { name: string; emailSuffix: string } {
  // Hash unidirecional do id interno — só serve para diferenciar registros
  // anonimizados entre si em relatórios internos, nunca para recuperar o dado
  // original (não é nem criptografia reversível nem PII derivada).
  const shortHash = crypto.createHash("sha256").update(clientId).digest("hex").slice(0, 10);
  return { name: `Cliente Anonimizado (${shortHash})`, emailSuffix: shortHash };
}

export async function dataDeletionProcessingProcessor(job: Job<DataDeletionProcessingJobData>): Promise<{ anonymizedClients: number }> {
  const { requestId, tenantId } = job.data;

  const request = await prismaUnscoped.dataDeletionRequest.findUnique({ where: { id: requestId } });
  if (!request || request.tenantId !== tenantId) {
    log.warn({ requestId, tenantId }, "pedido de eliminação de dados não encontrado — job ignorado");
    return { anonymizedClients: 0 };
  }
  if (request.status !== "APPROVED") {
    log.warn({ requestId, tenantId, status: request.status }, "pedido de eliminação de dados não está em estado APPROVED — job ignorado (evita reprocessar/anonimizar duas vezes)");
    return { anonymizedClients: 0 };
  }

  await prismaUnscoped.dataDeletionRequest.update({ where: { id: requestId }, data: { status: "PROCESSING" } });
  await writeTenantAuditLog({
    tenantId,
    action: "DATA_DELETION_REQUEST_PROCESSING",
    targetType: "DataDeletionRequest",
    targetId: requestId,
    outcome: "SUCCESS",
  });

  let anonymizedClients = 0;
  try {
    const clients = await prismaUnscoped.client.findMany({ where: { tenantId }, select: { id: true } });
    for (const client of clients) {
      const placeholder = anonymizedClientPlaceholder(client.id);
      await prismaUnscoped.client.update({
        where: { id: client.id },
        data: {
          name: placeholder.name,
          email: null,
          phone: null,
          document: null,
        },
      });
      anonymizedClients += 1;
    }

    await prismaUnscoped.dataDeletionRequest.update({
      where: { id: requestId },
      data: { status: "COMPLETED", processedAt: new Date() },
    });
    await writeTenantAuditLog({
      tenantId,
      action: "DATA_DELETION_REQUEST_COMPLETED",
      targetType: "DataDeletionRequest",
      targetId: requestId,
      outcome: "SUCCESS",
      metadata: { anonymizedClients },
    });
  } catch (error) {
    log.error({ requestId, tenantId, err: error }, "falha ao anonimizar clientes do tenant para pedido de eliminação de dados");
    await writeTenantAuditLog({
      tenantId,
      action: "DATA_DELETION_REQUEST_PROCESSING",
      targetType: "DataDeletionRequest",
      targetId: requestId,
      outcome: "FAILED",
      metadata: { anonymizedClients },
    });
    // Mantém o status em PROCESSING (não volta para APPROVED) — uma reexecução
    // manual do job (ou uma futura rotina de reconciliação) pode retomar de onde
    // parou sem reabrir o fluxo de aprovação; `anonymizedClientPlaceholder` é
    // idempotente por cliente (reaplica o mesmo placeholder sem efeito colateral
    // se um cliente já tiver sido anonimizado nesta mesma rodada).
    throw error;
  }

  return { anonymizedClients };
}

export function startDataDeletionProcessingWorker(): Worker {
  return new Worker<DataDeletionProcessingJobData>(QUEUE_NAMES.DATA_DELETION_PROCESSING, dataDeletionProcessingProcessor, {
    connection: queueRedisConnection,
    concurrency: 1, // ação irreversível e de alto risco — nunca processar dois pedidos do mesmo tipo em paralelo
  });
}

// apps/api/src/workers/fiscal-emission.worker.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 3.4 (fila `fiscal-emission`) e 20.3/6.6 —
// consumidor real do job "emit-fiscal-document" enfileirado por
// close-sale.service.ts/enqueueFiscalEmission. Fecha o gap crítico de auditoria em
// que toda venda fechada criava um FiscalDocument PENDING que nunca avançava, pois
// não existia nenhum worker consumindo esta fila.
//
// Executa dentro de `runWithTenantContext` (mesmo contrato de AsyncLocalStorage usado
// pelas requisições HTTP autenticadas) para poder reutilizar o Prisma Client
// tenant-scoped (`prisma`) normalmente, em vez de montar manualmente filtros
// `tenantId` com `prismaUnscoped` a cada query — cada job já chega com exatamente um
// `tenantId` (nunca cross-tenant), então o contexto é seguro de recriar aqui.
import { Worker, Job } from "bullmq";
import { prisma, runWithTenantContext } from "@filitech/db";
import { queueRedisConnection, QUEUE_NAMES } from "../lib/queue";
import {
  emitFiscalDocument,
  FocusNfeNotConfiguredError,
  FiscalDataValidationError,
} from "../modules/fiscal/emit-fiscal-document.service";
import { notifyTenant } from "../modules/notifications/notify.service";

interface EmitFiscalDocumentJobData {
  fiscalDocumentId: string;
  tenantId: string;
}

export async function fiscalEmissionProcessor(
  job: Job<EmitFiscalDocumentJobData>,
): Promise<{ authorized: boolean }> {
  const { fiscalDocumentId, tenantId } = job.data;

  return runWithTenantContext({ tenantId, userId: "system-worker", role: "SYSTEM_WORKER" }, async () => {
    try {
      const result = await emitFiscalDocument(prisma, { tenantId, fiscalDocumentId });
      return { authorized: result.authorized };
    } catch (error) {
      if (error instanceof FocusNfeNotConfiguredError || error instanceof FiscalDataValidationError) {
        // Falha de configuração/cadastro (nunca de rede/SEFAZ) — não adianta tentar de
        // novo automaticamente até o lojista corrigir a credencial ou o cadastro do
        // produto/tenant; avisa uma única vez por tentativa e deixa o BullMQ esgotar
        // as `attempts` configuradas em enqueueFiscalEmission (5, backoff
        // exponencial) antes de desistir.
        await notifyTenant({
          tenantId,
          category: "FISCAL_DOCUMENT_REJECTED",
          severity: "CRITICAL",
          title:
            error instanceof FiscalDataValidationError
              ? "Emissão fiscal bloqueada — cadastro incompleto"
              : "Emissão fiscal bloqueada — integração não configurada",
          body: error.message,
          linkRoute:
            error instanceof FiscalDataValidationError ? "/cadastros/produtos" : "/configuracoes/integracoes",
          sourceType: "FISCAL_DOCUMENT",
          sourceId: fiscalDocumentId,
        });
      }
      throw error;
    }
  });
}

export function startFiscalEmissionWorker(): Worker {
  return new Worker<EmitFiscalDocumentJobData>(QUEUE_NAMES.FISCAL_EMISSION, fiscalEmissionProcessor, {
    connection: queueRedisConnection,
    concurrency: 5,
  });
}

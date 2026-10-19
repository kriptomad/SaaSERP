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

// GAP DE COMPLIANCE CONHECIDO E DOCUMENTADO (fa-fiscal-no-formal-contingency):
// este worker NÃO implementa uma máquina de estados de contingência fiscal formal.
// Quando a SEFAZ (ou o provedor Focus NFe) está indisponível, o comportamento real
// hoje é: a transmissão falha → a exceção sobe → o BullMQ reagenda o job com
// backoff exponencial (5 tentativas, configuradas em
// close-sale.service.ts/enqueueFiscalEmission) → se todas as tentativas se
// esgotarem, o FiscalDocument permanece PENDING indefinidamente e o lojista é
// notificado apenas quando o erro é de configuração/cadastro (ver catch acima),
// NUNCA quando é uma indisponibilidade real de rede/SEFAZ prolongada.
//
// O que SERIA necessário para contingência fiscal formal (Ajuste SINIEF 07/05,
// Capítulo 21.14 da Bible) e que NÃO existe neste sistema:
//   1. Detecção de indisponibilidade prolongada da SEFAZ/provedor (não apenas erro
//      pontual) com um limiar de tempo real (ex.: SEFAZ fora do ar por >X min).
//   2. Emissão em contingência (EPEC para NF-e, ou modo offline específico da
//      NFC-e por UF) com impressão do DANFE/cupom em contingência.
//   3. Transmissão retroativa obrigatória assim que a SEFAZ volta, dentro do
//      prazo legal (geralmente 24h), com reconciliação de numeração.
//   4. Uma máquina de estados dedicada no `FiscalDocumentStatus` (hoje só tem
//      PENDING/AUTHORIZED/REJECTED/CANCELLED/NOT_CONTRACTED — faltam estados como
//      PENDING_CONTINGENCY/AWAITING_RETRANSMISSION) e um painel operacional para o
//      lojista saber que está vendendo em contingência.
//
// Esta é uma correção pontual de auditoria (fa-*) e NÃO o lugar para implementar
// esse motor do zero sem testar contra o ambiente de homologação real da SEFAZ —
// implementar parcialmente seria pior que não implementar (risco de o sistema
// "parecer" robusto a indisponibilidade quando não está). Este comentário formaliza
// o risco de compliance conhecido: enquanto a SEFAZ/Focus NFe estiver fora do ar por
// um período prolongado, vendas com documento fiscal obrigatório (NFC-e/NFS-e)
// ficarão com o FiscalDocument em PENDING sem contingência real, e a venda em si
// (Sale) NÃO é bloqueada pelo app hoje — exige um projeto dedicado para resolver
// (ver também a seção "Gaps de compliance conhecidos" no README.md raiz do repo).

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

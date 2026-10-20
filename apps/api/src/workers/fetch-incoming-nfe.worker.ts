// apps/api/src/workers/fetch-incoming-nfe.worker.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 21.19.4 — Manifestação do Destinatário:
// "Job automático diário consulta a Distribuição DFe por NSU incremental e, para cada
// NF-e de entrada ainda sem manifestação, cria automaticamente o evento
// CIENCIA_DA_OPERACAO".
//
// GAP DE AUDITORIA FECHADO: `FiscalDocumentType.NFE_ENTRADA` existia no schema desde
// o início mas nunca era instanciado por código nenhum — o tenant nunca tinha
// nenhuma visibilidade sobre as NF-e de compra emitidas contra o próprio CNPJ, e
// portanto nunca cumpria a obrigação legal de manifestação em até 180 dias (sob pena
// de ter o crédito de ICMS da operação impugnado).
//
// Contrato real confirmado via documentação oficial Focus NFe (doc.focusnfe.com.br):
//   GET https://api.focusnfe.com.br/v2/nfes_recebidas?cnpj={cnpj}&versao={versao}
//   Retorna até 100 notas por página; o cabeçalho `X-Max-Version` indica o maior
//   valor de versão disponível, usado como próximo cursor incremental
//   (`Tenant.incomingNfeLastVersion`) — nunca decrescido, nunca reprocessando o
//   histórico inteiro a cada execução.
import { Worker, Job } from "bullmq";
import { prisma, prismaUnscoped, runWithTenantContext } from "@filitech/db";
import { queueRedisConnection, QUEUE_NAMES, fetchIncomingNfeQueue, DEFAULT_RECURRING_JOB_OPTS } from "../lib/queue";
import { decryptFocusNfeCredential, resolveFocusNfeCredential } from "../modules/fiscal/focus-nfe-credential";
import { manifestRecipientOperation } from "../modules/fiscal/manifest-recipient.service";
import { withCircuitBreaker } from "../lib/circuit-breaker";
import { createModuleLogger } from "../lib/logger";

const log = createModuleLogger("fetch-incoming-nfe.worker");

const REPEATABLE_JOB_NAME = "daily-sweep";
// 05:00 — depois da varredura de inadimplência (03:00) e antes da geração mensal de
// tarefas contábeis (06:00 no dia 1), horário livre na grade de crons diários já
// existente (expire-loyalty-points roda às 04:00).
const DAILY_CRON_5AM = "0 5 * * *";

const FOCUS_NFE_BREAKER = "focus-nfe";

interface FocusNfeIncomingNote {
  chave_nfe: string;
  documento_emitente: string;
  nome_emitente: string;
  valor_total: string;
  data_emissao: string;
}

export async function fetchIncomingNfeProcessor(_job: Job): Promise<{ tenantsProcessed: number; notesCreated: number; manifestationErrors: number }> {
  const tenants = await prismaUnscoped.tenant.findMany({
    where: { tenantType: "BUSINESS", cnpj: { not: null }, status: { in: ["TRIAL", "ACTIVE", "PAST_DUE"] } },
    select: { id: true, cnpj: true, incomingNfeLastVersion: true, taxRegime: true },
  });

  let tenantsProcessed = 0;
  let notesCreated = 0;
  let manifestationErrors = 0;

  for (const tenant of tenants) {
    try {
      await runWithTenantContext({ tenantId: tenant.id, userId: "system-worker", role: "SYSTEM_WORKER" }, async () => {
        const credential = await resolveFocusNfeCredential(prisma, tenant.id);
        if (!credential) return; // Focus NFe não configurado para este tenant — sem o que consultar, nunca um erro (a maioria dos tenants legitimamente ainda não ativou a integração).

        const decrypted = decryptFocusNfeCredential(credential);
        const basicAuth = Buffer.from(`${decrypted.token}:`).toString("base64");

        const response = await withCircuitBreaker(FOCUS_NFE_BREAKER, () =>
          fetch(`https://api.focusnfe.com.br/v2/nfes_recebidas?cnpj=${encodeURIComponent(tenant.cnpj!)}&versao=${encodeURIComponent(tenant.incomingNfeLastVersion)}`, {
            headers: { Authorization: `Basic ${basicAuth}`, Accept: "application/json" },
          }),
        );

        if (!response.ok) {
          log.warn({ tenantId: tenant.id, status: response.status }, "falha ao consultar Distribuição DFe — tentativa adiada para a próxima varredura diária");
          return;
        }

        const notes = (await response.json().catch(() => [])) as FocusNfeIncomingNote[];
        const maxVersionHeader = response.headers.get("x-max-version");

        tenantsProcessed += 1;

        for (const note of notes) {
          // Idempotência: `FiscalDocument.accessKey` é `@unique` — uma nota já
          // capturada em execução anterior nunca é duplicada.
          const existing = await prisma.fiscalDocument.findUnique({ where: { accessKey: note.chave_nfe } });
          if (existing) continue;

          const supplier = await prisma.supplier.findFirst({ where: { tenantId: tenant.id, document: note.documento_emitente } });
          // Vincula ao pedido de compra em aberto mais recente do mesmo fornecedor —
          // por chave de acesso pré-registrada manualmente (match exato, prioridade
          // máxima) ou, na ausência dela, ao pedido SENT/PARTIALLY_RECEIVED mais
          // recente desse fornecedor (heurística documentada: nem toda compra tem um
          // PurchaseOrder formal no sistema, e mesmo quando tem, a vinculação por
          // chave de acesso só é possível se o lojista a digitou manualmente).
          const purchaseOrder = supplier
            ? ((await prisma.purchaseOrder.findFirst({ where: { tenantId: tenant.id, supplierId: supplier.id, supplierAccessKeyHint: note.chave_nfe } })) ??
              (await prisma.purchaseOrder.findFirst({
                where: { tenantId: tenant.id, supplierId: supplier.id, status: { in: ["SENT", "PARTIALLY_RECEIVED"] } },
                orderBy: { createdAt: "desc" },
              })))
            : null;

          const fiscalDocument = await prisma.fiscalDocument.create({
            data: {
              tenantId: tenant.id,
              type: "NFE_ENTRADA",
              status: "AUTHORIZED", // a nota já está autorizada pela SEFAZ do emitente — o tenant só a está recebendo/manifestando, nunca emitindo
              accessKey: note.chave_nfe,
              authorizedAt: new Date(note.data_emissao),
              emitterCnpj: note.documento_emitente,
              emitterName: note.nome_emitente,
              totalAmount: note.valor_total,
              supplierId: supplier?.id,
              purchaseOrderId: purchaseOrder?.id,
              // `taxRegimeSnapshot`/`faseReformaTributaria` são NOT NULL no schema e
              // descrevem o regime do EMITENTE da operação em todo documento SAÍDA —
              // aqui o tenant é o destinatário, então gravamos o próprio regime do
              // tenant apenas para satisfazer a restrição NOT NULL (nunca lido/usado
              // em cálculo tributário de um documento NFE_ENTRADA).
              taxRegimeSnapshot: tenant.taxRegime,
            },
          });
          notesCreated += 1;

          try {
            await manifestRecipientOperation(prisma, {
              tenantId: tenant.id,
              fiscalDocumentId: fiscalDocument.id,
              manifestationType: "CIENCIA_DA_OPERACAO",
            });
          } catch (manifestError) {
            // Falha ao transmitir a ciência (ex.: Focus NFe fora do ar) nunca deve
            // impedir a captura da nota em si — ela já foi persistida acima e a
            // próxima varredura diária pode tentar a manifestação novamente (o
            // estado PENDING do evento permite nova tentativa manual também).
            manifestationErrors += 1;
            log.error({ err: manifestError, tenantId: tenant.id, fiscalDocumentId: fiscalDocument.id }, "falha ao transmitir ciência automática da operação");
          }
        }

        if (maxVersionHeader) {
          await prisma.tenant.update({ where: { id: tenant.id }, data: { incomingNfeLastVersion: maxVersionHeader } });
        }
      });
    } catch (err) {
      log.error({ err, tenantId: tenant.id }, "falha ao processar Distribuição DFe do tenant");
    }
  }

  return { tenantsProcessed, notesCreated, manifestationErrors };
}

export function startFetchIncomingNfeWorker(): Worker {
  return new Worker(QUEUE_NAMES.FETCH_INCOMING_NFE, fetchIncomingNfeProcessor, { connection: queueRedisConnection });
}

export async function scheduleFetchIncomingNfeJob(): Promise<void> {
  await fetchIncomingNfeQueue.upsertJobScheduler(REPEATABLE_JOB_NAME, { pattern: DAILY_CRON_5AM }, { name: REPEATABLE_JOB_NAME, opts: DEFAULT_RECURRING_JOB_OPTS });
}

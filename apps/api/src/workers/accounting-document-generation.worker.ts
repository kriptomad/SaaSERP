// apps/api/src/workers/accounting-document-generation.worker.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 21.18.5/21.18.10/21.18.11 — geração real de
// documentos oficiais (ECD/DEFIS/ECF/EFD-Reinf/DCTFWeb/Informe de Rendimentos do Sócio).
// GAP DE AUDITORIA FECHADO (fa-perf-accounting-doc-generation-inline): a geração
// (incluindo upload para R2) rodava síncrona dentro de `POST
// /official-tax-documents/generate`, arriscando timeout/alto consumo de memória do
// processo HTTP para documentos grandes. Movido para fila BullMQ dedicada, mesmo
// padrão de infraestrutura de `workers/data-export-generation.worker.ts`: estado
// persistido no próprio registro de domínio (`OfficialTaxDocument.status`:
// PENDING -> PROCESSING -> GENERATED/DRAFT/FAILED), `prismaUnscoped` (worker roda fora
// de qualquer req.session) e nenhum rethrow após persistir FAILED.
import { Worker, Job } from "bullmq";
import { prismaUnscoped, runWithTenantContext } from "@filitech/db";
import { queueRedisConnection, QUEUE_NAMES } from "../lib/queue";
import { generateSpedEcd, generateDefis, NoActiveLayoutVersionError } from "../services/accounting-office/sped-ecd.service";
import {
  generateEcf,
  generateEfdReinf,
  generateDctfWeb,
  generateInformeRendimentosSocio,
  EcfNotApplicableError,
  NoPartnerPayoutsFoundError,
  EcfActivityType,
} from "../services/accounting-office/ecf-reinf-dctfweb.service";
import { putObjectDirect } from "../lib/object-storage";
import { notifyTenant } from "../modules/notifications/notify.service";
import { createModuleLogger } from "../lib/logger";

const log = createModuleLogger("accounting-document-generation.worker");

export interface AccountingDocumentGenerationJobData {
  documentId: string;
  ownerTenantId: string;
  documentType: "ECD" | "DEFIS" | "ECF" | "EFD_REINF" | "DCTFWEB" | "INFORME_RENDIMENTOS_SOCIO";
  calendarYear?: number;
  competencia?: string;
  activityType?: EcfActivityType;
  partnerId?: string;
  competenciaInicio: string;
  competenciaFim: string;
}

export async function accountingDocumentGenerationProcessor(job: Job<AccountingDocumentGenerationJobData>): Promise<{ status: string }> {
  const { documentId, ownerTenantId, documentType, calendarYear, competencia, activityType, partnerId } = job.data;
  const competenciaInicio = new Date(job.data.competenciaInicio);
  const competenciaFim = new Date(job.data.competenciaFim);

  await prismaUnscoped.officialTaxDocument.update({
    where: { id: documentId },
    data: { status: "PROCESSING" },
  });

  // As funções `generate*` usam o client Prisma tenant-scoped internamente (mesma
  // extensão de isolamento usada pelas rotas HTTP) — como o worker roda fora de
  // qualquer requisição autenticada (sem AsyncLocalStorage ambiente), o contexto de
  // tenant precisa ser recriado explicitamente aqui antes de chamá-las.
  return runWithTenantContext({ tenantId: ownerTenantId, userId: "system-worker", role: "OWNER" }, async () => {
    try {
      let content: string;
      let layoutVersion: string;
      let status: "GENERATED" | "DRAFT" = "GENERATED";

      if (documentType === "ECD") {
        const result = await generateSpedEcd(ownerTenantId, competenciaInicio, competenciaFim);
        content = result.content;
        layoutVersion = result.layoutVersion;
      } else if (documentType === "DEFIS") {
        const result = await generateDefis(ownerTenantId, calendarYear!);
        content = result.content;
        layoutVersion = result.layoutVersion;
      } else if (documentType === "ECF") {
        const result = await generateEcf(ownerTenantId, calendarYear!, activityType!);
        content = result.content;
        layoutVersion = result.layoutVersion;
      } else if (documentType === "EFD_REINF" || documentType === "DCTFWEB") {
        const result = documentType === "EFD_REINF" ? await generateEfdReinf(ownerTenantId, competencia!) : await generateDctfWeb(ownerTenantId, competencia!);
        content = result.content;
        layoutVersion = result.layoutVersion;
        // Ambos carregam campos de "código de receita" pendentes de confirmação do
        // contador junto à tabela vigente da RFB (ver cabeçalho de
        // ecf-reinf-dctfweb.service.ts) — nasce DRAFT, nunca GENERATED, até revisão humana.
        status = "DRAFT";
      } else {
        // INFORME_RENDIMENTOS_SOCIO — documento interno, sem leiaute SPED/transmissão a
        // órgão (ver comentário do enum OfficialTaxDocumentType), por isso não chama
        // `resolveActiveLayoutVersion`.
        const result = await generateInformeRendimentosSocio(ownerTenantId, partnerId!, calendarYear!);
        content = result.content;
        layoutVersion = "INTERNO — SEM LEIAUTE SPED (documento entregue ao sócio para sua própria DIRPF)";
      }

      const fileName = `${documentType}-${competenciaInicio.toISOString().slice(0, 10)}-${competenciaFim.toISOString().slice(0, 10)}.txt`;
      const { storageKey } = await putObjectDirect({
        tenantId: ownerTenantId,
        category: "official-tax-documents",
        fileName,
        mimeType: "text/plain",
        body: content,
      });

      await prismaUnscoped.officialTaxDocument.update({
        where: { id: documentId },
        data: { layoutVersion, fileUrl: storageKey, status },
      });

      await notifyTenant({
        tenantId: ownerTenantId,
        category: "SYSTEM_ANNOUNCEMENT",
        severity: "INFO",
        title: "Documento fiscal gerado",
        body: `O documento ${documentType} foi gerado com sucesso e já está disponível para download.`,
        linkRoute: "/contabilidade/documentos-oficiais",
        sourceType: "OFFICIAL_TAX_DOCUMENT",
        sourceId: documentId,
      });

      return { status };
    } catch (error) {
      let failureReason = (error as Error).message;
      if (error instanceof NoActiveLayoutVersionError) failureReason = error.message;
      else if (error instanceof EcfNotApplicableError) failureReason = error.message;
      else if (error instanceof NoPartnerPayoutsFoundError) failureReason = error.message;

      await prismaUnscoped.officialTaxDocument.update({
        where: { id: documentId },
        data: { status: "FAILED", failureReason },
      });

      await notifyTenant({
        tenantId: ownerTenantId,
        category: "SYSTEM_ANNOUNCEMENT",
        severity: "WARNING",
        title: "Falha ao gerar documento fiscal",
        body: `Não foi possível gerar o documento ${documentType}: ${failureReason}.`,
        linkRoute: "/contabilidade/documentos-oficiais",
        sourceType: "OFFICIAL_TAX_DOCUMENT",
        sourceId: documentId,
      });

      // Não relança o erro: a geração é sob demanda (attempts:1, sem retry
      // automático), o estado FAILED já foi persistido acima, e o processo do worker
      // nunca deve cair por causa de uma falha de geração de documento fiscal de um
      // único tenant — mesmo padrão de `dataExportGenerationProcessor`.
      log.error({ documentId, ownerTenantId, documentType, err: error }, "geração de documento fiscal oficial falhou");
      return { status: "FAILED" };
    }
  });
}

export function startAccountingDocumentGenerationWorker(): Worker {
  return new Worker<AccountingDocumentGenerationJobData>(QUEUE_NAMES.ACCOUNTING_DOCUMENT_GENERATION, accountingDocumentGenerationProcessor, {
    connection: queueRedisConnection,
    concurrency: 2, // pode envolver geração de arquivos SPED grandes — mesma concorrência baixa de data-export-generation
  });
}

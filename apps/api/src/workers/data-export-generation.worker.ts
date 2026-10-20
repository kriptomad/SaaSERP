// apps/api/src/workers/data-export-generation.worker.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 18.4 — Portabilidade Total de Dados: job
// assíncrono (fila `data-export-generation`, não repetível — um job por pedido de
// exportação) que gera o ZIP completo de um tenant: um CSV por modelo tenant-scoped,
// os XMLs fiscais e fotos de O.S. reais do Cloudflare R2, e um `schema-reference.json`
// descrevendo a estrutura de cada CSV. Disponível em TODOS os planos, inclusive o
// Tier Free (Capítulo 18.4, texto integral) — por isso nenhuma checagem de módulo
// pago é feita aqui, deliberadamente.
//
// Usa `prismaUnscoped` + a mesma lista `TENANT_SCOPED_MODELS` da extensão de
// isolamento (Capítulo 7.2) como fonte única de verdade de "quais modelos pertencem a
// este tenant", em vez de manter uma segunda lista manual — qualquer modelo
// adicionado/removido daquela lista automaticamente entra/sai desta exportação.
import { Worker, Job } from "bullmq";
import archiver from "archiver";
import { PassThrough, Readable } from "node:stream";
import crypto from "node:crypto";
import { Prisma, prismaUnscoped, TENANT_SCOPED_MODELS } from "@filitech/db";
import { queueRedisConnection, QUEUE_NAMES } from "../lib/queue";
import { putObjectStream, getObjectStream } from "../lib/object-storage";
import { notifyTenant } from "../modules/notifications/notify.service";
import { createModuleLogger } from "../lib/logger";
import { writeTenantAuditLog } from "../lib/tenant-audit-log";

const log = createModuleLogger("data-export-generation.worker");

const PAGE_SIZE = 1000; // linhas por página — nunca um findMany sem skip/take (Capítulo 18.4)
const FILE_BATCH_SIZE = 100; // XMLs/fotos baixados do R2 por lote, mesmo princípio de paginação

interface DataExportGenerationJobData {
  jobId: string;
  tenantId: string;
  /** fa-w4-obs-no-request-id — opcional, só para correlação de log (ver
   * modules/data-portability/data-export.routes.ts). */
  requestId?: string;
}

function toPascalCaseModelName(modelName: string): string {
  return modelName;
}

function toLowerCamelDelegateName(modelName: string): string {
  return modelName.charAt(0).toLowerCase() + modelName.slice(1);
}

/**
 * Serializa um valor de célula para CSV. Heurística para `Prisma.Decimal`/`Buffer`
 * (objetos com `toFixed`/`toString` próprio): usa a representação textual direta em
 * vez de `JSON.stringify`, que produziria uma string já entre aspas e quebraria a
 * lógica de aspas abaixo (dupla-escapada). Campos `Json` arbitrários (sem esse
 * formato) caem no `JSON.stringify` genérico.
 */
function csvEscapeValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  let str: string;
  if (value instanceof Date) {
    str = value.toISOString();
  } else if (typeof value === "object") {
    const maybeDecimalOrBuffer = value as { toFixed?: unknown; toNumber?: unknown };
    str = typeof maybeDecimalOrBuffer.toFixed === "function" || typeof maybeDecimalOrBuffer.toNumber === "function" ? String(value) : JSON.stringify(value);
  } else {
    str = String(value);
  }
  if (/[",\n\r]/.test(str)) {
    str = `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function rowsToCsvChunk(rows: Array<Record<string, unknown>>, columns: string[], includeHeader: boolean): string {
  const lines: string[] = [];
  if (includeHeader) {
    lines.push(columns.map((c) => csvEscapeValue(c)).join(","));
  }
  for (const row of rows) {
    lines.push(columns.map((c) => csvEscapeValue(row[c])).join(","));
  }
  return lines.length > 0 ? lines.join("\r\n") + "\r\n" : "";
}

/** Colunas do modelo via DMMF do Prisma — fonte estável mesmo quando a tabela está
 * vazia no tenant (não dá pra derivar colunas de `Object.keys(primeiraLinha)` nesse caso). */
function getModelColumns(modelName: string): string[] {
  const model = Prisma.dmmf.datamodel.models.find((m) => m.name === modelName);
  if (!model) return [];
  return model.fields.filter((f) => f.kind !== "object").map((f) => f.name);
}

/**
 * fa-w4-export-worker-oom — fábrica de um `Readable` que produz o CSV de um modelo
 * EM STREAM (página a página, nunca o CSV inteiro concatenado em uma única string
 * antes de entrar no ZIP, como a versão anterior fazia). `stats.rowCount` é
 * preenchido como efeito colateral, só seguro de ler depois que `archive.finalize()`
 * resolver (momento em que TODAS as entradas, inclusive as baseadas em stream, já
 * foram completamente lidas pelo `archiver`).
 *
 * Um erro de banco no meio da paginação NUNCA pode derrubar o ZIP inteiro (um
 * `archive.on("error")` abortaria a exportação completa por causa de um único
 * modelo) — por isso o erro é capturado AQUI DENTRO do gerador (mesmo princípio do
 * `try/catch` por modelo da versão anterior), fechando o stream normalmente com o
 * que já foi produzido até então em vez de propagar a exceção para o `archiver`.
 */
function makeCsvEntryStream(
  modelName: string,
  fetchPage: (skip: number, take: number) => Promise<Array<Record<string, unknown>>>,
  columns: string[],
  stats: { rowCount: number },
): Readable {
  async function* generate(): AsyncGenerator<string> {
    let skip = 0;
    let headerWritten = false;
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const page = await fetchPage(skip, PAGE_SIZE);
        if (page.length === 0) break;
        yield rowsToCsvChunk(page, columns, !headerWritten);
        headerWritten = true;
        stats.rowCount += page.length;
        skip += PAGE_SIZE;
        if (page.length < PAGE_SIZE) break;
      }
      if (!headerWritten) {
        // Tabela vazia para este tenant — ainda assim grava o cabeçalho, para o CSV
        // nunca ficar vazio/sem colunas (facilita a reimportação em outro sistema).
        yield rowsToCsvChunk([], columns, true);
      }
    } catch (error) {
      log.error({ modelName, err: error }, "falha ao exportar modelo para CSV, incluindo parcial/vazio e seguindo para os demais");
      if (!headerWritten) {
        yield rowsToCsvChunk([], columns, true);
      }
    }
  }
  return Readable.from(generate());
}

function tenantScopedCsvEntry(tenantId: string, modelName: string, stats: { rowCount: number }): { stream: Readable; columns: string[] } {
  const delegateName = toLowerCamelDelegateName(toPascalCaseModelName(modelName));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const delegate = (prismaUnscoped as any)[delegateName];
  const columns = getModelColumns(modelName);
  const stream = makeCsvEntryStream(
    modelName,
    (skip, take) => delegate.findMany({ where: { tenantId }, skip, take, orderBy: { id: "asc" } }),
    columns,
    stats,
  );
  return { stream, columns };
}

// fa-w4-lgpd-export-incomplete-graph — modelos que NÃO possuem coluna tenantId
// própria (ver as notas "CORREÇÃO DE AUDITORIA" correspondentes em
// `packages/db/src/prisma-tenant-extension.ts`, de onde esta lista foi extraída
// 1:1) e por isso ficam fora de `TENANT_SCOPED_MODELS`/do loop acima — mas ainda
// assim são dado pessoal/transacional do tenant, herdado via relação com um
// modelo pai que ESTE SIM possui tenantId. Sem esta segunda passada, o ZIP de
// portabilidade (Capítulo 18.4) ficava incompleto: um titular de dados pedindo
// "todos os meus dados" nunca recebia, por exemplo, o histórico de mensagens de
// suporte que ele mesmo escreveu, ou o parcelamento das próprias dívidas pessoais.
// `relationField` é o nome do campo de relação (não a coluna FK escalar) usado
// para filtrar por `{ [relationField]: { tenantId } }` — um join implícito do
// Prisma, não uma segunda query manual por tenantId.
const RELATION_OWNED_MODELS: ReadonlyArray<{ modelName: string; relationField: string }> = [
  { modelName: "BillingEvent", relationField: "subscription" },
  { modelName: "CashRegisterMovement", relationField: "cashRegister" },
  { modelName: "SupportTicketMessage", relationField: "ticket" },
  { modelName: "PersonalTransactionSplit", relationField: "transaction" },
  { modelName: "PersonalInvestmentPriceHistory", relationField: "investment" },
  { modelName: "PersonalDebtInstallment", relationField: "debt" },
  { modelName: "LoyaltyTransaction", relationField: "loyaltyAccount" },
  { modelName: "OnlineOrderItem", relationField: "onlineOrder" },
  { modelName: "InventoryCountItem", relationField: "inventoryCount" },
];

/** Mesmo princípio de `tenantScopedCsvEntry`, mas filtrando por tenant através da
 * relação com o modelo pai (`where: { [relationField]: { tenantId } }`) em vez de
 * uma coluna `tenantId` direta, que este modelo não possui. */
function relationOwnedCsvEntry(
  tenantId: string,
  modelName: string,
  relationField: string,
  stats: { rowCount: number },
): { stream: Readable; columns: string[] } {
  const delegateName = toLowerCamelDelegateName(toPascalCaseModelName(modelName));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const delegate = (prismaUnscoped as any)[delegateName];
  const columns = getModelColumns(modelName);
  const stream = makeCsvEntryStream(
    modelName,
    (skip, take) => delegate.findMany({ where: { [relationField]: { tenantId } }, skip, take, orderBy: { id: "asc" } }),
    columns,
    stats,
  );
  return { stream, columns };
}

/**
 * Empacota, em lotes, os binários do R2 referenciados por uma coluna de storageKey —
 * EM STREAM (`getObjectStream`): cada arquivo flui diretamente do R2 para dentro do
 * ZIP sendo montado, nunca é baixado inteiro para um `Buffer` em memória primeiro
 * (fa-w4-export-worker-oom).
 */
async function bundleStorageFiles(
  archive: archiver.Archiver,
  tenantId: string,
  modelDelegateName: string,
  storageKeyColumn: string,
  zipFolder: string,
  extension: string,
): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const delegate = (prismaUnscoped as any)[modelDelegateName];
  let skip = 0;
  let bundled = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const page: Array<Record<string, unknown>> = await delegate.findMany({
      where: { tenantId, [storageKeyColumn]: { not: null } },
      skip,
      take: FILE_BATCH_SIZE,
      orderBy: { id: "asc" },
      select: { id: true, [storageKeyColumn]: true },
    });
    if (page.length === 0) break;
    for (const row of page) {
      const storageKey = row[storageKeyColumn] as string | null;
      if (!storageKey) continue;
      try {
        const stream = await getObjectStream(storageKey);
        archive.append(stream, { name: `${zipFolder}/${row.id}${extension}` });
        bundled++;
      } catch (error) {
        // Objeto ausente/corrompido no R2 nunca pode derrubar a exportação inteira —
        // loga e segue para o próximo arquivo.
        log.error({ tenantId, storageKey, err: error }, "falha ao empacotar arquivo do R2 na exportação");
      }
    }
    skip += FILE_BATCH_SIZE;
    if (page.length < FILE_BATCH_SIZE) break;
  }
  return bundled;
}

export async function dataExportGenerationProcessor(job: Job<DataExportGenerationJobData>): Promise<{ resultStorageKey: string }> {
  const { jobId, tenantId } = job.data;

  const exportJob = await prismaUnscoped.tenantDataExportJob.update({
    where: { id: jobId },
    data: { status: "GENERATING", processingStartedAt: new Date() },
    select: { requestedByUserId: true },
  });

  try {
    // fa-w4-export-worker-oom — pipeline em stream: o `archiver` grava direto num
    // `PassThrough` que é consumido pelo upload multipart (`putObjectStream`) — em
    // nenhum momento o ZIP completo existe como um único `Buffer` na memória do
    // processo (ao contrário da versão anterior, que acumulava TODOS os chunks do
    // ZIP e só então fazia `Buffer.concat` + um único `PutObjectCommand`).
    const archive = archiver("zip", { zlib: { level: 9 } });
    const uploadPassThrough = new PassThrough();
    archive.on("error", (err) => uploadPassThrough.destroy(err));
    archive.pipe(uploadPassThrough);
    const uploadPromise = putObjectStream({
      tenantId,
      category: "data-export",
      fileName: `export-${tenantId}-${Date.now()}.zip`,
      mimeType: "application/zip",
      body: uploadPassThrough,
    });

    const pendingStats: Array<{ modelName: string; columns: string[]; stats: { rowCount: number } }> = [];

    for (const modelName of TENANT_SCOPED_MODELS) {
      try {
        const stats = { rowCount: 0 };
        const { stream, columns } = tenantScopedCsvEntry(tenantId, modelName, stats);
        archive.append(stream, { name: `tabelas/${modelName}.csv` });
        pendingStats.push({ modelName, columns, stats });
      } catch (error) {
        // Um modelo com schema inesperado (ex.: delegate inexistente por erro de
        // digitação futuro na lista) nunca pode derrubar a exportação inteira dos
        // demais ~90 modelos — loga e segue, o modelo simplesmente fica fora do ZIP.
        log.error({ tenantId, modelName, err: error }, "falha ao preparar exportação de modelo para CSV, pulando");
      }
    }

    // fa-w4-lgpd-export-incomplete-graph — segunda passada para os modelos que
    // herdam o tenant via relação (ver `RELATION_OWNED_MODELS` acima), que ficavam
    // de fora do ZIP sem esta passada.
    for (const { modelName, relationField } of RELATION_OWNED_MODELS) {
      try {
        const stats = { rowCount: 0 };
        const { stream, columns } = relationOwnedCsvEntry(tenantId, modelName, relationField, stats);
        archive.append(stream, { name: `tabelas/${modelName}.csv` });
        pendingStats.push({ modelName, columns, stats });
      } catch (error) {
        log.error({ tenantId, modelName, err: error }, "falha ao preparar exportação de modelo (relation-owned) para CSV, pulando");
      }
    }

    // Documentos fiscais (XMLs) e fotos de O.S./avaria reais do R2 (Capítulo 18.4,
    // texto integral) — além das linhas em CSV (que já incluem `xmlStorageKey`/
    // `storageKey` como texto), o binário real é baixado e incluído no ZIP.
    const xmlCount = await bundleStorageFiles(archive, tenantId, "fiscalDocument", "xmlStorageKey", "documentos-fiscais", ".xml");
    const photoCount = await bundleStorageFiles(archive, tenantId, "osPhoto", "storageKey", "fotos-os", ".jpg");

    // `archive.finalize()` só resolve depois que TODAS as entradas (inclusive as
    // baseadas em stream acima) terminaram de ser lidas e gravadas no ZIP — só então
    // é seguro ler `stats.rowCount` de cada entrada abaixo.
    await archive.finalize();

    const schemaReference: Record<string, { columns: string[]; rowCount: number }> = {};
    for (const { modelName, columns, stats } of pendingStats) {
      schemaReference[modelName] = { columns, rowCount: stats.rowCount };
    }

    archive.append(
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          tenantId,
          models: schemaReference,
          bundledFiles: { documentosFiscais: xmlCount, fotosOs: photoCount },
        },
        null,
        2,
      ),
      { name: "schema-reference.json" },
    );

    const { storageKey } = await uploadPromise;

    await prismaUnscoped.tenantDataExportJob.update({
      where: { id: jobId },
      data: { status: "COMPLETED", resultStorageKey: storageKey, completedAt: new Date() },
    });

    await notifyTenant({
      tenantId,
      category: "SYSTEM_ANNOUNCEMENT",
      severity: "INFO",
      title: "Exportação de dados concluída",
      body: "Seu pacote com todos os dados do sistema está pronto para download em Configurações → Dados.",
      linkRoute: "/configuracoes/dados",
      sourceType: "TENANT_DATA_EXPORT_JOB",
      sourceId: jobId,
    });

    // fa-w4-lgpd-portability-no-audit-log
    await writeTenantAuditLog({
      tenantId,
      userId: exportJob.requestedByUserId,
      action: "DATA_EXPORT_GENERATION_COMPLETED",
      targetType: "TenantDataExportJob",
      targetId: jobId,
      outcome: "SUCCESS",
      metadata: { storageKey, modelsExported: Object.keys(schemaReference).length },
    });

    return { resultStorageKey: storageKey };
  } catch (error) {
    // fa-w4-export-failure-leaks-internal-error: o erro real (que pode conter
    // chave de storage, trecho de SQL, mensagem de provedor/R2 etc.) NUNCA é
    // enviado ao tenant — fica só no log estruturado do servidor, correlacionado
    // por `correlationId`. O tenant recebe uma mensagem genérica + esse mesmo id,
    // que ele pode citar ao abrir um chamado de suporte.
    const correlationId = crypto.randomUUID();
    log.error({ tenantId, jobId, correlationId, err: error }, "geração de exportação de dados falhou");

    const failureReason = `Falha interna (ref: ${correlationId}). Detalhes registrados internamente para a equipe de suporte.`;
    await prismaUnscoped.tenantDataExportJob.update({
      where: { id: jobId },
      data: { status: "FAILED", failureReason },
    });

    await notifyTenant({
      tenantId,
      category: "SYSTEM_ANNOUNCEMENT",
      severity: "WARNING",
      title: "Falha na exportação de dados",
      body: `Não foi possível gerar seu pacote de exportação. Nossa equipe foi notificada. Caso precise abrir um chamado de suporte, informe esta referência: ${correlationId}. Tente novamente em Configurações → Dados.`,
      linkRoute: "/configuracoes/dados",
      sourceType: "TENANT_DATA_EXPORT_JOB",
      sourceId: jobId,
    });

    // fa-w4-lgpd-portability-no-audit-log
    await writeTenantAuditLog({
      tenantId,
      userId: exportJob.requestedByUserId,
      action: "DATA_EXPORT_GENERATION_FAILED",
      targetType: "TenantDataExportJob",
      targetId: jobId,
      outcome: "FAILED",
      metadata: { correlationId },
    });

    // Não relança o erro: o job BullMQ é sob demanda (sem retry automático
    // configurado em enqueue), e o estado FAILED já foi persistido acima — relançar
    // aqui só faria o BullMQ marcar o job como "failed" redundantemente sem
    // nenhum benefício, e o processo do worker nunca deve cair por causa disso
    // (o `log.error` com o erro completo já foi emitido acima, junto do correlationId).
    return { resultStorageKey: "" };
  }
}

export function startDataExportGenerationWorker(): Worker {
  return new Worker<DataExportGenerationJobData>(QUEUE_NAMES.DATA_EXPORT_GENERATION, dataExportGenerationProcessor, {
    connection: queueRedisConnection,
    concurrency: 2, // gera ZIPs potencialmente grandes — concorrência baixa para não estourar memória do processo worker
  });
}

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
import { PassThrough } from "node:stream";
import { Prisma, prismaUnscoped, TENANT_SCOPED_MODELS } from "@filitech/db";
import { queueRedisConnection, QUEUE_NAMES } from "../lib/queue";
import { putObjectDirect, getObjectDirect } from "../lib/object-storage";
import { notifyTenant } from "../modules/notifications/notify.service";
import { createModuleLogger } from "../lib/logger";

const log = createModuleLogger("data-export-generation.worker");

const PAGE_SIZE = 1000; // linhas por página — nunca um findMany sem skip/take (Capítulo 18.4)
const FILE_BATCH_SIZE = 100; // XMLs/fotos baixados do R2 por lote, mesmo princípio de paginação

interface DataExportGenerationJobData {
  jobId: string;
  tenantId: string;
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

function createZipCollector(): { archive: archiver.Archiver; done: Promise<Buffer> } {
  const archive = archiver("zip", { zlib: { level: 9 } });
  const chunks: Buffer[] = [];
  const passThrough = new PassThrough();
  passThrough.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    passThrough.on("end", () => resolve(Buffer.concat(chunks)));
    archive.on("error", (err) => reject(err));
    passThrough.on("error", (err) => reject(err));
  });
  archive.pipe(passThrough);
  return { archive, done };
}

/** Exporta um único modelo tenant-scoped em CSV, paginado (nunca um findMany sem limite). */
async function exportModelToCsv(tenantId: string, modelName: string): Promise<{ csv: string; columns: string[]; rowCount: number }> {
  const delegateName = toLowerCamelDelegateName(toPascalCaseModelName(modelName));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const delegate = (prismaUnscoped as any)[delegateName];
  const columns = getModelColumns(modelName);

  let csv = "";
  let skip = 0;
  let rowCount = 0;
  let headerWritten = false;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const page: Array<Record<string, unknown>> = await delegate.findMany({
      where: { tenantId },
      skip,
      take: PAGE_SIZE,
      orderBy: { id: "asc" },
    });
    if (page.length === 0) break;
    csv += rowsToCsvChunk(page, columns, !headerWritten);
    headerWritten = true;
    rowCount += page.length;
    skip += PAGE_SIZE;
    if (page.length < PAGE_SIZE) break;
  }
  if (!headerWritten) {
    // Tabela vazia para este tenant — ainda assim grava o cabeçalho, para o CSV
    // nunca ficar vazio/sem colunas (facilita a reimportação em outro sistema).
    csv = rowsToCsvChunk([], columns, true);
  }
  return { csv, columns, rowCount };
}

/** Baixa e empacota, em lotes, os binários do R2 referenciados por uma coluna de storageKey. */
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
        const buffer = await getObjectDirect(storageKey);
        archive.append(buffer, { name: `${zipFolder}/${row.id}${extension}` });
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

  await prismaUnscoped.tenantDataExportJob.update({
    where: { id: jobId },
    data: { status: "GENERATING" },
  });

  try {
    const { archive, done } = createZipCollector();
    const schemaReference: Record<string, { columns: string[]; rowCount: number }> = {};

    for (const modelName of TENANT_SCOPED_MODELS) {
      try {
        const { csv, columns, rowCount } = await exportModelToCsv(tenantId, modelName);
        archive.append(csv, { name: `tabelas/${modelName}.csv` });
        schemaReference[modelName] = { columns, rowCount };
      } catch (error) {
        // Um modelo com schema inesperado (ex.: delegate inexistente por erro de
        // digitação futuro na lista) nunca pode derrubar a exportação inteira dos
        // demais ~90 modelos — loga e segue, o modelo simplesmente fica fora do ZIP.
        log.error({ tenantId, modelName, err: error }, "falha ao exportar modelo para CSV, pulando");
      }
    }

    // Documentos fiscais (XMLs) e fotos de O.S./avaria reais do R2 (Capítulo 18.4,
    // texto integral) — além das linhas em CSV (que já incluem `xmlStorageKey`/
    // `storageKey` como texto), o binário real é baixado e incluído no ZIP.
    const xmlCount = await bundleStorageFiles(archive, tenantId, "fiscalDocument", "xmlStorageKey", "documentos-fiscais", ".xml");
    const photoCount = await bundleStorageFiles(archive, tenantId, "osPhoto", "storageKey", "fotos-os", ".jpg");

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

    await archive.finalize();
    const zipBuffer = await done;

    const { storageKey } = await putObjectDirect({
      tenantId,
      category: "data-export",
      fileName: `export-${tenantId}-${Date.now()}.zip`,
      mimeType: "application/zip",
      body: zipBuffer,
    });

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

    return { resultStorageKey: storageKey };
  } catch (error) {
    const failureReason = (error as Error).message;
    await prismaUnscoped.tenantDataExportJob.update({
      where: { id: jobId },
      data: { status: "FAILED", failureReason },
    });

    await notifyTenant({
      tenantId,
      category: "SYSTEM_ANNOUNCEMENT",
      severity: "WARNING",
      title: "Falha na exportação de dados",
      body: `Não foi possível gerar seu pacote de exportação: ${failureReason}. Tente novamente em Configurações → Dados.`,
      linkRoute: "/configuracoes/dados",
      sourceType: "TENANT_DATA_EXPORT_JOB",
      sourceId: jobId,
    });

    // Não relança o erro: o job BullMQ é sob demanda (sem retry automático
    // configurado em enqueue), e o estado FAILED já foi persistido acima — relançar
    // aqui só faria o BullMQ marcar o job como "failed" redundantemente sem
    // nenhum benefício, e o processo do worker nunca deve cair por causa disso.
    log.error({ tenantId, jobId, err: error }, "geração de exportação de dados falhou");
    return { resultStorageKey: "" };
  }
}

export function startDataExportGenerationWorker(): Worker {
  return new Worker<DataExportGenerationJobData>(QUEUE_NAMES.DATA_EXPORT_GENERATION, dataExportGenerationProcessor, {
    connection: queueRedisConnection,
    concurrency: 2, // gera ZIPs potencialmente grandes — concorrência baixa para não estourar memória do processo worker
  });
}

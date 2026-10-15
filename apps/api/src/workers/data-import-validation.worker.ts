// apps/api/src/workers/data-import-validation.worker.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 18.5 — "um job assíncrono
// (`validateImportJob`, BullMQ) roda todas as linhas contra as mesmas regras de
// negócio do cadastro manual [...] e devolve um relatório de erros por linha sem
// gravar nada no banco." Job sob demanda (fila `data-import-validation`), não repetível.
import { Worker, Job } from "bullmq";
import { prismaUnscoped } from "@filitech/db";
import { queueRedisConnection, QUEUE_NAMES } from "../lib/queue";
import { getObjectDirect, putObjectDirect } from "../lib/object-storage";
import { parseSpreadsheetBuffer } from "../lib/spreadsheet-parser";
import { applyColumnMapping, validateMappedProductRow } from "../modules/data-portability/product-import-mapping";
import { createModuleLogger } from "../lib/logger";

const log = createModuleLogger("data-import-validation.worker");

interface DataImportValidationJobData {
  jobId: string;
  tenantId: string;
}

interface RowErrorReportEntry {
  row: number;
  errors: string[];
}

function errorReportToCsv(entries: RowErrorReportEntry[]): string {
  const lines = ["linha,erros"];
  for (const entry of entries) {
    const errorsText = entry.errors.join(" | ").replace(/"/g, '""');
    lines.push(`${entry.row},"${errorsText}"`);
  }
  return lines.join("\r\n") + "\r\n";
}

export async function dataImportValidationProcessor(job: Job<DataImportValidationJobData>): Promise<{ totalRows: number; errorCount: number }> {
  const { jobId, tenantId } = job.data;

  await prismaUnscoped.dataImportJob.update({ where: { id: jobId }, data: { status: "VALIDATING" } });

  try {
    const importJob = await prismaUnscoped.dataImportJob.findFirstOrThrow({ where: { id: jobId, tenantId } });
    if (importJob.targetEntity !== "PRODUCT") {
      // Única entidade implementada nesta rodada (Capítulo 18.5, texto integral só
      // detalha o wizard para `Product`) — GAP DE AUDITORIA DOCUMENTADO: CLIENT/
      // SUPPLIER ficam para uma rodada futura, o schema já está pronto para eles
      // (`targetEntity` é String livre), mas nenhuma regra de validação/gravação
      // existe ainda para essas duas entidades.
      throw new Error(`Validação de importação ainda não implementada para a entidade "${importJob.targetEntity}" (somente PRODUCT nesta versão).`);
    }

    const columnMapping = importJob.columnMapping as Record<string, string>;
    const fileBuffer = await getObjectDirect(importJob.sourceFileKey);
    const fileName = importJob.sourceFileKey.split("/").pop() ?? "arquivo.csv";
    const rows = await parseSpreadsheetBuffer(fileBuffer, fileName);

    if (rows.length === 0) {
      throw new Error("Arquivo vazio — nenhuma linha de cabeçalho encontrada.");
    }
    const [headers, ...dataRows] = rows;

    const errorEntries: RowErrorReportEntry[] = [];
    dataRows.forEach((rawRow, index) => {
      const mapped = applyColumnMapping(headers, rawRow, columnMapping);
      const errors = validateMappedProductRow(mapped);
      if (errors.length > 0) {
        errorEntries.push({ row: index + 2, errors }); // +2: linha 1 é cabeçalho, humano conta a partir de 1
      }
    });

    let errorReportKey: string | null = null;
    if (errorEntries.length > 0) {
      const csv = errorReportToCsv(errorEntries);
      const result = await putObjectDirect({
        tenantId,
        category: "data-import-reports",
        fileName: `erros-validacao-${jobId}.csv`,
        mimeType: "text/csv",
        body: csv,
      });
      errorReportKey = result.storageKey;
    }

    await prismaUnscoped.dataImportJob.update({
      where: { id: jobId },
      data: {
        status: errorEntries.length > 0 ? "VALIDATED_WITH_ERRORS" : "VALIDATED_CLEAN",
        totalRows: dataRows.length,
        errorReportKey,
      },
    });

    return { totalRows: dataRows.length, errorCount: errorEntries.length };
  } catch (error) {
    await prismaUnscoped.dataImportJob.update({
      where: { id: jobId },
      data: { status: "FAILED" },
    });
    log.error({ tenantId, jobId, err: error }, "validação de importação de dados falhou");
    // Não relança: job sob demanda sem retry automático configurado no enqueue; o
    // estado FAILED já foi persistido, mesmo padrão de resiliência do worker de
    // exportação (data-export-generation.worker.ts).
    return { totalRows: 0, errorCount: 0 };
  }
}

export function startDataImportValidationWorker(): Worker {
  return new Worker<DataImportValidationJobData>(QUEUE_NAMES.DATA_IMPORT_VALIDATION, dataImportValidationProcessor, {
    connection: queueRedisConnection,
    concurrency: 3,
  });
}

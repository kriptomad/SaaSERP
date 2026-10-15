// apps/api/src/workers/data-import-execution.worker.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 18.5 — "só então o botão 'Confirmar
// Importação' dispara a gravação real, em lotes de 500 registros por transação
// Prisma — cada lote é tudo-ou-nada, e o progresso é reportado em tempo real via SSE."
// Job sob demanda (fila `data-import-execution`), não repetível. Re-parseia o
// arquivo original em vez de receber as linhas já parseadas no payload do job —
// mais simples e evita payloads grandes no Redis/BullMQ para arquivos com muitas linhas.
import { Worker, Job } from "bullmq";
import crypto from "node:crypto";
import { prismaUnscoped } from "@filitech/db";
import { queueRedisConnection, QUEUE_NAMES } from "../lib/queue";
import { getObjectDirect } from "../lib/object-storage";
import { parseSpreadsheetBuffer } from "../lib/spreadsheet-parser";
import { applyColumnMapping, validateMappedProductRow, MappedProductRow } from "../modules/data-portability/product-import-mapping";
import { broadcastToTenant } from "../lib/sse";
import { createModuleLogger } from "../lib/logger";

const log = createModuleLogger("data-import-execution.worker");

const BATCH_SIZE = 500;

interface DataImportExecutionJobData {
  jobId: string;
  tenantId: string;
}

function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
}

function parseLocaleNumber(value: string): number {
  return Number(value.replace(",", "."));
}

function buildProductCreateData(tenantId: string, mapped: MappedProductRow) {
  // `sku` não faz parte dos campos mapeáveis do wizard (Capítulo 18.5 só lista
  // name/barcodeEan13/costPrice/unitPrice/stockQuantity/categoryName) — gerado
  // automaticamente a partir do nome + sufixo aleatório curto, garantindo
  // unicidade prática sem round-trip extra de verificação por linha (`@@unique([tenantId, sku])`
  // é respeitado por construção: sufixo de 8 hex chars torna colisão improvável).
  const sku = `${slugify(mapped.name ?? "produto") || "produto"}-${crypto.randomBytes(4).toString("hex")}`;
  const barcode = mapped.barcodeEan13 ? mapped.barcodeEan13.replace(/\D/g, "") : null;
  return {
    tenantId,
    sku,
    barcode,
    name: mapped.name!,
    category: mapped.categoryName ?? null,
    unitPrice: parseLocaleNumber(mapped.unitPrice!),
    costPrice: mapped.costPrice ? parseLocaleNumber(mapped.costPrice) : null,
    stockQuantity: mapped.stockQuantity ? parseLocaleNumber(mapped.stockQuantity) : 0,
  };
}

export async function dataImportExecutionProcessor(job: Job<DataImportExecutionJobData>): Promise<{ processedRows: number; status: string }> {
  const { jobId, tenantId } = job.data;

  const importJob = await prismaUnscoped.dataImportJob.findFirstOrThrow({ where: { id: jobId, tenantId } });
  if (importJob.status !== "VALIDATED_CLEAN") {
    // Checagem defensiva redundante à da rota `/data-import/jobs/:id/confirm` — o
    // worker nunca confia apenas no estado validado no momento do enqueue (pode ter
    // mudado entre o enqueue e a execução, ex.: dois cliques rápidos no botão).
    throw new Error(`Job de importação "${jobId}" não está em VALIDATED_CLEAN (estado atual: ${importJob.status}) — importação abortada.`);
  }

  await prismaUnscoped.dataImportJob.update({ where: { id: jobId }, data: { status: "IMPORTING" } });

  const columnMapping = importJob.columnMapping as Record<string, string>;
  const fileBuffer = await getObjectDirect(importJob.sourceFileKey);
  const fileName = importJob.sourceFileKey.split("/").pop() ?? "arquivo.csv";
  const rows = await parseSpreadsheetBuffer(fileBuffer, fileName);
  const [headers, ...dataRows] = rows;
  const totalRows = dataRows.length;

  let processedRows = 0;
  for (let i = 0; i < dataRows.length; i += BATCH_SIZE) {
    const batch = dataRows.slice(i, i + BATCH_SIZE);
    try {
      await prismaUnscoped.$transaction(async (tx) => {
        for (const rawRow of batch) {
          const mapped = applyColumnMapping(headers, rawRow, columnMapping);
          const errors = validateMappedProductRow(mapped);
          if (errors.length > 0) {
            // Não deveria acontecer (a linha já passou pela validação prévia), mas o
            // lote inteiro é abortado (tudo-ou-nada) em vez de gravar parcialmente —
            // mesmo princípio de "fail-closed" usado na extensão de tenant (Capítulo 7.2).
            throw new Error(`Linha reprovaria na validação durante a gravação: ${errors.join(" | ")}`);
          }
          await tx.product.create({ data: buildProductCreateData(tenantId, mapped) });
        }
        processedRows += batch.length;
        await tx.dataImportJob.update({ where: { id: jobId }, data: { processedRows } });
      });

      broadcastToTenant(tenantId, "data-import-progress", { type: "data-import-progress", jobId, processedRows, totalRows });
    } catch (error) {
      await prismaUnscoped.dataImportJob.update({ where: { id: jobId }, data: { status: "FAILED" } });
      broadcastToTenant(tenantId, "data-import-progress", { type: "data-import-progress", jobId, processedRows, totalRows, failed: true });
      log.error({ tenantId, jobId, err: error, processedRows }, "importação de dados falhou em um lote");
      return { processedRows, status: "FAILED" };
    }
  }

  await prismaUnscoped.dataImportJob.update({ where: { id: jobId }, data: { status: "COMPLETED", completedAt: new Date() } });
  broadcastToTenant(tenantId, "data-import-progress", { type: "data-import-progress", jobId, processedRows, totalRows, completed: true });

  return { processedRows, status: "COMPLETED" };
}

export function startDataImportExecutionWorker(): Worker {
  return new Worker<DataImportExecutionJobData>(QUEUE_NAMES.DATA_IMPORT_EXECUTION, dataImportExecutionProcessor, {
    connection: queueRedisConnection,
    concurrency: 2,
  });
}

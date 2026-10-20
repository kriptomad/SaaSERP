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
import {
  applyColumnMapping,
  validateMappedProductRow,
  validateMappedPartyRow,
  buildClientCreateData,
  buildSupplierCreateData,
  normalizeDocument,
  MappedProductRow,
  MappedPartyRow,
} from "../modules/data-portability/product-import-mapping";
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

/**
 * fa-w4-import-not-idempotent — dados de ATUALIZAÇÃO para o ramo `update` do
 * `upsert` de produto (usado quando a linha tem um `barcode` válido, nossa única
 * chave natural disponível no wizard). Deliberadamente SEM `sku`: se incluíssemos
 * `sku` aqui, um reenfileiramento do mesmo job pelo BullMQ (job travado/stalled)
 * geraria um NOVO sku aleatório a cada tentativa e sobrescreveria o sku original do
 * produto já gravado na tentativa anterior — inofensivo para o dado em si, mas uma
 * mudança espúria e desnecessária de identificador público a cada retry.
 */
function buildProductUpdateData(mapped: MappedProductRow) {
  return {
    name: mapped.name!,
    category: mapped.categoryName ?? null,
    unitPrice: parseLocaleNumber(mapped.unitPrice!),
    costPrice: mapped.costPrice ? parseLocaleNumber(mapped.costPrice) : null,
    stockQuantity: mapped.stockQuantity ? parseLocaleNumber(mapped.stockQuantity) : 0,
  };
}

/** Mesmo princípio de `buildProductUpdateData`, para CLIENT/SUPPLIER — sem `document`
 * (é a própria chave do upsert) e preservando o valor já normalizado. */
function buildPartyUpdateData(mapped: MappedPartyRow) {
  return {
    name: mapped.name!,
    phone: mapped.phone ?? null,
    email: mapped.email ?? null,
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

  await prismaUnscoped.dataImportJob.update({ where: { id: jobId }, data: { status: "IMPORTING", processingStartedAt: new Date() } });

  const columnMapping = importJob.columnMapping as Record<string, string>;
  const fileBuffer = await getObjectDirect(importJob.sourceFileKey);
  const fileName = importJob.sourceFileKey.split("/").pop() ?? "arquivo.csv";
  const rows = await parseSpreadsheetBuffer(fileBuffer, fileName);
  const [headers, ...dataRows] = rows;
  const totalRows = dataRows.length;

  // fa-w4-import-not-idempotent — retoma a partir de `processedRows` em vez de
  // recomeçar do zero: um job reenfileirado pelo BullMQ após o processo cair no
  // meio do trabalho (stalled job) já tem alguns lotes commitados; reprocessá-los
  // duplicaria as linhas (cada `create()` geraria um novo registro, com um SKU
  // aleatório novo no caso de produtos). Seguro porque `processedRows` só avança
  // DENTRO da mesma transação que grava o lote (ver abaixo) — nunca fica
  // "adiantado" em relação ao que de fato foi commitado.
  let processedRows = importJob.processedRows;
  for (let i = processedRows; i < dataRows.length; i += BATCH_SIZE) {
    const batch = dataRows.slice(i, i + BATCH_SIZE);
    try {
      await prismaUnscoped.$transaction(async (tx) => {
        for (const rawRow of batch) {
          if (importJob.targetEntity === "PRODUCT") {
            const mapped = applyColumnMapping<MappedProductRow>(headers, rawRow, columnMapping);
            const errors = validateMappedProductRow(mapped);
            if (errors.length > 0) {
              // Não deveria acontecer (a linha já passou pela validação prévia), mas o
              // lote inteiro é abortado (tudo-ou-nada) em vez de gravar parcialmente —
              // mesmo princípio de "fail-closed" usado na extensão de tenant (Capítulo 7.2).
              throw new Error(`Linha reprovaria na validação durante a gravação: ${errors.join(" | ")}`);
            }
            const barcode = mapped.barcodeEan13 ? mapped.barcodeEan13.replace(/\D/g, "") : null;
            if (barcode) {
              // fa-w4-import-not-idempotent — chave natural disponível: upsert em vez
              // de create, para um retry (mesma linha reprocessada por qualquer
              // motivo) nunca duplicar o produto.
              await tx.product.upsert({
                where: { tenantId_barcode: { tenantId, barcode } },
                create: buildProductCreateData(tenantId, mapped),
                update: buildProductUpdateData(mapped),
              });
            } else {
              // Sem EAN-13 informado não há chave natural — mantém `create()` (o
              // checkpoint de `processedRows` já evita o reprocessamento do lote
              // inteiro, que é a causa raiz real do bug reportado).
              await tx.product.create({ data: buildProductCreateData(tenantId, mapped) });
            }
          } else {
            const mapped = applyColumnMapping<MappedPartyRow>(headers, rawRow, columnMapping);
            const errors = validateMappedPartyRow(mapped);
            if (errors.length > 0) {
              throw new Error(`Linha reprovaria na validação durante a gravação: ${errors.join(" | ")}`);
            }
            const document = mapped.document ? normalizeDocument(mapped.document) : null;
            if (importJob.targetEntity === "CLIENT") {
              if (document) {
                await tx.client.upsert({
                  where: { tenantId_document: { tenantId, document } },
                  create: buildClientCreateData(tenantId, mapped),
                  update: buildPartyUpdateData(mapped),
                });
              } else {
                await tx.client.create({ data: buildClientCreateData(tenantId, mapped) });
              }
            } else {
              if (document) {
                await tx.supplier.upsert({
                  where: { tenantId_document: { tenantId, document } },
                  create: buildSupplierCreateData(tenantId, mapped),
                  update: buildPartyUpdateData(mapped),
                });
              } else {
                await tx.supplier.create({ data: buildSupplierCreateData(tenantId, mapped) });
              }
            }
          }
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

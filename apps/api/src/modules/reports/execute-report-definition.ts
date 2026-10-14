// apps/api/src/modules/reports/execute-report-definition.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 18.1.1 — Tradutor Seguro: de
// `ReportDefinition` para Query Executável.
// ADAPTAÇÕES DE AUDITORIA sobre o pseudocódigo original:
//   1. `getCurrentTenantId()` (módulo `../../lib/tenant-context` inexistente)
//      substituído por parâmetro explícito `tenantId`, igual a todo o resto do
//      backend (nunca contexto global implícito).
//   2. Nome de tabela SQL derivado por heurística (`model.toLowerCase() + "s"`)
//      substituído por `dataset.tableName` explícito do `DATASET_REGISTRY`
//      (corrige o bug real que geraria `relation "stockmovements" does not
//      exist` para o dataset `stock_movements`, cujo `@@map` real é
//      "stock_movements").
// A nota de segurança do capítulo permanece válida e é reforçada aqui:
// `$queryRawUnsafe` só é aceitável porque TODO fragmento interpolado vem
// exclusivamente da allowlist `DATASET_REGISTRY` (nunca do payload do
// usuário) e o único valor de usuário na query (`tenantId`) é sempre passado
// como parâmetro vinculado ($1), nunca concatenado.
import { TenantScopedPrismaClient } from "@filitech/db";
import { DATASET_REGISTRY } from "./dataset-registry";

export class InvalidReportFieldError extends Error {}

export interface ReportExecutionInput {
  datasetKey: string;
  dimensions: string[];
  metrics: string[];
}

export async function executeReportDefinition(
  prisma: TenantScopedPrismaClient,
  tenantId: string,
  definition: ReportExecutionInput,
): Promise<Record<string, unknown>[]> {
  const dataset = DATASET_REGISTRY[definition.datasetKey];
  if (!dataset) {
    throw new InvalidReportFieldError(`Dataset "${definition.datasetKey}" não está registrado.`);
  }
  if (definition.metrics.length === 0) {
    throw new InvalidReportFieldError("Pelo menos uma métrica deve ser selecionada.");
  }

  // Cada dimensão/métrica recebida é validada contra a allowlist ANTES de compor
  // qualquer fragmento de SQL — campos fora da allowlist nunca chegam a ser
  // interpolados na query final.
  for (const dimensionKey of definition.dimensions) {
    if (!dataset.allowedDimensions[dimensionKey]) {
      throw new InvalidReportFieldError(`Dimensão "${dimensionKey}" não é permitida para o dataset "${definition.datasetKey}".`);
    }
  }
  for (const metricKey of definition.metrics) {
    if (!dataset.allowedMetrics[metricKey]) {
      throw new InvalidReportFieldError(`Métrica "${metricKey}" não é permitida para o dataset "${definition.datasetKey}".`);
    }
  }

  const selectFragments = [
    ...definition.dimensions.map((d) => `${dataset.allowedDimensions[d]} AS "${d}"`),
    ...definition.metrics.map((m) => {
      const metric = dataset.allowedMetrics[m];
      return `${metric.aggregation}("${metric.column}") AS "${m}"`;
    }),
  ];
  const groupByFragments = definition.dimensions.map((d) => dataset.allowedDimensions[d]);

  const sql = `SELECT ${selectFragments.join(", ")} FROM "${dataset.tableName}"
    WHERE "tenantId" = $1
    ${groupByFragments.length ? `GROUP BY ${groupByFragments.join(", ")}` : ""}
    ${definition.dimensions.length ? `ORDER BY ${groupByFragments.join(", ")}` : ""}
    LIMIT 10000`;

  return prisma.$queryRawUnsafe<Record<string, unknown>[]>(sql, tenantId);
}

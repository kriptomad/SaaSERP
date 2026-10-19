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
//   3. (mega-audit round 3, r3-reports-joins) Suporte a JOIN allowlisted: a
//      tabela base é sempre aliasada `t`; dimensões/métricas/filtros que
//      dependem de um join (`requiresJoin`) disparam a emissão do respectivo
//      LEFT JOIN (na ordem declarada em `dataset.joins`, nunca na ordem de
//      uso) — um Set evita JOIN duplicado quando múltiplos campos usados
//      dependem do mesmo join.
// A nota de segurança do capítulo permanece válida e é reforçada aqui:
// `$queryRawUnsafe` só é aceitável porque TODO fragmento interpolado vem
// exclusivamente da allowlist `DATASET_REGISTRY` (nunca do payload do
// usuário) e o único valor de usuário na query (`tenantId`) é sempre passado
// como parâmetro vinculado ($1), nunca concatenado.
import { TenantScopedPrismaClient } from "@filitech/db";
import { DATASET_REGISTRY, DatasetDefinition, DatasetFieldDefinition } from "./dataset-registry";

export class InvalidReportFieldError extends Error {}

const FILTER_OPERATORS = ["eq", "neq", "gt", "gte", "lt", "lte", "in"] as const;
export type ReportFilterOperator = (typeof FILTER_OPERATORS)[number];

export interface ReportFilterCondition {
  field: string;
  operator: ReportFilterOperator;
  value: unknown;
}

export interface ReportExecutionInput {
  datasetKey: string;
  dimensions: string[];
  metrics: string[];
  filters?: ReportFilterCondition[];
}

const SQL_OPERATOR_BY_FILTER: Record<Exclude<ReportFilterOperator, "in">, string> = {
  eq: "=",
  neq: "<>",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
};

function resolveDimension(dataset: DatasetDefinition, datasetKey: string, key: string): DatasetFieldDefinition {
  const field = dataset.allowedDimensions[key];
  if (!field) {
    throw new InvalidReportFieldError(`Dimensão "${key}" não é permitida para o dataset "${datasetKey}".`);
  }
  return field;
}

function resolveMetric(dataset: DatasetDefinition, datasetKey: string, key: string) {
  const field = dataset.allowedMetrics[key];
  if (!field) {
    throw new InvalidReportFieldError(`Métrica "${key}" não é permitida para o dataset "${datasetKey}".`);
  }
  return field;
}

// Emite os LEFT JOINs necessários na ordem declarada em `dataset.joins`
// (nunca na ordem de uso pelo relatório) — essencial para encadeamentos como
// `sales.sale_items -> products`, onde o join de `products` referencia o
// alias de `sale_items` em sua própria condição `on`.
function buildJoinClause(dataset: DatasetDefinition, requiredJoinNames: Set<string>): string {
  if (!dataset.joins) return "";
  const clauses: string[] = [];
  for (const [joinName, join] of Object.entries(dataset.joins)) {
    if (requiredJoinNames.has(joinName)) {
      clauses.push(`LEFT JOIN "${join.table}" AS ${join.alias} ON ${join.on}`);
    }
  }
  return clauses.join("\n    ");
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
  // interpolados na query final. Os joins exigidos por cada campo usado são
  // acumulados aqui para emissão posterior (buildJoinClause).
  const requiredJoinNames = new Set<string>();
  const trackJoin = (field: DatasetFieldDefinition) => {
    if (field.requiresJoin) requiredJoinNames.add(field.requiresJoin);
  };

  const dimensionFields = definition.dimensions.map((key) => {
    const field = resolveDimension(dataset, definition.datasetKey, key);
    trackJoin(field);
    return { key, field };
  });
  const metricFields = definition.metrics.map((key) => {
    const field = resolveMetric(dataset, definition.datasetKey, key);
    trackJoin(field);
    return { key, field };
  });

  const selectFragments = [
    ...dimensionFields.map(({ key, field }) => `${field.sql} AS "${key}"`),
    ...metricFields.map(({ key, field }) => `${field.aggregation}(${field.sql}) AS "${key}"`),
  ];
  const groupByFragments = dimensionFields.map(({ field }) => field.sql);

  // GAP DE AUDITORIA FECHADO: `ReportDefinition.filters` era persistido mas nunca
  // aplicado aqui — todo relatório sempre retornava o dataset inteiro do tenant,
  // ignorando silenciosamente qualquer filtro configurado pelo usuário. Cada
  // `field` é validado contra a MESMA allowlist `allowedDimensions` já usada para
  // dimensões/GROUP BY (nunca um nome de coluna livre), e todo `value` é sempre
  // vinculado como parâmetro ($2, $3, ...), nunca concatenado na string SQL.
  const params: unknown[] = [tenantId];
  const whereFragments = [`t."tenantId" = $1`];
  for (const filter of Array.isArray(definition.filters) ? definition.filters : []) {
    const field = dataset.allowedDimensions[filter.field];
    if (!field) {
      throw new InvalidReportFieldError(`Campo de filtro "${filter.field}" não é permitido para o dataset "${definition.datasetKey}".`);
    }
    trackJoin(field);
    if (filter.operator === "in") {
      const values = Array.isArray(filter.value) ? filter.value : [filter.value];
      if (values.length === 0) {
        throw new InvalidReportFieldError(`Filtro "${filter.field}" com operador "in" exige ao menos um valor.`);
      }
      const placeholders = values.map((value) => {
        params.push(value);
        return `$${params.length}`;
      });
      whereFragments.push(`${field.sql} IN (${placeholders.join(", ")})`);
    } else {
      const sqlOperator = SQL_OPERATOR_BY_FILTER[filter.operator];
      if (!sqlOperator) {
        throw new InvalidReportFieldError(`Operador de filtro "${filter.operator}" não é suportado.`);
      }
      params.push(filter.value);
      whereFragments.push(`${field.sql} ${sqlOperator} $${params.length}`);
    }
  }

  const joinClause = buildJoinClause(dataset, requiredJoinNames);

  // CORREÇÃO DE AUDITORIA (bug real confirmado): quando a consulta usa um join 1:N
  // em relação à tabela base (`fanOut: true`, ex.: sales -> sale_items), uma métrica
  // da PRÓPRIA tabela base (ex.: `SUM(t."totalAmount")`) somada diretamente sobre as
  // linhas já juntadas conta o mesmo valor uma vez POR LINHA DE ITEM, inflando o
  // faturamento reportado. A query é reescrita em duas camadas: uma subquery interna
  // materializa cada dimensão/métrica com um alias próprio + `ROW_NUMBER() OVER
  // (PARTITION BY t."id")`, e a camada externa agrega métricas que NÃO dependem de
  // nenhum join (puramente da tabela base) apenas na primeira linha de cada `t."id"`
  // — nunca somando o mesmo valor de venda mais de uma vez. Métricas que já
  // dependem de um join (ex.: soma de `sale_items.quantity`) continuam agregadas
  // normalmente sobre todas as linhas juntadas, pois esse É o grão correto delas.
  const hasFanOutJoin = Array.from(requiredJoinNames).some((joinName) => dataset.joins?.[joinName]?.fanOut);

  if (!hasFanOutJoin) {
    const sql = `SELECT ${selectFragments.join(", ")} FROM "${dataset.tableName}" AS t
      ${joinClause}
      WHERE ${whereFragments.join(" AND ")}
      ${groupByFragments.length ? `GROUP BY ${groupByFragments.join(", ")}` : ""}
      ${definition.dimensions.length ? `ORDER BY ${groupByFragments.join(", ")}` : ""}
      LIMIT 10000`;

    return prisma.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...params);
  }

  const innerSelectFragments = [`t."id" AS "__base_id"`, `ROW_NUMBER() OVER (PARTITION BY t."id" ORDER BY t."id") AS "__row_num"`];
  const dimensionAliasByKey = new Map<string, string>();
  dimensionFields.forEach(({ key, field }, index) => {
    const alias = `__dim_${index}`;
    dimensionAliasByKey.set(key, alias);
    innerSelectFragments.push(`${field.sql} AS "${alias}"`);
  });
  const metricAliasByKey = new Map<string, string>();
  metricFields.forEach(({ key, field }, index) => {
    const alias = `__metric_${index}`;
    metricAliasByKey.set(key, alias);
    innerSelectFragments.push(`${field.sql} AS "${alias}"`);
  });

  const innerSql = `SELECT ${innerSelectFragments.join(", ")} FROM "${dataset.tableName}" AS t
    ${joinClause}
    WHERE ${whereFragments.join(" AND ")}`;

  const outerSelectFragments = [
    ...dimensionFields.map(({ key }) => `q."${dimensionAliasByKey.get(key)}" AS "${key}"`),
    ...metricFields.map(({ key, field }) => {
      const alias = metricAliasByKey.get(key)!;
      // Métrica que já depende de algum join (requiresJoin) vive no mesmo grão das
      // linhas juntadas — agregação normal é o comportamento correto para ela.
      if (field.requiresJoin) return `${field.aggregation}(q."${alias}") AS "${key}"`;
      // Métrica pura da tabela base: COUNT conta `id` distintos (nunca uma vez por
      // linha de item); SUM/AVG só considera a primeira linha de cada `id`
      // (deduplicada via ROW_NUMBER), nunca somando o mesmo valor de venda 2+ vezes.
      if (field.aggregation === "COUNT") return `COUNT(DISTINCT CASE WHEN q."__row_num" = 1 THEN q."__base_id" END) AS "${key}"`;
      return `${field.aggregation}(CASE WHEN q."__row_num" = 1 THEN q."${alias}" ELSE NULL END) AS "${key}"`;
    }),
  ];
  const outerGroupByFragments = dimensionFields.map(({ key }) => `q."${dimensionAliasByKey.get(key)}"`);

  const sql = `SELECT ${outerSelectFragments.join(", ")} FROM (${innerSql}) AS q
    ${outerGroupByFragments.length ? `GROUP BY ${outerGroupByFragments.join(", ")}` : ""}
    ${outerGroupByFragments.length ? `ORDER BY ${outerGroupByFragments.join(", ")}` : ""}
    LIMIT 10000`;

  return prisma.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...params);
}


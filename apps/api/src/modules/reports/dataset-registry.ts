// apps/api/src/modules/reports/dataset-registry.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 18.1.1 — Motor de Relatórios
// Self-Service. Única fonte de verdade de quais campos um relatório self-service
// pode tocar. Adicionar um dataset novo exige alteração explícita aqui — nunca
// inferência dinâmica a partir do schema Prisma completo, o que vazaria campos
// não destinados a relatório.
// CORREÇÃO DE AUDITORIA sobre o pseudocódigo do Capítulo 18.1.1: o pseudocódigo
// derivava o nome da tabela SQL via `dataset.model.toLowerCase() + "s"`
// (`"StockMovement" -> "stockmovements"`), que não bate com o `@@map` real do
// schema (`"stock_movements"`) — geraria um `relation does not exist` em
// runtime para qualquer dataset cujo plural ingênuo não coincida com o
// `@@map`. Corrigido aqui carregando `tableName` explícito por dataset, lido
// direto do `@@map` real de cada modelo.
//
// GAP DE AUDITORIA FECHADO (mega-audit round 3, r3-reports-joins): a primeira
// implementação deste registro só suportava dimensões/métricas da própria
// tabela base — qualquer dimensão que exigisse JOIN (ex.: "categoria do
// produto" num relatório de vendas, que exige Sale -> SaleItem -> Product)
// ficava permanentemente fora de alcance do motor self-service. Agora cada
// dataset pode declarar `joins` (allowlist de LEFT JOINs pré-validados, nunca
// construídos a partir de entrada do usuário) e cada dimensão/métrica pode
// declarar de qual join ela depende (`requiresJoin`) — o executor só emite os
// JOINs efetivamente usados pela consulta solicitada.
export type MetricAggregation = "SUM" | "COUNT" | "AVG";

export interface DatasetFieldDefinition {
  // Fragmento SQL já qualificado com o alias da tabela (`t` para a tabela base,
  // ou o alias de um join declarado em `joins`) — nunca uma coluna livre.
  sql: string;
  // Nome do join (chave de `joins`) do qual este campo depende, se houver.
  // Validado no registro: toda referência precisa apontar para um join
  // efetivamente declarado neste dataset.
  requiresJoin?: string;
}

export interface DatasetMetricDefinition extends DatasetFieldDefinition {
  aggregation: MetricAggregation;
}

// `on` é o fragmento de condição do JOIN, referenciando sempre `t` (tabela
// base) e/ou aliases de joins declarados ANTES deste no mesmo `joins` (permite
// encadear: sale_items depende só de `t`; products depende do alias de
// sale_items) — nunca referencia dado de entrada do usuário.
export interface DatasetJoinDefinition {
  table: string; // nome real da tabela no Postgres (`@@map`)
  alias: string; // alias único dentro do dataset, nunca "t" (reservado à tabela base)
  on: string;
}

export interface DatasetDefinition {
  model: string;
  tableName: string; // nome real da tabela no Postgres (`@@map` do schema), nunca derivado por heurística
  joins?: Record<string, DatasetJoinDefinition>;
  allowedDimensions: Record<string, DatasetFieldDefinition>;
  allowedMetrics: Record<string, DatasetMetricDefinition>;
}

function assertJoinsValid(datasetKey: string, dataset: DatasetDefinition): void {
  const joinNames = new Set(Object.keys(dataset.joins ?? {}));
  const checkField = (fieldKey: string, field: DatasetFieldDefinition) => {
    if (field.requiresJoin && !joinNames.has(field.requiresJoin)) {
      throw new Error(
        `Dataset "${datasetKey}": campo "${fieldKey}" referencia join "${field.requiresJoin}" não declarado em "joins".`,
      );
    }
  };
  for (const [key, def] of Object.entries(dataset.allowedDimensions)) checkField(key, def);
  for (const [key, def] of Object.entries(dataset.allowedMetrics)) checkField(key, def);
}

export const DATASET_REGISTRY: Record<string, DatasetDefinition> = {
  sales: {
    model: "Sale",
    tableName: "sales",
    joins: {
      // Capítulo 18.1.1 — permite relatórios "vendas por categoria de produto" /
      // "vendas por produto", antes impossíveis neste motor. `sale_items` é
      // 1:N em relação a `sales`; o GROUP BY sempre inclui a dimensão derivada
      // destes joins, então a agregação de métricas de `sales` (ex. totalAmount)
      // passa a ser por LINHA DE ITEM quando este join é usado — documentado na
      // própria descrição do dataset exposta pela UI (reports.routes.ts).
      sale_items: { table: "sale_items", alias: "si", on: `si."saleId" = t.id` },
      products: { table: "products", alias: "p", on: `p.id = si."productId"` },
    },
    allowedDimensions: {
      "createdAt.day": { sql: `date_trunc('day', t."createdAt")` },
      "createdAt.month": { sql: `date_trunc('month', t."createdAt")` },
      paymentMethod: { sql: `t."paymentMethod"` },
      channel: { sql: `t."channel"` },
      status: { sql: `t."status"` },
      "product.name": { sql: `p."name"`, requiresJoin: "products" },
      "product.category": { sql: `p."category"`, requiresJoin: "products" },
      "product.sku": { sql: `p."sku"`, requiresJoin: "products" },
    },
    allowedMetrics: {
      "totalAmount.sum": { sql: `t."totalAmount"`, aggregation: "SUM" },
      "discountAmount.sum": { sql: `t."discountAmount"`, aggregation: "SUM" },
      "sales.count": { sql: `t."id"`, aggregation: "COUNT" },
      "saleItem.quantity.sum": { sql: `si."quantity"`, aggregation: "SUM", requiresJoin: "sale_items" },
      "saleItem.totalPrice.sum": { sql: `si."totalPrice"`, aggregation: "SUM", requiresJoin: "sale_items" },
    },
  },
  stock_movements: {
    model: "StockMovement",
    tableName: "stock_movements",
    joins: {
      products: { table: "products", alias: "p", on: `p.id = t."productId"` },
    },
    allowedDimensions: {
      type: { sql: `t."type"` },
      "createdAt.day": { sql: `date_trunc('day', t."createdAt")` },
      "createdAt.month": { sql: `date_trunc('month', t."createdAt")` },
      "product.name": { sql: `p."name"`, requiresJoin: "products" },
      "product.category": { sql: `p."category"`, requiresJoin: "products" },
    },
    allowedMetrics: {
      "quantity.sum": { sql: `t."quantity"`, aggregation: "SUM" },
      "movements.count": { sql: `t."id"`, aggregation: "COUNT" },
    },
  },
  work_orders: {
    model: "WorkOrder",
    tableName: "work_orders",
    allowedDimensions: {
      status: { sql: `t."status"` },
      "createdAt.month": { sql: `date_trunc('month', t."createdAt")` },
    },
    allowedMetrics: {
      "workOrders.count": { sql: `t."id"`, aggregation: "COUNT" },
    },
  },
  accounts_payable: {
    model: "AccountPayable",
    tableName: "accounts_payable",
    joins: {
      suppliers: { table: "suppliers", alias: "sup", on: `sup.id = t."supplierId"` },
    },
    allowedDimensions: {
      status: { sql: `t."status"` },
      "dueDate.month": { sql: `date_trunc('month', t."dueDate")` },
      "supplier.name": { sql: `sup."name"`, requiresJoin: "suppliers" },
    },
    allowedMetrics: {
      "amount.sum": { sql: `t."amount"`, aggregation: "SUM" },
      "accountsPayable.count": { sql: `t."id"`, aggregation: "COUNT" },
    },
  },
  accounts_receivable: {
    model: "AccountReceivable",
    tableName: "accounts_receivable",
    joins: {
      clients: { table: "clients", alias: "cli", on: `cli.id = t."clientId"` },
    },
    allowedDimensions: {
      status: { sql: `t."status"` },
      "dueDate.month": { sql: `date_trunc('month', t."dueDate")` },
      "client.name": { sql: `cli."name"`, requiresJoin: "clients" },
    },
    allowedMetrics: {
      "amount.sum": { sql: `t."amount"`, aggregation: "SUM" },
      "accountsReceivable.count": { sql: `t."id"`, aggregation: "COUNT" },
    },
  },
};

for (const [key, dataset] of Object.entries(DATASET_REGISTRY)) {
  assertJoinsValid(key, dataset);
}

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
export interface DatasetMetric {
  column: string;
  aggregation: "SUM" | "COUNT" | "AVG";
}

export interface DatasetDefinition {
  model: string;
  tableName: string; // nome real da tabela no Postgres (`@@map` do schema), nunca derivado por heurística
  allowedDimensions: Record<string, string>; // chave pública -> fragmento SQL já validado
  allowedMetrics: Record<string, DatasetMetric>;
}

// Escopo desta 1ª implementação (honestamente delimitado): datasets sem JOIN,
// apenas colunas/expressões da própria tabela. Dimensões que exigem JOIN (ex.:
// "product.category" em vendas, que exigiria SaleItem + Product) ficam PENDENTES
// — adicionar suporte a JOIN allowlisted é a evolução natural deste registro,
// não implementada nesta passada para não arriscar uma query SQL malformada
// sem cobertura de teste.
export const DATASET_REGISTRY: Record<string, DatasetDefinition> = {
  sales: {
    model: "Sale",
    tableName: "sales",
    allowedDimensions: {
      "createdAt.day": `date_trunc('day', "createdAt")`,
      "createdAt.month": `date_trunc('month', "createdAt")`,
      paymentMethod: `"paymentMethod"`,
      channel: `"channel"`,
      status: `"status"`,
    },
    allowedMetrics: {
      "totalAmount.sum": { column: "totalAmount", aggregation: "SUM" },
      "discountAmount.sum": { column: "discountAmount", aggregation: "SUM" },
      "sales.count": { column: "id", aggregation: "COUNT" },
    },
  },
  stock_movements: {
    model: "StockMovement",
    tableName: "stock_movements",
    allowedDimensions: {
      type: `"type"`,
      "createdAt.day": `date_trunc('day', "createdAt")`,
      "createdAt.month": `date_trunc('month', "createdAt")`,
    },
    allowedMetrics: {
      "quantity.sum": { column: "quantity", aggregation: "SUM" },
      "movements.count": { column: "id", aggregation: "COUNT" },
    },
  },
  work_orders: {
    model: "WorkOrder",
    tableName: "work_orders",
    allowedDimensions: {
      status: `"status"`,
      "createdAt.month": `date_trunc('month', "createdAt")`,
    },
    allowedMetrics: {
      "workOrders.count": { column: "id", aggregation: "COUNT" },
    },
  },
  accounts_payable: {
    model: "AccountPayable",
    tableName: "accounts_payable",
    allowedDimensions: {
      status: `"status"`,
      "dueDate.month": `date_trunc('month', "dueDate")`,
    },
    allowedMetrics: {
      "amount.sum": { column: "amount", aggregation: "SUM" },
      "accountsPayable.count": { column: "id", aggregation: "COUNT" },
    },
  },
  accounts_receivable: {
    model: "AccountReceivable",
    tableName: "accounts_receivable",
    allowedDimensions: {
      status: `"status"`,
      "dueDate.month": `date_trunc('month', "dueDate")`,
    },
    allowedMetrics: {
      "amount.sum": { column: "amount", aggregation: "SUM" },
      "accountsReceivable.count": { column: "id", aggregation: "COUNT" },
    },
  },
};

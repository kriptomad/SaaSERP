// apps/web/src/modules/recipes/api.ts
// Contratos reais de recipes.routes.ts (Ficha Técnica / BOM / Produção — Padaria-Confeitaria).
import { api } from "../../api/client";

export interface RecipeItem {
  id: string;
  ingredientId: string;
  quantityPerYield: string;
  ingredient?: { id: string; name: string; sku: string; costPrice: string | null; stockQuantity: string };
}

export interface Recipe {
  id: string;
  productId: string;
  yieldQuantity: string;
  items: RecipeItem[];
}

export interface UpsertRecipeInput {
  yieldQuantity: number;
  items: Array<{ ingredientId: string; quantityPerYield: number }>;
}

export type ProductionBatchStatus = "PLANNED" | "PRODUCED" | "PARTIALLY_LOST";

export const BATCH_STATUS: Record<ProductionBatchStatus, { label: string; color: "default" | "info" | "warning" | "success" | "error" }> = {
  PLANNED: { label: "Planejada", color: "default" },
  PRODUCED: { label: "Produzida", color: "success" },
  PARTIALLY_LOST: { label: "Com perdas", color: "warning" },
};

export interface ProductionBatch {
  id: string;
  finishedProductId: string;
  quantityProduced: string;
  quantityLost: string;
  status: ProductionBatchStatus;
  producedByUserId: string;
  producedAt: string;
  finishedProduct?: { id: string; name: string; sku: string };
}

export interface ProduceBatchInput {
  finishedProductId: string;
  quantityProduced: number;
  quantityLost?: number;
  lossReasonCode?: string;
}

export interface LossReportRow {
  productId: string;
  productName: string;
  sku: string;
  totalProduced: string;
  totalLost: string;
  batchCount: number;
  lossPercentage: number;
}

export const recipesApi = {
  getByProduct: (productId: string) => api.get<Recipe>(`/products/${productId}/recipe`),
  upsert: (productId: string, input: UpsertRecipeInput) => api.put<Recipe>(`/products/${productId}/recipe`, input),
};

export const productionBatchesApi = {
  list: (finishedProductId?: string) => api.get<ProductionBatch[]>("/production-batches", { finishedProductId }),
  produce: (input: ProduceBatchInput) => api.post<ProductionBatch>("/production-batches", input),
  lossReport: (from?: string, to?: string) => api.get<LossReportRow[]>("/production-batches/loss-report", { from, to }),
};

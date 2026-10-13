// apps/web/src/modules/stock/api.ts
// Contratos reais de stock.routes.ts e inventory-count.routes.ts.
import { api } from "../../api/client";

export type StockMovementType =
  | "PURCHASE_IN"
  | "SALE_OUT"
  | "ADJUSTMENT"
  | "RECIPE_CONSUMPTION"
  | "PRODUCTION_CONSUMPTION"
  | "LOSS"
  | "RETURN";

export const MOVEMENT_LABEL: Record<StockMovementType, string> = {
  PURCHASE_IN: "Entrada (compra)",
  SALE_OUT: "Saída (venda)",
  ADJUSTMENT: "Ajuste",
  RECIPE_CONSUMPTION: "Consumo de receita",
  PRODUCTION_CONSUMPTION: "Consumo de produção",
  LOSS: "Perda",
  RETURN: "Devolução",
};

export interface StockMovement {
  id: string;
  productId: string;
  productBatchId: string | null;
  type: StockMovementType;
  quantity: string;
  reasonCode: string | null;
  referenceId: string | null;
  createdAt: string;
}

export type CountStatus = "OPEN" | "RECONCILING" | "APPROVED" | "CANCELLED";

export interface InventoryCount {
  id: string;
  code: string;
  scope: string;
  notes: string | null;
  status: CountStatus;
  startedAt: string;
  approvedAt: string | null;
}

export interface InventoryCountItem {
  id: string;
  productId: string;
  productBatchId: string | null;
  // omitido pela API durante a contagem cega (status OPEN)
  expectedQuantity?: string;
  countedQuantity: string | null;
  divergenceReason: string | null;
  product: { id: string; name: string };
  productBatch: { id: string; batchNumber: string } | null;
}

export interface InventoryCountDetail extends InventoryCount {
  items: InventoryCountItem[];
}

export interface ProductBatch {
  id: string;
  productId: string;
  batchNumber: string;
  expirationDate: string;
  quantity: string;
}

export const stockApi = {
  movements: (params: { productId?: string; type?: string }) => api.get<StockMovement[]>("/stock-movements", params),
  batches: (productId: string) => api.get<ProductBatch[]>("/product-batches", { productId }),
  adjust: (input: { productId: string; quantity: number; reasonCode: string; productBatchId?: string }) =>
    api.post<StockMovement>("/stock-movements/adjustment", input),
};

export const countsApi = {
  list: (status?: string) => api.get<InventoryCount[]>("/inventory-counts", { status }),
  get: (id: string, revealExpected: boolean) =>
    api.get<InventoryCountDetail>(`/inventory-counts/${id}`, { revealExpected: revealExpected ? "true" : undefined }),
  start: (input: { scope: string; notes?: string }) => api.post<InventoryCount>("/inventory-counts", input),
  countItem: (countId: string, itemId: string, input: { countedQuantity: number; divergenceReason?: string }) =>
    api.patch<InventoryCountItem>(`/inventory-counts/${countId}/items/${itemId}`, input),
  submit: (id: string) => api.patch<InventoryCount>(`/inventory-counts/${id}/submit-for-reconciliation`),
  approve: (id: string) => api.patch<InventoryCount>(`/inventory-counts/${id}/approve`),
  cancel: (id: string) => api.patch<InventoryCount>(`/inventory-counts/${id}/cancel`),
};

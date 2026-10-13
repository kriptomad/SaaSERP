// apps/web/src/modules/purchasing/api.ts
// Contratos reais de purchase-orders.routes.ts.
import { api } from "../../api/client";

export type PurchaseOrderStatus = "DRAFT" | "SENT" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CANCELLED";

export const PO_STATUS: Record<PurchaseOrderStatus, { label: string; color: "default" | "info" | "warning" | "success" | "error" }> = {
  DRAFT: { label: "Rascunho", color: "default" },
  SENT: { label: "Enviada", color: "info" },
  PARTIALLY_RECEIVED: { label: "Recebida parcialmente", color: "warning" },
  RECEIVED: { label: "Recebida", color: "success" },
  CANCELLED: { label: "Cancelada", color: "error" },
};

export interface PurchaseOrderItem {
  id: string;
  productId: string;
  quantityOrdered: string;
  quantityReceived: string;
  unitCost: string;
  product?: { id: string; name: string; trackingType: "NONE" | "BATCH" | "SERIAL" | "VARIANT" };
}

export interface PurchaseOrder {
  id: string;
  orderNumber: number;
  status: PurchaseOrderStatus;
  expectedAt: string | null;
  notes: string | null;
  createdAt: string;
  supplier: { id: string; name: string };
  items: PurchaseOrderItem[];
}

export interface ReorderSuggestion {
  productId: string;
  productName: string;
  currentStock: string;
  // Capítulo 4.1 — média móvel de vendas (SALE_OUT) dos últimos 30 dias, usada
  // junto com minStockThreshold para calcular suggestedQuantity no backend.
  avgDailySalesVelocity: string;
  suggestedQuantity: string;
  preferredSupplierId: string | null;
}

export interface CreatePurchaseOrderInput {
  supplierId: string;
  expectedAt?: string;
  notes?: string;
  items: Array<{ productId: string; quantityOrdered: number; unitCost: number }>;
}

export interface ReceiveInput {
  dueDate: string;
  receivedItems: Array<{
    purchaseOrderItemId: string;
    quantityReceivedNow: number;
    batchNumber?: string;
    expirationDate?: string;
  }>;
}

export const purchaseOrdersApi = {
  list: (status?: string) => api.get<PurchaseOrder[]>("/purchase-orders", { status }),
  get: (id: string) => api.get<PurchaseOrder>(`/purchase-orders/${id}`),
  suggestions: () => api.get<ReorderSuggestion[]>("/purchase-orders/reorder-suggestions"),
  create: (input: CreatePurchaseOrderInput) => api.post<PurchaseOrder>("/purchase-orders", input),
  send: (id: string) => api.patch<PurchaseOrder>(`/purchase-orders/${id}/send`),
  cancel: (id: string) => api.patch<PurchaseOrder>(`/purchase-orders/${id}/cancel`),
  receive: (id: string, input: ReceiveInput) => api.post<unknown>(`/purchase-orders/${id}/receive`, input),
};

export function orderTotal(order: Pick<PurchaseOrder, "items">): number {
  return order.items.reduce((sum, i) => sum + Number(i.quantityOrdered) * Number(i.unitCost), 0);
}

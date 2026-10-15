// apps/web/src/modules/online-store/api.ts
// Contratos reais de apps/api/src/modules/online-store/online-store.routes.ts
// (Capítulo 8.5 — Vitrine Virtual/Loja Online, lado AUTENTICADO do lojista).
import { api } from "../../api/client";

export interface OnlineStoreSettings {
  id: string;
  tenantId: string;
  isActive: boolean;
  customSlug: string;
  primaryColorHex: string;
  logoStorageKey: string | null;
  deliveryEnabled: boolean;
  deliveryFee: string | null;
  minOrderAmount: string | null;
  updatedAt: string;
}

export interface OnlineStoreSettingsInput {
  isActive: boolean;
  customSlug: string;
  primaryColorHex: string;
  logoStorageKey?: string | null;
  deliveryEnabled: boolean;
  deliveryFee?: number | null;
  minOrderAmount?: number | null;
}

export type OnlineOrderStatus = "PENDING" | "CONFIRMED" | "PREPARING" | "OUT_FOR_DELIVERY" | "DELIVERED" | "CANCELLED";

export interface OnlineOrderItem {
  id: string;
  productId: string;
  productName: string;
  quantity: string;
  unitPrice: string;
}

export interface OnlineOrder {
  id: string;
  tenantId: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  isDelivery: boolean;
  deliveryAddress: string | null;
  status: OnlineOrderStatus;
  itemsTotalAmount: string;
  deliveryFee: string | null;
  totalAmount: string;
  customerNotes: string | null;
  cancelReason: string | null;
  linkedSaleId: string | null;
  createdAt: string;
  items: OnlineOrderItem[];
}

export const ONLINE_ORDER_STATUS_LABEL: Record<OnlineOrderStatus, string> = {
  PENDING: "Aguardando confirmação",
  CONFIRMED: "Confirmado",
  PREPARING: "Em preparação",
  OUT_FOR_DELIVERY: "Saiu para entrega",
  DELIVERED: "Entregue",
  CANCELLED: "Cancelado",
};

export const onlineStoreApi = {
  getSettings: () => api.get<OnlineStoreSettings | null>("/online-store/settings"),
  saveSettings: (input: OnlineStoreSettingsInput) => api.put<OnlineStoreSettings>("/online-store/settings", input),
  toggleProductVisibility: (productId: string, showInOnlineStore: boolean) =>
    api.patch<unknown>(`/online-store/products/${productId}/visibility`, { showInOnlineStore }),
  orders: (status?: OnlineOrderStatus) => api.get<OnlineOrder[]>("/online-store/orders", status ? { status } : undefined),
  order: (id: string) => api.get<OnlineOrder>(`/online-store/orders/${id}`),
  updateOrderStatus: (id: string, status: OnlineOrderStatus, cancelReason?: string) =>
    api.patch<OnlineOrder>(`/online-store/orders/${id}/status`, { status, cancelReason }),
};

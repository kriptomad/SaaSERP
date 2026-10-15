// apps/web/src/modules/public-store/api.ts
// Contratos reais de apps/api/src/modules/online-store/public-online-store.routes.ts
// (Capítulo 8.5 — Vitrine Virtual, lado PÚBLICO/sem autenticação).
import { api } from "../../api/client";

export interface PublicStoreInfo {
  tenantName: string;
  primaryColorHex: string;
  logoUrl: string | null;
  deliveryEnabled: boolean;
  deliveryFee: string | null;
  minOrderAmount: string | null;
}

export interface PublicStoreProduct {
  id: string;
  name: string;
  description: string | null;
  unitPrice: string;
}

export interface PublicOrderItemInput {
  productId: string;
  quantity: number;
}

export interface PublicOrderInput {
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  isDelivery: boolean;
  deliveryAddress?: string;
  customerNotes?: string;
  items: PublicOrderItemInput[];
}

export interface PublicOrderResult {
  id: string;
  totalAmount: string;
  status: string;
}

export const publicStoreApi = {
  store: (slug: string) => api.get<PublicStoreInfo>(`/loja/${slug}`),
  products: (slug: string) => api.get<PublicStoreProduct[]>(`/loja/${slug}/products`),
  createOrder: (slug: string, input: PublicOrderInput) => api.post<PublicOrderResult>(`/loja/${slug}/orders`, input),
};

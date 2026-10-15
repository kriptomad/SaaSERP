// apps/web/src/modules/tires/api.ts
// Contratos reais de apps/api/src/modules/tires/tire-warranty.routes.ts
// (Capítulo 11.10 — Loja de Pneus: garantia de fabricante e sugestões de rodízio).
import { api } from "../../api/client";

export interface TireWarrantyResult {
  batchId: string;
  receivedAt: string;
  manufacturerWarrantyMonths: number;
  warrantyExpiresAt: string;
  stillUnderWarranty: boolean;
}

export interface TireRotationSuggestion {
  vehicleId: string;
  licensePlate: string;
  model: string;
  owner: { id: string; name: string };
  mileageKm: number | null;
  lastTireSale: { saleId: string; productName: string | null; soldAt: string } | null;
  monthsSinceLastTireSale: number | null;
  suggestsRotation: boolean;
}

export const tireWarrantyApi = {
  checkByBatch: (productBatchId: string) => api.get<TireWarrantyResult>(`/tire-warranty/check/${productBatchId}`),
  checkBySaleItem: (saleItemId: string) => api.get<TireWarrantyResult>(`/tire-warranty/by-sale-item/${saleItemId}`),
  rotationSuggestions: () => api.get<TireRotationSuggestion[]>("/tire-warranty/rotation-suggestions"),
};

// Contratos reais de apps/api/src/modules/tires/tire-service-orders.routes.ts
// (Capítulo 11.10 — O.S. real de montagem/balanceamento/alinhamento + DOT por pneu).
export type TireServiceOrderStatus = "RECEIVED" | "IN_REPAIR" | "READY" | "DELIVERED" | "CANCELLED";
export type TireServiceType = "MOUNTING" | "BALANCING" | "ALIGNMENT";

export interface TireServiceOrderItem {
  id: string;
  productId: string | null;
  description: string;
  itemType: string;
  quantity: string;
  unitPrice: string;
}

export interface TireServiceOrder {
  id: string;
  status: TireServiceOrderStatus;
  equipmentDescription: string;
  reportedIssue: string;
  createdAt: string;
  deliveredAt: string | null;
  client: { id: string; name: string; phone: string | null };
  vehicle: { id: string; licensePlate: string; model: string } | null;
  items: TireServiceOrderItem[];
  productSerials: { id: string; serialNumber: string; status: string }[];
}

export interface CreateTireServiceOrderInput {
  clientId: string;
  vehicleId?: string | null;
  equipmentDescription: string;
  services: { type: TireServiceType; unitPrice: number }[];
  tires?: { productId: string; quantity: number; unitPrice: number; dotCodes?: string[] }[];
}

export const tireServiceOrdersApi = {
  create: (input: CreateTireServiceOrderInput) => api.post<TireServiceOrder>("/tire-service-orders", input),
  list: (status?: TireServiceOrderStatus) => api.get<TireServiceOrder[]>("/tire-service-orders", status ? { status } : undefined),
  get: (id: string) => api.get<TireServiceOrder>(`/tire-service-orders/${id}`),
  setStatus: (id: string, status: TireServiceOrderStatus) => api.patch<TireServiceOrder>(`/tire-service-orders/${id}/status`, { status }),
};

export const TIRE_SERVICE_LABEL: Record<TireServiceType, string> = {
  MOUNTING: "Montagem",
  BALANCING: "Balanceamento",
  ALIGNMENT: "Alinhamento",
};

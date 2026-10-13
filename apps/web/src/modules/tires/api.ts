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

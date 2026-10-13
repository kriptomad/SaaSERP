// apps/web/src/modules/seasonality/api.ts
// Contratos reais de apps/api/src/modules/catalog/seasonality.routes.ts
// (Capítulo 11.5 — Papelaria/Presentes: sazonalidade planejada + relatório de
// liquidação de sobras pós-pico).
import { api } from "../../api/client";

export interface SeasonalityWindow {
  id: string;
  tenantId: string;
  name: string;
  category: string;
  startMonth: number;
  startDay: number;
  endMonth: number;
  endDay: number;
  active: boolean;
  createdAt: string;
}

export interface SeasonalityWindowInput {
  name: string;
  category: string;
  startMonth: number;
  startDay: number;
  endMonth: number;
  endDay: number;
  active?: boolean;
}

export interface ClearanceReportRow {
  productId: string;
  productName: string;
  sku: string;
  category: string;
  stockQuantity: string;
  minStockThreshold: string | null;
  createdAt: string;
  seasonalityWindowName: string;
  windowEndedAt: string;
}

export const seasonalityApi = {
  list: () => api.get<SeasonalityWindow[]>("/seasonality-windows"),
  create: (input: SeasonalityWindowInput) => api.post<SeasonalityWindow>("/seasonality-windows", input),
  update: (id: string, input: Partial<SeasonalityWindowInput>) => api.patch<SeasonalityWindow>(`/seasonality-windows/${id}`, input),
  clearanceReport: () => api.get<ClearanceReportRow[]>("/seasonality-windows/clearance-report"),
};

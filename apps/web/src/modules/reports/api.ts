// apps/web/src/modules/reports/api.ts
// Contrato real de GET /reports/abc-curve (apps/api/src/modules/reports/reports.routes.ts).
import { api } from "../../api/client";

export interface AbcCurveRow {
  productId: string;
  productName: string;
  category: string | null;
  quantitySold: string;
  revenue: string;
  revenueShare: number;
  cumulativeShare: number;
  abcClass: "A" | "B" | "C";
}

// Capítulo 11.4 — Loja de Roupas/Moda: mesma classificação A/B/C, mas por
// combinação cor/tamanho (ProductVariant), não pelo produto agregado. Contrato real
// de GET /reports/abc-curve-variants.
export interface AbcCurveVariantRow {
  variantId: string;
  productId: string;
  productName: string;
  axis: string;
  axisValue: string;
  quantitySold: string;
  revenue: string;
  revenueShare: number;
  cumulativeShare: number;
  abcClass: "A" | "B" | "C";
}

// Capítulo 11.4 — giro por coleção/estação + sinalização automática de liquidação.
// Contrato real de GET /reports/collection-turnover.
export interface CollectionProductRow {
  productId: string;
  productName: string;
  sku: string;
  collectionTag: string;
  quantitySold: string;
  revenue: string;
  currentStock: string;
  isClearanceCandidate: boolean;
}

export interface CollectionSummaryRow {
  collectionTag: string;
  productCount: number;
  totalQuantitySold: string;
  totalRevenue: string;
  avgQuantitySoldPerProduct: number;
  clearanceCandidateCount: number;
}

export interface CollectionTurnoverReport {
  periodDays: number;
  since: string;
  collections: CollectionSummaryRow[];
  products: CollectionProductRow[];
}

export const reportsApi = {
  abcCurve: (days: number) => api.get<AbcCurveRow[]>("/reports/abc-curve", { days }),
  abcCurveVariants: (days: number) => api.get<AbcCurveVariantRow[]>("/reports/abc-curve-variants", { days }),
  collectionTurnover: (days: number) => api.get<CollectionTurnoverReport>("/reports/collection-turnover", { days }),
};

export const ABC_CLASS_COLOR: Record<AbcCurveRow["abcClass"], "success" | "warning" | "default"> = {
  A: "success",
  B: "warning",
  C: "default",
};

export const ABC_CLASS_LABEL: Record<AbcCurveRow["abcClass"], string> = {
  A: "A — essencial (prioridade de reposição)",
  B: "B — relevante",
  C: "C — cauda longa",
};

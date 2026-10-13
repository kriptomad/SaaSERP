// apps/web/src/modules/product-variants/api.ts
// Contratos reais de apps/api/src/modules/catalog/product-variants.routes.ts.
import { api } from "../../api/client";

export interface ProductVariantAxis {
  id: string;
  tenantId: string;
  productId: string;
  name: string;
  _count: { variants: number };
}

export interface ProductVariant {
  id: string;
  tenantId: string;
  productId: string;
  axisId: string;
  axisValue: string;
  barcode: string | null;
  priceOverride: string | null;
  stockQuantity: string;
  axis: { id: string; name: string };
}

export interface VariantStockItem {
  id: string;
  axis: string;
  axisValue: string;
  barcode: string | null;
  stockQuantity: string;
  effectivePrice: string;
}

export interface ProductVariantsStock {
  product: { id: string; name: string; sku: string; unitPrice: string; stockQuantity: string };
  totalVariantStock: number;
  variants: VariantStockItem[];
}

export interface VariantStockMovement {
  id: string;
  type: string;
  quantity: string;
  reasonCode: string | null;
  createdAt: string;
}

export interface VariantStockDetail {
  id: string;
  product: { id: string; name: string; sku: string; unitPrice: string };
  axis: string;
  axisValue: string;
  barcode: string | null;
  stockQuantity: string;
  effectivePrice: string;
  recentMovements: VariantStockMovement[];
}

export const productVariantsApi = {
  listAxes: (productId: string) => api.get<ProductVariantAxis[]>(`/products/${productId}/variant-axes`),
  createAxis: (productId: string, name: string) => api.post<ProductVariantAxis>(`/products/${productId}/variant-axes`, { name }),
  updateAxis: (axisId: string, name: string) => api.patch<ProductVariantAxis>(`/variant-axes/${axisId}`, { name }),
  removeAxis: (axisId: string) => api.delete(`/variant-axes/${axisId}`),

  listVariants: (productId: string) => api.get<ProductVariant[]>(`/products/${productId}/variants`),
  createVariant: (
    productId: string,
    input: { axisId: string; axisValue: string; barcode?: string | null; priceOverride?: number | null },
  ) => api.post<ProductVariant>(`/products/${productId}/variants`, input),
  updateVariant: (
    variantId: string,
    input: Partial<{ axisValue: string; barcode: string | null; priceOverride: number | null }>,
  ) => api.patch<ProductVariant>(`/product-variants/${variantId}`, input),
  removeVariant: (variantId: string) => api.delete(`/product-variants/${variantId}`),

  getProductStock: (productId: string) => api.get<ProductVariantsStock>(`/products/${productId}/variants/stock`),
  getVariantStock: (variantId: string) => api.get<VariantStockDetail>(`/product-variants/${variantId}/stock`),
  adjustStock: (variantId: string, input: { quantityDelta: number; reasonCode: string }) =>
    api.post<ProductVariant>(`/product-variants/${variantId}/stock-adjust`, input),

  getTurnoverReport: (periodDays: number) =>
    api.get<VariantTurnoverReport>("/product-variants/turnover-report", { periodDays }),
};

// Capítulo 4.6 — Varejo Geral: giro de estoque por grade/variante. Contrato real de
// apps/api/src/modules/catalog/variant-turnover.routes.ts.
export interface VariantTurnoverItem {
  variantId: string;
  productId: string;
  productName: string;
  sku: string;
  axis: string;
  axisValue: string;
  barcode: string | null;
  quantitySold: number;
  currentStock: string;
  turnoverRatio: number | null;
}

export interface VariantTurnoverReport {
  periodDays: number;
  since: string;
  variants: VariantTurnoverItem[];
}

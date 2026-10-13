// apps/web/src/modules/exchanges/api.ts
// Contratos reais de apps/api/src/modules/catalog/product-exchanges.routes.ts e do
// GET /sales/:id adicionado em apps/api/src/modules/sales/sales.routes.ts para dar
// ao caixa um jeito de localizar a venda original na troca (Capítulo 11.4/11.7).
import { api } from "../../api/client";

export interface SaleLookupItem {
  id: string;
  productId: string | null;
  product: { name: string } | null;
  productVariantId: string | null;
  productVariant: { axisValue: string; axis: { name: string } } | null;
  quantity: string;
  unitPrice: string;
  totalPrice: string;
}

export interface SaleLookup {
  id: string;
  status: string;
  createdAt: string;
  clientId: string | null;
  client: { id: string; name: string } | null;
  items: SaleLookupItem[];
}

export type ExchangeReasonCode = "WRONG_SIZE" | "WRONG_NUMBERING" | "DEFECT" | "CUSTOMER_REGRET" | "OTHER";
export type ExchangeResolutionType = "NEW_ITEM" | "STORE_CREDIT";

export const EXCHANGE_REASON_LABEL: Record<ExchangeReasonCode, string> = {
  WRONG_SIZE: "Tamanho errado",
  WRONG_NUMBERING: "Numeração errada",
  DEFECT: "Defeito",
  CUSTOMER_REGRET: "Arrependimento do cliente",
  OTHER: "Outro motivo",
};

export interface ProductExchange {
  id: string;
  originalSaleItemId: string;
  returnedVariantId: string | null;
  returnedQuantity: string;
  reasonCode: string;
  resolutionType: ExchangeResolutionType;
  newVariantId: string | null;
  newQuantity: string | null;
  refundValue: string;
  priceDifference: string | null;
  storeCreditIssued: string | null;
  resultingSaleId: string | null;
  createdAt: string;
}

export interface CreateExchangeInput {
  originalSaleItemId: string;
  returnedQuantity: number;
  reasonCode: ExchangeReasonCode;
  resolutionType: ExchangeResolutionType;
  newVariantId?: string | null;
  newQuantity?: number | null;
}

export interface VariantQuickSearchItem {
  variantId: string;
  productId: string;
  productName: string;
  sku: string;
  axis: string;
  axisValue: string;
  barcode: string | null;
  stockQuantity: string;
}

export interface StoreCreditTransaction {
  id: string;
  direction: "ISSUED" | "REDEEMED";
  amount: string;
  exchangeId: string | null;
  redeemedInSaleId: string | null;
  note: string | null;
  createdAt: string;
}

export interface StoreCreditStatement {
  client: { id: string; name: string; storeCreditBalance: string };
  transactions: StoreCreditTransaction[];
}

export const exchangesApi = {
  lookupSale: (saleId: string) => api.get<SaleLookup>(`/sales/${saleId}`),
  quickSearchVariants: (q: string) => api.get<VariantQuickSearchItem[]>("/product-variants/quick-search", { q }),
  create: (input: CreateExchangeInput) => api.post<{ exchange: ProductExchange; amountDue: number }>("/product-exchanges", input),
  list: () => api.get<ProductExchange[]>("/product-exchanges"),
  linkSale: (exchangeId: string, saleId: string) => api.patch<ProductExchange>(`/product-exchanges/${exchangeId}/link-sale`, { saleId }),
  getStoreCredit: (clientId: string) => api.get<StoreCreditStatement>(`/clients/${clientId}/store-credit`),
  redeemStoreCredit: (clientId: string, input: { amount: number; saleId?: string | null; note?: string | null }) =>
    api.post<StoreCreditTransaction>(`/clients/${clientId}/store-credit/redeem`, input),
};

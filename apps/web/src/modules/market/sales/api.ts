// apps/web/src/modules/market/sales/api.ts
// Contrato real de GET /sales e GET /sales/:id (apps/api/src/modules/sales/sales.routes.ts).
import { api } from "../../../api/client";

export interface SaleFiscalDocumentSummary {
  id: string;
  type: "NFCE" | "NFE_SAIDA" | "NFE_ENTRADA";
  status: "PENDING" | "AUTHORIZED" | "REJECTED" | "CANCELLED";
  accessKey: string | null;
  qrCodeUrl: string | null;
  focusNfeNumero?: string | null;
  focusNfeSerie?: string | null;
  totalTaxesApprox?: string | null;
  rejectionReason?: string | null;
}

export interface SaleListRow {
  id: string;
  status: string;
  createdAt: string;
  totalAmount: string;
  paymentMethod: string;
  client: { id: string; name: string } | null;
  fiscalDocuments: SaleFiscalDocumentSummary[];
}

export interface SaleItemDetail {
  id: string;
  productId: string;
  product: { name: string };
  productVariantId: string | null;
  productVariant: { axisValue: string; axis: { name: string } } | null;
  quantity: string;
  unitPrice: string;
  totalPrice: string;
}

export interface SaleDetail {
  id: string;
  status: string;
  createdAt: string;
  totalAmount: string;
  paymentMethod: string;
  clientId: string | null;
  client: { id: string; name: string } | null;
  items: SaleItemDetail[];
  fiscalDocuments: SaleFiscalDocumentSummary[];
}

export interface FailedOfflineSaleSync {
  id: string;
  idempotencyKey: string;
  cashRegisterId: string;
  cashierId: string;
  payload: unknown;
  errorCode: string;
  errorMessage: string;
  createdAt: string;
  resolvedAt: string | null;
  resolvedByUserId: string | null;
  resolutionNote: string | null;
}

export const salesApi = {
  list: (before?: string) => api.get<SaleListRow[]>("/sales", before ? { before } : undefined),
  get: (id: string) => api.get<SaleDetail>(`/sales/${id}`),
  listFailedOfflineSyncs: (status: "pending" | "all" = "pending") =>
    api.get<FailedOfflineSaleSync[]>("/sales/failed-offline-syncs", { status }),
  resolveFailedOfflineSync: (id: string, resolutionNote: string) =>
    api.patch<FailedOfflineSaleSync>(`/sales/failed-offline-syncs/${id}/resolve`, { resolutionNote }),
};

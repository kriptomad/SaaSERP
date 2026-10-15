// apps/web/src/modules/construction/api.ts
// Contratos reais de apps/api/src/modules/construction/business-accounts.routes.ts
// (Capítulo 11.8 — Material de Construção/Ferragens: vendas a prazo para profissionais).
import { api } from "../../api/client";

export interface BusinessAccountSaleItem {
  id: string;
  productId: string | null;
  serviceId: string | null;
  quantity: string;
  unitPrice: string;
  totalPrice: string;
}

export interface BusinessAccountSale {
  id: string;
  totalAmount: string;
  status: string;
  createdAt: string;
  items: BusinessAccountSaleItem[];
}

export interface MonthlyStatement {
  client: { id: string; name: string; creditLimit: string; creditBalanceUsed: string };
  month: string;
  sales: BusinessAccountSale[];
}

export interface ConsolidatedInvoice {
  id: string;
  clientId: string;
  description: string;
  amount: string;
  dueDate: string;
  status: string;
}

export const businessAccountsApi = {
  getMonthlyStatement: (clientId: string, month?: string) =>
    api.get<MonthlyStatement>(`/business-accounts/${clientId}/monthly-statement`, { month }),
  generateMonthlyInvoice: (clientId: string, month?: string) =>
    api.post<ConsolidatedInvoice>(`/business-accounts/${clientId}/generate-monthly-invoice${month ? `?month=${month}` : ""}`),
};

// Contratos reais de apps/api/src/modules/construction/construction-quotes.routes.ts
// (Capítulo 11.8 — orçamento de obra).
export type ConstructionQuoteStatus = "DRAFT" | "SENT" | "APPROVED" | "REJECTED" | "CONVERTED" | "EXPIRED";

export interface ConstructionQuoteItem {
  id: string;
  productId: string | null;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
}

export interface ConstructionQuote {
  id: string;
  title: string;
  status: ConstructionQuoteStatus;
  validUntil: string | null;
  notes: string | null;
  createdAt: string;
  client: { id: string; name: string; phone: string | null };
  items: ConstructionQuoteItem[];
}

export interface CreateConstructionQuoteInput {
  clientId: string;
  title: string;
  validUntil?: string | null;
  notes?: string | null;
  items: { productId?: string | null; description: string; quantity: number; unit: string; unitPrice: number }[];
}

export const constructionQuotesApi = {
  create: (input: CreateConstructionQuoteInput) => api.post<ConstructionQuote>("/construction-quotes", input),
  list: (status?: ConstructionQuoteStatus) => api.get<ConstructionQuote[]>("/construction-quotes", status ? { status } : undefined),
  get: (id: string) => api.get<ConstructionQuote>(`/construction-quotes/${id}`),
  setStatus: (id: string, status: ConstructionQuoteStatus) => api.patch<ConstructionQuote>(`/construction-quotes/${id}/status`, { status }),
};

export const CONSTRUCTION_QUOTE_STATUS_LABEL: Record<ConstructionQuoteStatus, string> = {
  DRAFT: "Rascunho",
  SENT: "Enviado ao cliente",
  APPROVED: "Aprovado",
  REJECTED: "Rejeitado",
  CONVERTED: "Convertido em venda",
  EXPIRED: "Expirado",
};

// Contratos reais de apps/api/src/modules/construction/material-deliveries.routes.ts
// (Capítulo 11.8 — entrega agendada de material pesado/volumoso).
export type MaterialDeliveryStatus = "PENDING" | "IN_TRANSIT" | "DELIVERED" | "CANCELLED";

export interface MaterialDelivery {
  id: string;
  address: string;
  scheduledAt: string;
  status: MaterialDeliveryStatus;
  driverName: string | null;
  vehiclePlate: string | null;
  referenceNote: string | null;
  deliveredAt: string | null;
  receivedByName: string | null;
  notes: string | null;
  client: { id: string; name: string; phone: string | null };
}

export interface CreateMaterialDeliveryInput {
  clientId: string;
  saleId?: string | null;
  address: string;
  scheduledAt: string;
  driverName?: string | null;
  vehiclePlate?: string | null;
  referenceNote?: string | null;
  notes?: string | null;
}

export const materialDeliveriesApi = {
  create: (input: CreateMaterialDeliveryInput) => api.post<MaterialDelivery>("/material-deliveries", input),
  list: (status?: MaterialDeliveryStatus) => api.get<MaterialDelivery[]>("/material-deliveries", status ? { status } : undefined),
  update: (
    id: string,
    input: Partial<{ status: MaterialDeliveryStatus; driverName: string | null; vehiclePlate: string | null; receivedByName: string | null }>,
  ) => api.patch<MaterialDelivery>(`/material-deliveries/${id}`, input),
};

export const MATERIAL_DELIVERY_STATUS_LABEL: Record<MaterialDeliveryStatus, string> = {
  PENDING: "Pendente",
  IN_TRANSIT: "Em trânsito",
  DELIVERED: "Entregue",
  CANCELLED: "Cancelado",
};

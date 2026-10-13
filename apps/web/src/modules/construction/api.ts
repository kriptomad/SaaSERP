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

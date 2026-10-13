// apps/web/src/modules/comanda/api.ts
// Contratos reais de apps/api/src/modules/comanda/comanda.routes.ts.
import { api } from "../../api/client";

export interface RestaurantTable {
  id: string;
  tenantId: string;
  label: string;
  seatCount: number;
  active: boolean;
}

export type ComandaStatus = "OPEN" | "CLOSED" | "CANCELLED";

export interface ComandaItem {
  id: string;
  comandaId: string;
  productId: string | null;
  serviceId: string | null;
  professionalId: string | null;
  quantity: string;
  unitPrice: string;
  sentToKdsAt: string | null;
  recipeConsumedAt: string | null;
  product?: { id: string; name: string } | null;
  service?: { id: string; name: string } | null;
}

export interface Comanda {
  id: string;
  tenantId: string;
  tableId: string | null;
  clientId: string | null;
  status: ComandaStatus;
  openedAt: string;
  closedAt: string | null;
  saleId: string | null;
  table?: RestaurantTable | null;
  client?: { id: string; name: string } | null;
  items: ComandaItem[];
}

export type PaymentMethod = "CASH" | "DEBIT_CARD" | "CREDIT_CARD" | "PIX" | "BOLETO" | "STORE_CREDIT";

export const comandaApi = {
  listTables: () => api.get<RestaurantTable[]>("/restaurant-tables"),
  createTable: (input: { label: string; seatCount: number }) => api.post<RestaurantTable>("/restaurant-tables", input),

  list: (status?: ComandaStatus) => api.get<Comanda[]>("/comandas", { status }),
  get: (id: string) => api.get<Comanda>(`/comandas/${id}`),
  open: (input: { tableId?: string; clientId?: string }) => api.post<Comanda>("/comandas", input),
  addItem: (
    comandaId: string,
    input: { productId?: string; serviceId?: string; professionalId?: string; quantity: number; unitPrice: number },
  ) => api.post<ComandaItem>(`/comandas/${comandaId}/items`, input),
  sendItemToKds: (comandaId: string, itemId: string) => api.patch<ComandaItem>(`/comandas/${comandaId}/items/${itemId}/send-to-kds`),
  removeItem: (comandaId: string, itemId: string) => api.delete(`/comandas/${comandaId}/items/${itemId}`),
  cancel: (id: string) => api.patch<Comanda>(`/comandas/${id}/cancel`),
  close: (id: string, input: { cashRegisterId: string; paymentMethod: PaymentMethod }) =>
    api.post<{ comanda: Comanda; sale: { id: string }; fiscalDocument: unknown }>(`/comandas/${id}/close`, input),
};

export const COMANDA_STATUS_LABEL: Record<ComandaStatus, string> = {
  OPEN: "Aberta",
  CLOSED: "Fechada",
  CANCELLED: "Cancelada",
};

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: "Dinheiro",
  DEBIT_CARD: "Cartão débito",
  CREDIT_CARD: "Cartão crédito",
  PIX: "PIX",
  BOLETO: "Boleto",
  STORE_CREDIT: "Crédito da loja",
};

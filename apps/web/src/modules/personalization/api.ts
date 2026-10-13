// apps/web/src/modules/personalization/api.ts
// Contratos reais de apps/api/src/modules/personalization/personalization.routes.ts
// (Capítulo 11.5 — Papelaria/Presentes: personalização/bordado/sublimação).
import { api } from "../../api/client";

export type PersonalizationStatus = "RECEIVED" | "IN_REPAIR" | "READY" | "DELIVERED" | "CANCELLED";

export interface PersonalizationWorkOrderItem {
  id: string;
  workOrderId: string;
  productId: string | null;
  description: string;
  itemType: string;
  quantity: string;
  unitPrice: string;
  commissionable: boolean;
  saleItemId: string | null;
  productionDueAt: string | null;
  artApprovedAt: string | null;
}

export interface PersonalizationWorkOrder {
  id: string;
  tenantId: string;
  clientId: string;
  equipmentDescription: string;
  reportedIssue: string;
  status: PersonalizationStatus;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
  items: PersonalizationWorkOrderItem[];
  client?: { id: string; name: string };
}

export interface CreatePersonalizationOrderInput {
  saleItemId: string;
  clientId: string;
  description: string;
  productionDueAt: string;
}

export const PERSONALIZATION_STATUS_LABEL: Record<PersonalizationStatus, string> = {
  RECEIVED: "Recebido",
  IN_REPAIR: "Em produção",
  READY: "Pronto",
  DELIVERED: "Entregue",
  CANCELLED: "Cancelado",
};

// Ordem de avanço aceita pela API (ver personalization.routes.ts) — usada para
// calcular o próximo status disponível no botão de avançar da UI.
export const PERSONALIZATION_STATUS_ORDER: PersonalizationStatus[] = ["RECEIVED", "IN_REPAIR", "READY", "DELIVERED"];

export const personalizationApi = {
  list: () => api.get<PersonalizationWorkOrder[]>("/personalization-orders"),
  create: (input: CreatePersonalizationOrderInput) => api.post<PersonalizationWorkOrder>("/personalization-orders", input),
  approveArt: (workOrderItemId: string) =>
    api.patch<PersonalizationWorkOrderItem>(`/personalization-orders/${workOrderItemId}/approve-art`, {}),
  updateStatus: (workOrderId: string, status: PersonalizationStatus) =>
    api.patch<PersonalizationWorkOrder>(`/personalization-orders/${workOrderId}/status`, { status }),
};

// apps/web/src/modules/work-orders/api.ts
// Contratos reais de work-orders.routes.ts.
import { api } from "../../api/client";

export type WorkOrderStatus = "RECEIVED" | "DIAGNOSING" | "AWAITING_APPROVAL" | "IN_REPAIR" | "READY" | "DELIVERED" | "CANCELLED";

export const WO_STATUS_ORDER: WorkOrderStatus[] = ["RECEIVED", "DIAGNOSING", "AWAITING_APPROVAL", "IN_REPAIR", "READY", "DELIVERED", "CANCELLED"];

export const WO_STATUS: Record<WorkOrderStatus, { label: string; color: "default" | "info" | "warning" | "success" | "error" | "primary" }> = {
  RECEIVED: { label: "Recebida", color: "default" },
  DIAGNOSING: { label: "Em diagnóstico", color: "info" },
  AWAITING_APPROVAL: { label: "Aguardando aprovação", color: "warning" },
  IN_REPAIR: { label: "Em reparo", color: "primary" },
  READY: { label: "Pronta", color: "success" },
  DELIVERED: { label: "Entregue", color: "success" },
  CANCELLED: { label: "Cancelada", color: "error" },
};

// Espelha ALLOWED_STATUS_TRANSITIONS do backend (PATCH /work-orders/:id).
// AWAITING_APPROVAL -> IN_REPAIR só ocorre pela aprovação do orçamento; READY -> DELIVERED via /deliver.
export const PATCH_TRANSITIONS: Record<WorkOrderStatus, Array<"RECEIVED" | "DIAGNOSING" | "IN_REPAIR" | "READY" | "CANCELLED">> = {
  RECEIVED: ["DIAGNOSING", "CANCELLED"],
  DIAGNOSING: ["RECEIVED", "CANCELLED"],
  AWAITING_APPROVAL: ["CANCELLED"],
  IN_REPAIR: ["READY", "CANCELLED"],
  READY: ["IN_REPAIR"],
  DELIVERED: [],
  CANCELLED: [],
};

export interface WorkOrderItem {
  id: string;
  productId: string | null;
  description: string;
  itemType: "PART" | "LABOR";
  quantity: string;
  unitPrice: string;
  commissionable: boolean;
}

export interface WorkOrder {
  id: string;
  status: WorkOrderStatus;
  equipmentDescription: string;
  reportedIssue: string;
  diagnosisNotes: string | null;
  budgetValidUntil: string | null;
  budgetApprovalToken: string | null;
  budgetApprovedAt: string | null;
  warrantyDays: number | null;
  deliveredAt: string | null;
  createdAt: string;
  client: { id: string; name: string; phone: string | null };
  assignedTechnician: { id: string; name: string } | null;
  vehicle: { id: string; licensePlate: string; model: string } | null;
  items: WorkOrderItem[];
}

export interface Checklist {
  id: string;
  stage: "ENTRY" | "DIAGNOSIS" | "DELIVERY";
  items: Record<string, unknown>;
  clientSignatureUrl: string | null;
  createdAt: string;
}

export interface Photo {
  id: string;
  storageKey: string;
  caption: string | null;
  createdAt: string;
}

export interface WorkOrderDetail extends WorkOrder {
  checklist: Checklist[];
  photos: Photo[];
}

export const workOrdersApi = {
  list: (status?: string) => api.get<WorkOrder[]>("/work-orders", { status }),
  get: (id: string) => api.get<WorkOrderDetail>(`/work-orders/${id}`),
  create: (input: { clientId: string; equipmentDescription: string; reportedIssue: string; assignedTechnicianId?: string | null; vehicleId?: string | null }) =>
    api.post<WorkOrder>("/work-orders", input),
  update: (id: string, input: { diagnosisNotes?: string | null; status?: string; assignedTechnicianId?: string | null; vehicleId?: string | null }) =>
    api.patch<WorkOrder>(`/work-orders/${id}`, input),
  addItem: (id: string, input: { description: string; itemType: "PART" | "LABOR"; quantity: number; unitPrice: number; commissionable: boolean; productId?: string | null }) =>
    api.post<WorkOrderItem>(`/work-orders/${id}/items`, input),
  removeItem: (id: string, itemId: string) => api.delete(`/work-orders/${id}/items/${itemId}`),
  setBudget: (id: string, input: { validForDays: number; warrantyDays?: number | null; warrantyExclusions?: string | null }) =>
    api.post<WorkOrder>(`/work-orders/${id}/budget`, input),
  approveBudget: (token: string) => api.post<WorkOrder>(`/work-orders/budget-approval/${token}`),
  addChecklist: (id: string, input: { stage: Checklist["stage"]; items: Record<string, boolean> }) =>
    api.post<Checklist>(`/work-orders/${id}/checklist`, input),
  addPhoto: (id: string, input: { storageKey: string; caption?: string | null }) => api.post<Photo>(`/work-orders/${id}/photos`, input),
  deliver: (id: string) => api.post<WorkOrder>(`/work-orders/${id}/deliver`),
};

export function workOrderTotal(items: WorkOrderItem[]): number {
  return items.reduce((sum, i) => sum + Number(i.quantity) * Number(i.unitPrice), 0);
}

// apps/web/src/modules/optical/api.ts
// Contratos reais de apps/api/src/modules/optical/*.routes.ts (Capítulo 11.2 — Ótica).
import { api } from "../../api/client";

export type OpticalLabWorkOrderStatus = "RECEIVED" | "IN_REPAIR" | "READY" | "DELIVERED" | "CANCELLED";

export interface OpticalLabWorkOrder {
  id: string;
  tenantId: string;
  clientId: string;
  status: OpticalLabWorkOrderStatus;
  estimatedReadyAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  opticalPrescriptionId: string | null;
  client: { id: string; name: string; phone: string | null };
  opticalPrescription: { id: string; prescriptionNumber: number } | null;
}

export const opticalLabWorkOrdersApi = {
  list: (status?: OpticalLabWorkOrderStatus) => api.get<OpticalLabWorkOrder[]>("/optical-lab-work-orders", { status }),
  get: (id: string) => api.get<OpticalLabWorkOrder>(`/optical-lab-work-orders/${id}`),
  setStatus: (id: string, status: OpticalLabWorkOrderStatus) => api.patch<OpticalLabWorkOrder>(`/optical-lab-work-orders/${id}/status`, { status }),
};

export interface HealthInsurancePlan {
  id: string;
  tenantId: string;
  name: string;
  billingDueDay: number;
  active: boolean;
}

export interface HealthInsurancePlanInput {
  name: string;
  billingDueDay: number;
  active?: boolean;
}

export const healthInsurancePlansApi = {
  list: () => api.get<HealthInsurancePlan[]>("/health-insurance-plans"),
  create: (input: HealthInsurancePlanInput) => api.post<HealthInsurancePlan>("/health-insurance-plans", input),
  update: (id: string, input: Partial<HealthInsurancePlanInput>) => api.patch<HealthInsurancePlan>(`/health-insurance-plans/${id}`, input),
};

export interface UnbilledSale {
  id: string;
  createdAt: string;
  totalAmount: string;
  status: string;
  client: { id: string; name: string } | null;
}

export interface UnbilledSalesSummary {
  sales: UnbilledSale[];
  totalAmount: string;
  count: number;
}

export interface CloseBillingResult {
  receivable: { id: string; description: string; amount: string; dueDate: string; status: string };
  billedSalesCount: number;
  totalAmount: string;
}

export const healthInsuranceBillingApi = {
  unbilledSales: (planId: string) => api.get<UnbilledSalesSummary>(`/health-insurance-plans/${planId}/unbilled-sales`),
  closeBilling: (planId: string, input: { dueDate: string; referenceDescription?: string }) =>
    api.post<CloseBillingResult>(`/health-insurance-plans/${planId}/close-billing`, input),
};

// apps/web/src/modules/work-orders/work-order-reports.api.ts
// Contratos reais de work-order-reports.routes.ts (módulo novo, read-only sobre a
// máquina de estados de O.S. — ver nota no arquivo do backend).
import { api } from "../../api/client";

export interface CommissionRow {
  technicianId: string;
  technicianName: string;
  deliveredCount: number;
  commissionableLaborValue: number;
  commissionPercent: number;
  commissionValue: number;
}

export interface CommissionsReport {
  from: string | null;
  to: string | null;
  technicians: CommissionRow[];
}

export interface CommissionRule {
  id: string;
  tenantId: string;
  technicianId: string | null;
  commissionPercent: string;
  technician: { id: string; name: string } | null;
}

export interface WarrantyCheckResult {
  serial: string;
  imei: string | null;
  product: { id: string; name: string };
  hasDeliveredWorkOrder: boolean;
  withinWarranty: boolean;
  warrantyExpiresAt?: string;
  workOrder: {
    id: string;
    equipmentDescription: string;
    deliveredAt: string;
    warrantyDays: number | null;
    warrantyExclusions: string | null;
  } | null;
}

export interface WorkOrderKpis {
  from: string | null;
  to: string | null;
  deliveredCount: number;
  backlogCount: number;
  avgCycleTimeHours: number | null;
  avgLaborTicket: number | null;
  avgPartsTicket: number | null;
  deliveredByTechnician: Array<{ technicianId: string; technicianName: string; deliveredCount: number }>;
}

export interface PeriodParams {
  from?: string;
  to?: string;
  [key: string]: string | undefined;
}

export const workOrderReportsApi = {
  commissions: (params?: PeriodParams) => api.get<CommissionsReport>("/work-order-reports/commissions", params),
  commissionRules: () => api.get<CommissionRule[]>("/work-order-reports/commissions/rules"),
  setCommissionRule: (input: { technicianId: string | null; commissionPercent: number }) =>
    api.put<CommissionRule>("/work-order-reports/commissions/rules", input),
  warrantyCheck: (serial: string) => api.get<WarrantyCheckResult>("/work-order-reports/warranty-check", { serial }),
  kpis: (params?: PeriodParams) => api.get<WorkOrderKpis>("/work-order-reports/kpis", params),
};

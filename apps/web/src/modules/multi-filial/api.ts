// apps/web/src/modules/multi-filial/api.ts
// Contratos reais de apps/api/src/modules/multi-filial/multi-filial.routes.ts.
import { api } from "../../api/client";

export interface BranchSummary {
  id: string;
  tradeName: string;
  slug: string;
  status: string;
  uf: string | null;
}

export interface BranchesResponse {
  matriz: BranchSummary;
  branches: BranchSummary[];
}

export interface BranchDashboardRow {
  tenantId: string;
  tradeName: string;
  slug: string;
  status: string;
  uf: string | null;
  isMatriz: boolean;
  salesToday: { count: number; total: number };
  salesMonth: { count: number; total: number };
  openCashRegisters: number;
  lowStockProductsCount: number;
}

export interface MultiFilialDashboard {
  branches: BranchDashboardRow[];
  totals: {
    salesTodayCount: number;
    salesTodayTotal: number;
    salesMonthCount: number;
    salesMonthTotal: number;
    openCashRegisters: number;
    lowStockProductsCount: number;
  };
}

export const multiFilialApi = {
  branches: () => api.get<BranchesResponse>("/multi-filial/branches"),
  dashboard: () => api.get<MultiFilialDashboard>("/multi-filial/dashboard"),
};

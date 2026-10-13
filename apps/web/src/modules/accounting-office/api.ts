// apps/web/src/modules/accounting-office/api.ts
// Contratos reais de apps/api/src/modules/accounting-office/accounting-office.routes.ts.
import { api } from "../../api/client";

export type AccountingEngagementScope = "FULL_BOOKKEEPING" | "TAX_FILING" | "PAYROLL_ESOCIAL" | "PERSONAL_INCOME_TAX" | "DOCUMENT_EXPORT_ONLY";

export type AccountingEngagementStatus = "PENDING_ACCOUNTANT_ACCEPTANCE" | "ACTIVE" | "REVOKED" | "EXPIRED";

export interface AccountingEngagement {
  id: string;
  clientTenantId: string;
  accountingFirmTenantId: string;
  scopes: AccountingEngagementScope[];
  status: AccountingEngagementStatus;
  grantedAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
}

export interface AccountingFirmProfile {
  id: string;
  tenantId: string;
  crcNumber: string;
  responsibleAccountantName: string;
  responsibleAccountantCrc: string;
  bio: string | null;
  servicesOffered: string[];
  baseMonthlyFee: string | null;
  isListedInMarketplace: boolean;
}

export interface AccountingFirmProfileInput {
  crcNumber: string;
  responsibleAccountantName: string;
  responsibleAccountantCrc: string;
  bio?: string;
  servicesOffered: string[];
  baseMonthlyFee?: number;
  isListedInMarketplace: boolean;
}

export type AccountingTaskStatus = "PENDING" | "IN_PROGRESS" | "DONE" | "LATE" | "BLOCKED";

export interface AccountingTask {
  id: string;
  accountingFirmTenantId: string;
  clientTenantId: string;
  competencia: string;
  dueDate: string;
  status: AccountingTaskStatus;
  assignedUserId: string | null;
  completedAt: string | null;
}

export interface OfficialTaxDocument {
  id: string;
  tenantId: string;
  documentType: string;
  generatedAt: string;
}

export const accountingOfficeApi = {
  getFirmProfile: () => api.get<AccountingFirmProfile | null>("/accounting-firm-profile"),
  saveFirmProfile: (input: AccountingFirmProfileInput) => api.put<AccountingFirmProfile>("/accounting-firm-profile", input),

  listEngagements: () => api.get<AccountingEngagement[]>("/accounting-engagements"),
  grantEngagement: (input: { accountingFirmTenantId: string; scopes: AccountingEngagementScope[] }) =>
    api.post<AccountingEngagement>("/accounting-engagements", input),
  acceptEngagement: (id: string) => api.post<AccountingEngagement>(`/accounting-engagements/${id}/accept`),
  revokeEngagement: (id: string, reason?: string) => api.post<AccountingEngagement>(`/accounting-engagements/${id}/revoke`, { reason }),

  listTasks: (params?: { competencia?: string; status?: AccountingTaskStatus }) => api.get<AccountingTask[]>("/accounting-tasks", params),
  updateTask: (id: string, input: Partial<{ status: AccountingTaskStatus; assignedUserId: string | null }>) =>
    api.patch<AccountingTask>(`/accounting-tasks/${id}`, input),

  listOfficialDocuments: (params?: { documentType?: string; clientTenantId?: string }) =>
    api.get<OfficialTaxDocument[]>("/official-tax-documents", params),
};

export const ENGAGEMENT_SCOPE_LABEL: Record<AccountingEngagementScope, string> = {
  FULL_BOOKKEEPING: "Escrituração completa",
  TAX_FILING: "Entrega de obrigações fiscais",
  PAYROLL_ESOCIAL: "Folha / eSocial",
  PERSONAL_INCOME_TAX: "IRPF pessoa física",
  DOCUMENT_EXPORT_ONLY: "Somente exportação de documentos",
};

export const ENGAGEMENT_STATUS_LABEL: Record<AccountingEngagementStatus, string> = {
  PENDING_ACCOUNTANT_ACCEPTANCE: "Aguardando aceite do contador",
  ACTIVE: "Ativo",
  REVOKED: "Revogado",
  EXPIRED: "Expirado",
};

export const TASK_STATUS_LABEL: Record<AccountingTaskStatus, string> = {
  PENDING: "Pendente",
  IN_PROGRESS: "Em andamento",
  DONE: "Concluída",
  LATE: "Atrasada",
  BLOCKED: "Bloqueada",
};

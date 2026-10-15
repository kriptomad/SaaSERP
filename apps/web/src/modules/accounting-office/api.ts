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
  status: "DRAFT" | "GENERATED" | "TRANSMITTED" | "REJECTED";
  generatedAt: string;
}

export type OfficialTaxDocumentGenerationType = "ECD" | "DEFIS" | "ECF" | "EFD_REINF" | "DCTFWEB" | "INFORME_RENDIMENTOS_SOCIO";

export interface GenerateDocumentInput {
  documentType: OfficialTaxDocumentGenerationType;
  clientTenantId?: string;
  competenciaInicio?: string;
  competenciaFim?: string;
  calendarYear?: number;
  competencia?: string; // "AAAA-MM"
  activityType?: "COMERCIO" | "SERVICO";
  partnerId?: string;
}

export interface CompanyPartner {
  id: string;
  tenantId: string;
  name: string;
  cpf: string;
  participationPercentage: string;
}

export type PartnerPayoutType = "PRO_LABORE" | "PROFIT_DISTRIBUTION";

export interface PartnerPayout {
  id: string;
  partnerId: string;
  type: PartnerPayoutType;
  competencia: string;
  grossAmount: string;
  inssWithheld: string;
  irrfWithheld: string;
  netAmount: string;
  paidAt: string;
}


export interface FirmPortfolioClient {
  engagementId: string;
  clientTenantId: string;
  clientTradeName: string;
  clientSlug: string;
  clientCnpj: string | null;
  scopes: AccountingEngagementScope[];
  grantedAt: string;
  tasks: { pending: number; late: number; done: number };
}

export interface FirmPortfolioTaskQueueItem {
  id: string;
  clientTradeName: string;
  clientSlug: string;
  taskType: string;
  competencia: string;
  dueDate: string;
  status: AccountingTaskStatus;
}

export interface FirmPortfolio {
  clients: FirmPortfolioClient[];
  taskQueue: FirmPortfolioTaskQueueItem[];
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
  generateDocument: (input: GenerateDocumentInput) => api.post<OfficialTaxDocument>("/official-tax-documents/generate", input),
  downloadDocument: (id: string) => api.get<{ downloadUrl: string; expiresInSeconds: number }>(`/official-tax-documents/${id}/download`),

  listPartners: () => api.get<CompanyPartner[]>("/company-partners"),
  createPartner: (input: { name: string; cpf: string; participationPercentage: number }) => api.post<CompanyPartner>("/company-partners", input),
  updatePartner: (id: string, input: Partial<{ name: string; cpf: string; participationPercentage: number }>) =>
    api.patch<CompanyPartner>(`/company-partners/${id}`, input),
  deletePartner: (id: string) => api.delete(`/company-partners/${id}`),
  listPartnerPayouts: (partnerId: string) => api.get<PartnerPayout[]>(`/company-partners/${partnerId}/payouts`),
  createPartnerPayout: (
    partnerId: string,
    input: { type: PartnerPayoutType; competencia: string; grossAmount: number; inssWithheld?: number; irrfWithheld?: number; paidAt: string },
  ) => api.post<PartnerPayout>(`/company-partners/${partnerId}/payouts`, input),

  getFirmPortfolio: () => api.get<FirmPortfolio>("/accounting-firm-portfolio"),
};

export const DOCUMENT_TYPE_LABEL: Record<OfficialTaxDocumentGenerationType, string> = {
  ECD: "ECD — Escrituração Contábil Digital",
  DEFIS: "DEFIS — Simples Nacional",
  ECF: "ECF — Escrituração Contábil Fiscal",
  EFD_REINF: "Pró-labore — eSocial S-1200/S-1210 (alimenta DCTFWeb)",
  DCTFWEB: "DCTFWeb — Débitos de INSS sobre pró-labore",
  INFORME_RENDIMENTOS_SOCIO: "Informe de Rendimentos do Sócio",
};

export const PARTNER_PAYOUT_TYPE_LABEL: Record<PartnerPayoutType, string> = {
  PRO_LABORE: "Pró-labore (tributável)",
  PROFIT_DISTRIBUTION: "Distribuição de lucros (isenta)",
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

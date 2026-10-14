// apps/web/src/modules/licensing/api.ts
// Contratos reais de apps/api/src/modules/licensing/licensing.routes.ts (Capítulo 2.10).
// Licença Mestra: controle técnico de acesso/offline do app — DISTINTO do billing/
// assinatura (ver apps/web/src/modules/... não existe tela de billing separada ainda)
// e do RBAC interno (`User.role`), que é outro conceito (ver comentário no backend).
import { api } from "../../api/client";

export type TenantLicenseStatus = "TRIAL" | "ACTIVE" | "EXPIRED" | "SUSPENDED";

export interface TenantLicenseActivation {
  id: string;
  deviceFingerprint: string;
  deviceLabel: string | null;
  activatedAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
}

export interface TenantLicenseSummary {
  status: TenantLicenseStatus;
  trialEndsAt: string | null;
  licensedModules: string[];
  lastValidatedAt: string | null;
  offlineTokenIssuedAt: string | null;
  offlineTokenExpiresAt: string | null;
}

export interface LicensingStatusResponse {
  license: TenantLicenseSummary | null;
  activations?: TenantLicenseActivation[];
  canStartTrial: boolean;
  tenantStatus: string;
  tenantLocked?: boolean;
}

export interface ActivateLicenseInput {
  deviceFingerprint: string;
  deviceLabel?: string | null;
}

export interface ActivateLicenseResponse {
  token: string;
  status: TenantLicenseStatus;
  licensedModules: string[];
  trialEndsAt: string | null;
  offlineTokenIssuedAt: string;
  offlineTokenExpiresAt: string;
}

export interface TrialResponse {
  status: TenantLicenseStatus;
  trialEndsAt: string;
  licensedModules: string[];
}

export const licensingApi = {
  getStatus: () => api.get<LicensingStatusResponse>("/licensing/status"),
  startTrial: () => api.post<TrialResponse>("/licensing/trial"),
  activate: (input: ActivateLicenseInput) => api.post<ActivateLicenseResponse>("/licensing/activate", input),
  revokeActivation: (id: string) => api.post<{ id: string; revokedAt: string }>(`/licensing/activations/${id}/revoke`),
};

export const LICENSE_STATUS_LABEL: Record<TenantLicenseStatus, string> = {
  TRIAL: "Trial (15 dias)",
  ACTIVE: "Ativa",
  EXPIRED: "Expirada",
  SUSPENDED: "Suspensa",
};

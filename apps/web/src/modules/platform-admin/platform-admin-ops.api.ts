// apps/web/src/modules/platform-admin/platform-admin-ops.api.ts
// Cliente tipado das rotas operacionais do painel de plataforma (Capítulo 13):
// tenants, impersonation, dashboard de receita, audit log, parâmetros de sistema e
// feature flags/catálogo de módulos. Reaproveita 100% `platformAdminApi` existente.
import { platformAdminApi } from "./platform-admin-client";

export interface TenantSummary {
  id: string;
  slug: string;
  legalName: string;
  tradeName: string;
  status: "TRIAL" | "ACTIVE" | "PAST_DUE" | "SUSPENDED" | "CANCELLED";
  tenantType: "BUSINESS" | "PERSONAL" | "ACCOUNTING_OFFICE";
  cnpj: string | null;
  createdAt: string;
}

export function listTenants(params?: { status?: string; search?: string }): Promise<TenantSummary[]> {
  const query = new URLSearchParams();
  if (params?.status) query.set("status", params.status);
  if (params?.search) query.set("search", params.search);
  const qs = query.toString();
  return platformAdminApi.get(`/platform-admin/tenants${qs ? `?${qs}` : ""}`);
}

export function getTenant(id: string): Promise<TenantSummary> {
  return platformAdminApi.get(`/platform-admin/tenants/${id}`);
}

export function updateTenantStatus(id: string, input: { status: TenantSummary["status"]; reason: string }): Promise<TenantSummary> {
  return platformAdminApi.patch(`/platform-admin/tenants/${id}/status`, input);
}

export interface ImpersonationStartResult {
  impersonationSessionId: string;
  expiresAt: string;
  token: string;
  tenant: { id: string; slug: string; tradeName: string; status: string; tenantType: string; cnpj: string | null };
  user: { id: string; name: string; email: string; role: string };
}

export function startImpersonation(tenantId: string, reason: string): Promise<ImpersonationStartResult> {
  return platformAdminApi.post(`/platform-admin/tenants/${tenantId}/impersonate`, { reason });
}

export interface ImpersonationSessionRecord {
  id: string;
  tenantId: string;
  reason: string;
  startedAt: string;
  expiresAt: string;
  endedAt: string | null;
  tenant: { tradeName: string; slug: string };
  platformAdminUser: { name: string; email: string };
}

export function listImpersonationSessions(tenantId?: string): Promise<ImpersonationSessionRecord[]> {
  return platformAdminApi.get(`/platform-admin/impersonation-sessions${tenantId ? `?tenantId=${tenantId}` : ""}`);
}

export function endImpersonationSession(id: string): Promise<ImpersonationSessionRecord> {
  return platformAdminApi.post(`/platform-admin/impersonation-sessions/${id}/end`);
}

export interface RevenueDashboard {
  totalMrr: number;
  arr: number;
  countByStatus: Record<string, number>;
  byPlan: Array<{ planCode: string; planLabel: string; activeCount: number; mrr: number }>;
  byModule: Array<{ moduleCode: string; moduleLabel: string; activeTenantCount: number; mrr: number }>;
  totalModuleMrr: number;
  ltvByPlan: Array<{ planCode: string; planLabel: string; arpu: number; ltv: number | null }>;
  projectedMrrIn3Months: number;
  avgMonthlyNetNewMrr: number;
  churnedThisMonth: number;
  totalSubscriptions: number;
}

export function fetchRevenueDashboard(): Promise<RevenueDashboard> {
  return platformAdminApi.get("/platform-admin/revenue-dashboard");
}

export interface AuditLogEntry {
  id: string;
  platformAdminUserId: string;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export function listAuditLogs(params?: { targetType?: string; targetId?: string }): Promise<AuditLogEntry[]> {
  const query = new URLSearchParams();
  if (params?.targetType) query.set("targetType", params.targetType);
  if (params?.targetId) query.set("targetId", params.targetId);
  const qs = query.toString();
  return platformAdminApi.get(`/platform-admin/audit-logs${qs ? `?${qs}` : ""}`);
}

export interface SystemParameter {
  key: string;
  value: string;
  description: string;
  updatedByPlatformAdminUserId: string | null;
}

export function listSystemParameters(): Promise<SystemParameter[]> {
  return platformAdminApi.get("/platform-admin/system-parameters");
}

export function updateSystemParameter(key: string, value: string): Promise<SystemParameter> {
  return platformAdminApi.put(`/platform-admin/system-parameters/${key}`, { value });
}

export interface FeatureFlag {
  id: string;
  key: string;
  description: string;
  rolloutPercent: number;
  enabledForTenantIds: string[];
  active: boolean;
}

export function listFeatureFlags(): Promise<FeatureFlag[]> {
  return platformAdminApi.get("/platform-admin/feature-flags");
}

export function createFeatureFlag(input: Omit<FeatureFlag, "id">): Promise<FeatureFlag> {
  return platformAdminApi.post("/platform-admin/feature-flags", input);
}

export function updateFeatureFlag(id: string, input: Partial<Omit<FeatureFlag, "id" | "key">>): Promise<FeatureFlag> {
  return platformAdminApi.patch(`/platform-admin/feature-flags/${id}`, input);
}

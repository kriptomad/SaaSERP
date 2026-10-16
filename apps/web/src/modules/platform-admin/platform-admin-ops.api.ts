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
  platformAdminUser?: { id: string; name: string; email: string };
}

export function listAuditLogs(params?: {
  targetType?: string;
  targetId?: string;
  action?: string;
  platformAdminUserId?: string;
  from?: string;
  to?: string;
}): Promise<AuditLogEntry[]> {
  const query = new URLSearchParams();
  if (params?.targetType) query.set("targetType", params.targetType);
  if (params?.targetId) query.set("targetId", params.targetId);
  if (params?.action) query.set("action", params.action);
  if (params?.platformAdminUserId) query.set("platformAdminUserId", params.platformAdminUserId);
  if (params?.from) query.set("from", params.from);
  if (params?.to) query.set("to", params.to);
  const qs = query.toString();
  return platformAdminApi.get(`/platform-admin/audit-logs${qs ? `?${qs}` : ""}`);
}

export interface PlatformAdminUserSummary {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
}

export function listPlatformAdminUsers(): Promise<PlatformAdminUserSummary[]> {
  return platformAdminApi.get("/platform-admin/admin-users");
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

// ─────────────────────────────────────────────────────────────────────────
// CENTRAL DE INTEGRAÇÕES (Capítulo 20.10) — GAP DE AUDITORIA FECHADO (mega-audit
// rodada 8): endpoint já existia no backend desde a rodada anterior, mas sem
// nenhuma tela consumindo-o.
// ─────────────────────────────────────────────────────────────────────────

export interface IntegrationProviderSummary {
  provider: string;
  activeTenantCount: number;
  totalCredentialCount: number;
  last100SuccessRate: number | null;
  sampledChecks: number;
}

export function fetchIntegrationsSummary(): Promise<IntegrationProviderSummary[]> {
  return platformAdminApi.get("/platform-admin/integrations/summary");
}

// ─────────────────────────────────────────────────────────────────────────
// SUPPORT TICKETS / HELPDESK (Capítulo 15.3) — GAP DE AUDITORIA FECHADO
// ─────────────────────────────────────────────────────────────────────────

export interface SupportTicketMessage {
  id: string;
  ticketId: string;
  authorType: "TENANT_USER" | "PLATFORM_ADMIN";
  authorId: string;
  body: string;
  attachmentUrls: string[];
  createdAt: string;
}

export interface SupportTicketSummary {
  id: string;
  tenantId: string;
  openedByUserId: string;
  assignedToPlatformAdminUserId: string | null;
  subject: string;
  category: string;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  status: "OPEN" | "IN_PROGRESS" | "WAITING_CUSTOMER" | "RESOLVED" | "CLOSED";
  createdAt: string;
  resolvedAt: string | null;
  messages?: SupportTicketMessage[];
}

export function listSupportTickets(params?: { status?: string; assignedToMe?: boolean }): Promise<SupportTicketSummary[]> {
  const query = new URLSearchParams();
  if (params?.status) query.set("status", params.status);
  if (params?.assignedToMe) query.set("assignedToMe", "true");
  const qs = query.toString();
  return platformAdminApi.get(`/platform-admin/support-tickets${qs ? `?${qs}` : ""}`);
}

export function getSupportTicket(id: string): Promise<SupportTicketSummary> {
  return platformAdminApi.get(`/platform-admin/support-tickets/${id}`);
}

export function updateSupportTicket(
  id: string,
  input: Partial<{ assignedToPlatformAdminUserId: string | null; status: SupportTicketSummary["status"]; priority: SupportTicketSummary["priority"] }>,
): Promise<SupportTicketSummary> {
  return platformAdminApi.patch(`/platform-admin/support-tickets/${id}`, input);
}

export function addSupportTicketMessage(id: string, body: string): Promise<SupportTicketMessage> {
  return platformAdminApi.post(`/platform-admin/support-tickets/${id}/messages`, { body, attachmentUrls: [] });
}

// ─────────────────────────────────────────────────────────────────────────
// OVERSIGHT DE API KEYS E WEBHOOKS DOS TENANTS (Capítulo 15.4) — GAP DE
// AUDITORIA FECHADO
// ─────────────────────────────────────────────────────────────────────────

export interface TenantApiKeySummary {
  id: string;
  tenantId: string;
  label: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export function listTenantApiKeys(tenantId: string): Promise<TenantApiKeySummary[]> {
  return platformAdminApi.get(`/platform-admin/tenants/${tenantId}/api-keys`);
}

export function revokeTenantApiKey(id: string): Promise<TenantApiKeySummary> {
  return platformAdminApi.post(`/platform-admin/tenant-api-keys/${id}/revoke`);
}

export interface TenantWebhookEndpointSummary {
  id: string;
  tenantId: string;
  url: string;
  eventTypes: string[];
  active: boolean;
  createdAt: string;
}

export function listTenantWebhookEndpoints(tenantId: string): Promise<TenantWebhookEndpointSummary[]> {
  return platformAdminApi.get(`/platform-admin/tenants/${tenantId}/webhook-endpoints`);
}

export interface WebhookDeliverySummary {
  id: string;
  endpointId: string;
  eventType: string;
  statusCode: number | null;
  success: boolean;
  attemptCount: number;
  deliveredAt: string;
}

export function listWebhookDeliveries(endpointId: string): Promise<WebhookDeliverySummary[]> {
  return platformAdminApi.get(`/platform-admin/webhook-endpoints/${endpointId}/deliveries`);
}

export function replayWebhookDelivery(id: string): Promise<{ id: string; replayQueued: true }> {
  return platformAdminApi.post(`/platform-admin/webhook-deliveries/${id}/replay`);
}

// ─────────────────────────────────────────────────────────────────────────
// PLANOS E CATÁLOGO DE MÓDULOS DE BILLING (Capítulo 2.9/13.3) — GAP DE
// AUDITORIA FECHADO: CRUD já existia no backend desde a rodada anterior
// (substituindo o seed script como única forma de criar/editar planos e
// módulos de billing), mas sem nenhuma tela consumindo-o.
// ─────────────────────────────────────────────────────────────────────────

export interface PlanSummary {
  id: string;
  code: string;
  label: string;
  basePrice: number;
  includedModules: string[];
  active: boolean;
  audience: "BUSINESS" | "PERSONAL" | "BOTH";
  maxConnectedAccounts: number | null;
  includedUserSeats: number | null;
  extraUserSeatPrice: number | null;
}

export function listPlans(): Promise<PlanSummary[]> {
  return platformAdminApi.get("/platform-admin/plans");
}

export function createPlan(input: Omit<PlanSummary, "id">): Promise<PlanSummary> {
  return platformAdminApi.post("/platform-admin/plans", input);
}

export function updatePlan(id: string, input: Partial<Omit<PlanSummary, "id" | "code">>): Promise<PlanSummary> {
  return platformAdminApi.patch(`/platform-admin/plans/${id}`, input);
}

export interface BillingModuleSummary {
  id: string;
  code: string;
  label: string;
  monthlyPrice: number;
  description: string;
  active: boolean;
}

export function listBillingModules(): Promise<BillingModuleSummary[]> {
  return platformAdminApi.get("/platform-admin/modules");
}

export function createBillingModule(input: Omit<BillingModuleSummary, "id">): Promise<BillingModuleSummary> {
  return platformAdminApi.post("/platform-admin/modules", input);
}

export function updateBillingModule(id: string, input: Partial<Omit<BillingModuleSummary, "id" | "code">>): Promise<BillingModuleSummary> {
  return platformAdminApi.patch(`/platform-admin/modules/${id}`, input);
}

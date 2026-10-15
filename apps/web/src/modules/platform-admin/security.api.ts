// apps/web/src/modules/platform-admin/security.api.ts
// Cliente HTTP da aba "Segurança" do painel de administração de plataforma (ver
// apps/api/src/modules/platform-admin/platform-admin-auth.routes.ts, Cap. 14.4/14.5):
// sessões ativas revogáveis + allowlist de IP, ambas escopadas à PRÓPRIA conta do
// admin autenticado (nunca de outro admin).
import { platformAdminApi } from "./platform-admin-client";

export interface ActiveSessionSummary {
  id: string;
  ipAddress: string;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  isCurrent: boolean;
}

export async function fetchActiveSessions(): Promise<ActiveSessionSummary[]> {
  return platformAdminApi.get<ActiveSessionSummary[]>("/platform-admin/auth/sessions");
}

export async function revokeActiveSession(id: string): Promise<{ revoked: boolean }> {
  return platformAdminApi.post<{ revoked: boolean }>(`/platform-admin/auth/sessions/${encodeURIComponent(id)}/revoke`);
}

export interface IpAllowlistEntry {
  id: string;
  cidrRange: string;
  label: string;
  createdAt: string;
}

export async function fetchIpAllowlist(): Promise<IpAllowlistEntry[]> {
  return platformAdminApi.get<IpAllowlistEntry[]>("/platform-admin/auth/ip-allowlist");
}

export async function createIpAllowlistEntry(cidrRange: string, label: string): Promise<IpAllowlistEntry> {
  return platformAdminApi.post<IpAllowlistEntry>("/platform-admin/auth/ip-allowlist", { cidrRange, label });
}

export async function deleteIpAllowlistEntry(id: string): Promise<{ deleted: boolean }> {
  return platformAdminApi.delete<{ deleted: boolean }>(`/platform-admin/auth/ip-allowlist/${encodeURIComponent(id)}`);
}

// apps/web/src/modules/platform-admin/platform-secrets.api.ts
// Cliente HTTP da aba "Infraestrutura & Credenciais" do painel de administração de
// plataforma (ver apps/api/src/lib/platform-secrets.ts e platform-secrets.routes.ts).
import { platformAdminApi } from "./platform-admin-client";

export interface PlatformSecretStatus {
  key: string;
  label: string;
  group: "Stripe" | "Asaas" | "Licenciamento" | "Rede" | "Armazenamento (R2)";
  description: string;
  envFallback: string;
  placeholder?: string;
  configuredSource: "database" | "env" | "none";
  maskedValue: string | null;
  updatedAt: string | null;
}

export async function fetchPlatformSecretStatuses(): Promise<PlatformSecretStatus[]> {
  return platformAdminApi.get<PlatformSecretStatus[]>("/platform-admin/platform-secrets");
}

export async function updatePlatformSecret(key: string, value: string | null): Promise<PlatformSecretStatus> {
  return platformAdminApi.put<PlatformSecretStatus>(`/platform-admin/platform-secrets/${encodeURIComponent(key)}`, { value });
}

export interface R2ConnectionTestResult {
  success: boolean;
  message: string;
}

export async function testR2Connection(): Promise<R2ConnectionTestResult> {
  return platformAdminApi.post<R2ConnectionTestResult>("/platform-admin/platform-secrets/test-r2");
}

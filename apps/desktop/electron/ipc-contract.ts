// apps/desktop/electron/ipc-contract.ts
// Contrato compartilhado entre main (electron/main.ts) e renderer (src/api/desktopApi.ts)
// via contextBridge (electron/preload.ts). Mantido como um único arquivo de tipos para
// os dois lados nunca divergirem de assinatura.

export type InstallMode = "HOST" | "CLIENT";

export interface NetworkConfig {
  /** IP de bind do backend local quando em modo HOST: "0.0.0.0" (todas interfaces) ou um IP específico da LAN. */
  bindAddress: string;
  port: number;
  backupFolderPath: string | null;
  backupSchedule: "DISABLED" | "DAILY" | "WEEKLY";
  databaseUrl: string;
}

export interface ClientHostConfig {
  /** IP:porta do PC rodando em modo HOST, configurado pelo usuário em modo CLIENT. */
  host: string;
  port: number;
  useHttps: boolean;
}

export interface LicenseCache {
  token: string;
  tenantId: string;
  plan: string;
  expiresAt: string;
  mode: "TRIAL" | "ACTIVATED";
  cachedAt: string;
}

export interface DesktopConfig {
  installMode: InstallMode | null;
  network: NetworkConfig;
  clientHost: ClientHostConfig | null;
  license: LicenseCache | null;
  onboardingComplete: boolean;
}

export type BackendStatus = "STOPPED" | "STARTING" | "RUNNING" | "ERROR";

export interface BackendState {
  status: BackendStatus;
  pid: number | null;
  lastError: string | null;
  apiBaseUrl: string | null;
}

export interface HealthPingResult {
  ok: boolean;
  latencyMs: number | null;
  detail?: string;
}

export const IPC_CHANNELS = {
  CONFIG_GET: "config:get",
  CONFIG_SET: "config:set",
  BACKEND_START: "backend:start",
  BACKEND_STOP: "backend:stop",
  BACKEND_STATUS: "backend:status",
  BACKEND_STATUS_CHANGED: "backend:status-changed",
  DIALOG_CHOOSE_FOLDER: "dialog:choose-folder",
  NETWORK_LOCAL_IPS: "network:local-ips",
  NETWORK_PING_URL: "network:ping-url",
  LICENSE_ACTIVATE: "license:activate",
  LICENSE_TRIAL: "license:trial",
  LICENSE_STATUS: "license:status",
  WINDOW_OPEN_ERP: "window:open-erp",
  APP_VERSION: "app:version",
} as const;

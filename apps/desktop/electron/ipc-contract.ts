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

/** Mesmos valores de `TenantLicenseStatus` no schema Prisma (packages/db). */
export type LicenseStatus = "TRIAL" | "ACTIVE" | "SUSPENDED" | "EXPIRED";

/**
 * Espelha EXATAMENTE o shape retornado por POST /licensing/trial, POST /licensing/activate
 * e GET /licensing/status (apps/api/src/modules/licensing/licensing.routes.ts) — nunca um
 * shape inventado no shell desktop. `token` só existe após /licensing/activate (token
 * offline RS256 de curta duração); o trial sozinho não emite token offline.
 */
export interface LicenseCache {
  token: string | null;
  status: LicenseStatus;
  licensedModules: string[];
  trialEndsAt: string | null;
  offlineTokenExpiresAt: string | null;
  cachedAt: string;
}

/**
 * Sessão do usuário de sistema (login real via POST /auth/login, mesmo endpoint do
 * apps/web) — necessária porque as rotas /licensing/* exigem `requireAuth` (a "licença
 * mestra" é consultada no contexto de um tenant já autenticado, Capítulo 2.10). Sem
 * isso o onboarding do desktop não teria como chamar /licensing/activate|trial|status.
 * Espelha EXATAMENTE `AuthResponse` de apps/web/src/api/client.ts (mesmo contrato de
 * POST /auth/login) para poder ser repassada como SSO para a janela do apps/web
 * (window:open-erp) sem pedir login uma segunda vez.
 */
export interface TenantSessionCache {
  token: string;
  tenant: { id: string; slug: string; tradeName: string; status: string; tenantType: string };
  user: { id: string; name: string; email: string; role: string };
}

export interface DesktopConfig {
  installMode: InstallMode | null;
  network: NetworkConfig;
  clientHost: ClientHostConfig | null;
  session: TenantSessionCache | null;
  /** UUID estável deste PC, gerado uma vez e persistido — usado como `deviceFingerprint` em /licensing/activate. */
  deviceId: string | null;
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

/**
 * Dados computados e validados 100% no processo main, entregues à janela do
 * `apps/web` (erpWindow) via canal IPC síncrono dedicado (`ERP_BOOTSTRAP`) — nunca
 * mais via query string da URL (ver fa-desktop-sso-in-url, fa-desktop-arbitrary-erp-url).
 * `sso` é consumido uma única vez (o main apaga seu registro interno após a primeira
 * leitura desta janela).
 */
export interface ErpBootstrapPayload {
  apiBaseUrl: string;
  sso: TenantSessionCache | null;
}

// CORREÇÃO DE AUDITORIA (fa-desktop-config-patch-bypass): o antigo `CONFIG_SET`
// genérico aceitava qualquer `Partial<DesktopConfig>` vindo do renderer, incluindo
// `license`/`session`/`deviceId` — um renderer comprometido (ex. via XSS numa
// dependência) podia fabricar uma licença válida só escrevendo esses campos
// diretamente no config-store. Agora cada campo tem um canal IPC próprio, com
// validação de schema (ver `validation.ts`), e `license`/`session`/`deviceId` NUNCA
// são aceitos vindos do renderer — só o próprio main os escreve, sempre como
// resultado de uma resposta validada da API real (login/ativação/trial/status).
export const IPC_CHANNELS = {
  CONFIG_GET: "config:get",
  CONFIG_SET_INSTALL_MODE: "config:set-install-mode",
  CONFIG_SET_NETWORK: "config:set-network",
  CONFIG_SET_CLIENT_HOST: "config:set-client-host",
  CONFIG_SET_ONBOARDING_COMPLETE: "config:set-onboarding-complete",
  BACKEND_START: "backend:start",
  BACKEND_STOP: "backend:stop",
  BACKEND_STATUS: "backend:status",
  BACKEND_STATUS_CHANGED: "backend:status-changed",
  DIALOG_CHOOSE_FOLDER: "dialog:choose-folder",
  NETWORK_LOCAL_IPS: "network:local-ips",
  NETWORK_PING_URL: "network:ping-url",
  NETWORK_TEST_CANDIDATE_HOST: "network:test-candidate-host",
  LICENSE_ACTIVATE: "license:activate",
  LICENSE_TRIAL: "license:trial",
  LICENSE_STATUS: "license:status",
  AUTH_LOGIN: "auth:login",
  AUTH_LOGOUT: "auth:logout",
  WINDOW_OPEN_ERP: "window:open-erp",
  APP_VERSION: "app:version",
  ERP_BOOTSTRAP: "erp:bootstrap",
} as const;

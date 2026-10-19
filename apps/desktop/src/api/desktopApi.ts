// apps/desktop/src/api/desktopApi.ts
// Tipagem do bridge exposto pelo preload (electron/preload.ts) via contextBridge.
// Reexporta os tipos do contrato compartilhado para o renderer não duplicar shapes.
import type {
  DesktopConfig,
  NetworkConfig,
  ClientHostConfig,
  InstallMode,
  BackendState,
  HealthPingResult,
  LicenseCache,
  TenantSessionCache,
} from "../../electron/ipc-contract";

export type { DesktopConfig, NetworkConfig, ClientHostConfig, InstallMode, BackendState, HealthPingResult, LicenseCache, TenantSessionCache };

export interface FilitechDesktopBridge {
  config: {
    get(): Promise<DesktopConfig>;
    setInstallMode(installMode: InstallMode): Promise<DesktopConfig>;
    setNetwork(network: NetworkConfig): Promise<DesktopConfig>;
    setClientHost(clientHost: ClientHostConfig): Promise<DesktopConfig>;
    setOnboardingComplete(): Promise<DesktopConfig>;
  };
  backend: {
    start(network: NetworkConfig): Promise<BackendState>;
    stop(): Promise<void>;
    status(): Promise<BackendState>;
    onStatusChanged(callback: (state: BackendState) => void): () => void;
  };
  network: {
    localIps(): Promise<string[]>;
    pingUrl(url: string): Promise<HealthPingResult>;
    testCandidateHost(candidate: ClientHostConfig): Promise<HealthPingResult>;
  };
  dialog: {
    chooseFolder(): Promise<string | null>;
  };
  license: {
    activate(): Promise<LicenseCache | { error: string }>;
    trial(): Promise<LicenseCache | { error: string }>;
    status(): Promise<{ valid: boolean; offline: boolean; license: LicenseCache | null }>;
  };
  auth: {
    login(payload: { tenantSlug: string; email: string; password: string }): Promise<TenantSessionCache | { error: string }>;
    logout(): Promise<void>;
  };
  window: {
    openErp(): Promise<void>;
  };
  app: {
    version(): Promise<string>;
  };
}

declare global {
  interface Window {
    filitech: FilitechDesktopBridge;
  }
}

export function getDesktopApi(): FilitechDesktopBridge {
  if (!window.filitech) {
    throw new Error("Bridge Electron (window.filitech) indisponível — este renderer precisa rodar dentro do shell Electron.");
  }
  return window.filitech;
}

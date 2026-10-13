// apps/desktop/src/api/desktopApi.ts
// Tipagem do bridge exposto pelo preload (electron/preload.ts) via contextBridge.
// Reexporta os tipos do contrato compartilhado para o renderer não duplicar shapes.
import type {
  DesktopConfig,
  NetworkConfig,
  BackendState,
  HealthPingResult,
  LicenseCache,
} from "../../electron/ipc-contract";

export type { DesktopConfig, NetworkConfig, BackendState, HealthPingResult, LicenseCache };

export interface FilitechDesktopBridge {
  config: {
    get(): Promise<DesktopConfig>;
    patch(patch: Partial<DesktopConfig>): Promise<DesktopConfig>;
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
  };
  dialog: {
    chooseFolder(): Promise<string | null>;
  };
  license: {
    activate(payload: { licenseKey: string }): Promise<LicenseCache | { error: string }>;
    trial(payload: { tenantSlug: string; email: string }): Promise<LicenseCache | { error: string }>;
    status(): Promise<{ valid: boolean; offline: boolean; license: LicenseCache | null }>;
  };
  window: {
    openErp(apiBaseUrl: string): Promise<void>;
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

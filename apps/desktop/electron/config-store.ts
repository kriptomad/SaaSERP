// apps/desktop/electron/config-store.ts
// Persistência local do estado de instalação do shell desktop: modo (HOST/CLIENT),
// config de rede, host configurado (modo CLIENT) e cache do token de licença.
// Usa electron-store (JSON em app.getPath("userData")), não um banco — é configuração
// de MÁQUINA, não dado de negócio (esse vive no Postgres via apps/api).
import Store from "electron-store";
import type { DesktopConfig } from "./ipc-contract";

const DEFAULT_CONFIG: DesktopConfig = {
  installMode: null,
  network: {
    bindAddress: "0.0.0.0",
    port: 3333,
    backupFolderPath: null,
    backupSchedule: "DAILY",
    databaseUrl: "postgresql://postgres:postgres@localhost:5432/filitech?schema=public",
  },
  clientHost: null,
  session: null,
  deviceId: null,
  license: null,
  onboardingComplete: false,
};

// electron-store tipa o schema via genérico; cada chave de DesktopConfig vira uma raiz
// própria no JSON para permitir leituras/escritas parciais (store.get("network")).
export const configStore = new Store<DesktopConfig>({
  name: "filitech-desktop-config",
  defaults: DEFAULT_CONFIG,
  clearInvalidConfig: true,
});

export function getFullConfig(): DesktopConfig {
  return {
    installMode: configStore.get("installMode"),
    network: configStore.get("network"),
    clientHost: configStore.get("clientHost"),
    session: configStore.get("session"),
    deviceId: configStore.get("deviceId"),
    license: configStore.get("license"),
    onboardingComplete: configStore.get("onboardingComplete"),
  };
}

export function patchConfig(patch: Partial<DesktopConfig>): DesktopConfig {
  for (const [key, value] of Object.entries(patch)) {
    configStore.set(key as keyof DesktopConfig, value as never);
  }
  return getFullConfig();
}

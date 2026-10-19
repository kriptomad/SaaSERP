// apps/desktop/electron/preload.ts
// Ponte segura renderer <-> main. contextIsolation=true + nodeIntegration=false (padrão
// recomendado do Electron) — o renderer nunca tem acesso direto a `require`/`fs`/`child_process`,
// só ao que é exposto explicitamente aqui via contextBridge.
//
// CORREÇÃO DE AUDITORIA (fa-desktop-config-patch-bypass): `config.patch` genérico foi
// removido — cada campo mutável pelo renderer agora tem um método/canal IPC dedicado,
// validado no main (ver `validation.ts`). `license`, `session` e `deviceId` nunca têm
// um setter exposto aqui: só o main os escreve, sempre a partir de uma resposta real
// da API (login/licenciamento), nunca a partir de um valor arbitrário do renderer.
import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS } from "./ipc-contract";
import type { DesktopConfig, NetworkConfig, ClientHostConfig, InstallMode } from "./ipc-contract";

const api = {
  config: {
    get: (): Promise<DesktopConfig> => ipcRenderer.invoke(IPC_CHANNELS.CONFIG_GET),
    setInstallMode: (installMode: InstallMode): Promise<DesktopConfig> =>
      ipcRenderer.invoke(IPC_CHANNELS.CONFIG_SET_INSTALL_MODE, { installMode }),
    setNetwork: (network: NetworkConfig): Promise<DesktopConfig> =>
      ipcRenderer.invoke(IPC_CHANNELS.CONFIG_SET_NETWORK, network),
    setClientHost: (clientHost: ClientHostConfig): Promise<DesktopConfig> =>
      ipcRenderer.invoke(IPC_CHANNELS.CONFIG_SET_CLIENT_HOST, clientHost),
    setOnboardingComplete: (): Promise<DesktopConfig> =>
      ipcRenderer.invoke(IPC_CHANNELS.CONFIG_SET_ONBOARDING_COMPLETE, { onboardingComplete: true }),
  },
  backend: {
    start: (network: NetworkConfig) => ipcRenderer.invoke(IPC_CHANNELS.BACKEND_START, network),
    stop: () => ipcRenderer.invoke(IPC_CHANNELS.BACKEND_STOP),
    status: () => ipcRenderer.invoke(IPC_CHANNELS.BACKEND_STATUS),
    onStatusChanged: (callback: (state: unknown) => void) => {
      const listener = (_event: unknown, state: unknown) => callback(state);
      ipcRenderer.on(IPC_CHANNELS.BACKEND_STATUS_CHANGED, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.BACKEND_STATUS_CHANGED, listener);
    },
  },
  network: {
    localIps: (): Promise<string[]> => ipcRenderer.invoke(IPC_CHANNELS.NETWORK_LOCAL_IPS),
    pingUrl: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.NETWORK_PING_URL, url),
    testCandidateHost: (candidate: ClientHostConfig) => ipcRenderer.invoke(IPC_CHANNELS.NETWORK_TEST_CANDIDATE_HOST, candidate),
  },
  dialog: {
    chooseFolder: (): Promise<string | null> => ipcRenderer.invoke(IPC_CHANNELS.DIALOG_CHOOSE_FOLDER),
  },
  license: {
    activate: () => ipcRenderer.invoke(IPC_CHANNELS.LICENSE_ACTIVATE),
    trial: () => ipcRenderer.invoke(IPC_CHANNELS.LICENSE_TRIAL),
    // CORREÇÃO DE AUDITORIA (fa-desktop-license-status-no-signature-check): este
    // método só repassa para o renderer o resultado JÁ validado pelo main
    // (`checkLicenseStatus` em main.ts agora verifica a assinatura RS256 do token
    // offline antes de responder — ver fa-desktop-offline-license-no-signature). O
    // preload não adiciona nem remove nenhuma garantia: é apenas o canal de
    // transporte, nunca a fonte de verdade sobre validade da licença.
    status: () => ipcRenderer.invoke(IPC_CHANNELS.LICENSE_STATUS),
  },
  auth: {
    login: (payload: { tenantSlug: string; email: string; password: string }) =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH_LOGIN, payload),
    logout: () => ipcRenderer.invoke(IPC_CHANNELS.AUTH_LOGOUT),
  },
  window: {
    // CORREÇÃO DE AUDITORIA (fa-desktop-arbitrary-erp-url): não recebe mais
    // `apiBaseUrl` do renderer — o main recalcula a URL a partir do config validado
    // internamente (ver `resolveActiveApiBaseUrl` + allowlist em main.ts).
    openErp: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_OPEN_ERP),
  },
  app: {
    version: (): Promise<string> => ipcRenderer.invoke(IPC_CHANNELS.APP_VERSION),
  },
};

contextBridge.exposeInMainWorld("filitech", api);

export type FilitechDesktopApi = typeof api;

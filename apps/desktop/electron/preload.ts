// apps/desktop/electron/preload.ts
// Ponte segura renderer <-> main. contextIsolation=true + nodeIntegration=false (padrão
// recomendado do Electron) — o renderer nunca tem acesso direto a `require`/`fs`/`child_process`,
// só ao que é exposto explicitamente aqui via contextBridge.
import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS } from "./ipc-contract";
import type { DesktopConfig, NetworkConfig } from "./ipc-contract";

const api = {
  config: {
    get: (): Promise<DesktopConfig> => ipcRenderer.invoke(IPC_CHANNELS.CONFIG_GET),
    patch: (patch: Partial<DesktopConfig>): Promise<DesktopConfig> => ipcRenderer.invoke(IPC_CHANNELS.CONFIG_SET, patch),
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
  },
  dialog: {
    chooseFolder: (): Promise<string | null> => ipcRenderer.invoke(IPC_CHANNELS.DIALOG_CHOOSE_FOLDER),
  },
  license: {
    activate: () => ipcRenderer.invoke(IPC_CHANNELS.LICENSE_ACTIVATE),
    trial: () => ipcRenderer.invoke(IPC_CHANNELS.LICENSE_TRIAL),
    status: () => ipcRenderer.invoke(IPC_CHANNELS.LICENSE_STATUS),
  },
  auth: {
    login: (payload: { tenantSlug: string; email: string; password: string }) =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH_LOGIN, payload),
    logout: () => ipcRenderer.invoke(IPC_CHANNELS.AUTH_LOGOUT),
  },
  window: {
    openErp: (apiBaseUrl: string) => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_OPEN_ERP, apiBaseUrl),
  },
  app: {
    version: (): Promise<string> => ipcRenderer.invoke(IPC_CHANNELS.APP_VERSION),
  },
};

contextBridge.exposeInMainWorld("filitech", api);

export type FilitechDesktopApi = typeof api;

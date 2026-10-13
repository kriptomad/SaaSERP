// apps/desktop/electron/main.ts
// Processo principal do shell desktop Electron. Responsabilidades:
//  1. Janela de onboarding/config/dashboard (renderer próprio deste pacote).
//  2. Em modo HOST: gerenciar o child_process do backend real (apps/api) via backend-manager.ts.
//  3. Expor IPC para config de rede, teste de conectividade, escolha de pasta de backup,
//     licenciamento (ativação/trial/status) e abertura da janela do ERP real (apps/web).
//  4. Abrir uma segunda BrowserWindow carregando apps/web (UI de negócio — NUNCA duplicada
//     aqui) apontando para a API local (HOST) ou remota (CLIENT) via query param `apiBaseUrl`
//     (ver apps/web/src/api/client.ts — pequena extensão para aceitar override em runtime).
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import path from "node:path";
import { IPC_CHANNELS, type DesktopConfig, type LicenseCache } from "./ipc-contract";
import { getFullConfig, patchConfig } from "./config-store";
import { startBackend, stopBackend, getBackendState, onBackendStateChange } from "./backend-manager";
import { listLocalIPv4Addresses, pingUrl } from "./network-utils";

let launcherWindow: BrowserWindow | null = null;
let erpWindow: BrowserWindow | null = null;

const RENDERER_DEV_URL = process.env.ELECTRON_RENDERER_URL;

// URL da API central na nuvem usada quando o app roda sem NENHUM ambiente local
// configurado ainda (primeiro uso, antes de escolher HOST/CLIENT) — ex. para permitir
// iniciar um trial de 15 dias direto contra a nuvem antes mesmo de escolher o modo de
// instalação. Documentado em README.md — endpoint real depende do deploy (Railway).
const CLOUD_API_BASE_URL = process.env.FILITECH_CLOUD_API_URL ?? "https://api.filitech.com.br";

function createLauncherWindow(): void {
  launcherWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 860,
    minHeight: 600,
    title: "Filitech ERP Desktop",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (RENDERER_DEV_URL) {
    launcherWindow.loadURL(RENDERER_DEV_URL);
    launcherWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    launcherWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  launcherWindow.on("closed", () => {
    launcherWindow = null;
  });
}

/** Resolve a API base URL ativa de acordo com o modo de instalação já configurado. */
function resolveActiveApiBaseUrl(config: DesktopConfig): string {
  if (config.installMode === "HOST") {
    const backend = getBackendState();
    return backend.apiBaseUrl ?? `http://127.0.0.1:${config.network.port}`;
  }
  if (config.installMode === "CLIENT" && config.clientHost) {
    const scheme = config.clientHost.useHttps ? "https" : "http";
    return `${scheme}://${config.clientHost.host}:${config.clientHost.port}`;
  }
  return CLOUD_API_BASE_URL;
}

function openErpWindow(apiBaseUrl: string): void {
  if (erpWindow) {
    erpWindow.focus();
    return;
  }
  erpWindow = new BrowserWindow({
    width: 1366,
    height: 860,
    title: "Filitech ERP",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const search = `?apiBaseUrl=${encodeURIComponent(apiBaseUrl)}`;

  if (RENDERER_DEV_URL) {
    // Dev: espera que `npm run web:dev` (apps/web, porta 5173) esteja rodando à parte —
    // documentado no README, pois o shell desktop não gerencia o Vite dev server do web.
    erpWindow.loadURL(`http://localhost:5173/${search}`);
  } else {
    // Produção: apps/web/dist é copiado para resources/web pelo empacotamento
    // (extraResources em package.json) — pendência de validação end-to-end (ver README).
    const webDist = path.join(process.resourcesPath, "web", "index.html");
    erpWindow.loadFile(webDist, { search });
  }

  erpWindow.on("closed", () => {
    erpWindow = null;
  });
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.CONFIG_GET, () => getFullConfig());
  ipcMain.handle(IPC_CHANNELS.CONFIG_SET, (_event, patch: Partial<DesktopConfig>) => patchConfig(patch));

  ipcMain.handle(IPC_CHANNELS.BACKEND_START, (_event, network) => startBackend(network));
  ipcMain.handle(IPC_CHANNELS.BACKEND_STOP, () => stopBackend());
  ipcMain.handle(IPC_CHANNELS.BACKEND_STATUS, () => getBackendState());

  ipcMain.handle(IPC_CHANNELS.NETWORK_LOCAL_IPS, () => listLocalIPv4Addresses());
  ipcMain.handle(IPC_CHANNELS.NETWORK_PING_URL, (_event, url: string) => pingUrl(url));

  ipcMain.handle(IPC_CHANNELS.DIALOG_CHOOSE_FOLDER, async () => {
    if (!launcherWindow) return null;
    const result = await dialog.showOpenDialog(launcherWindow, { properties: ["openDirectory", "createDirectory"] });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle(IPC_CHANNELS.LICENSE_ACTIVATE, async (_event, payload: { licenseKey: string }) => {
    const config = getFullConfig();
    const apiBaseUrl = resolveActiveApiBaseUrl(config);
    return activateLicense(apiBaseUrl, payload.licenseKey);
  });

  ipcMain.handle(IPC_CHANNELS.LICENSE_TRIAL, async (_event, payload: { tenantSlug: string; email: string }) => {
    const config = getFullConfig();
    const apiBaseUrl = resolveActiveApiBaseUrl(config);
    return startTrial(apiBaseUrl, payload);
  });

  ipcMain.handle(IPC_CHANNELS.LICENSE_STATUS, async () => {
    const config = getFullConfig();
    return checkLicenseStatus(config);
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_OPEN_ERP, (_event, apiBaseUrl: string) => {
    openErpWindow(apiBaseUrl);
  });

  ipcMain.handle(IPC_CHANNELS.APP_VERSION, () => app.getVersion());

  onBackendStateChange((state) => {
    launcherWindow?.webContents.send(IPC_CHANNELS.BACKEND_STATUS_CHANGED, state);
  });
}

// --- Licenciamento ---------------------------------------------------------------
// Contrato consumido de apps/api/src/modules/licensing/ (construído em paralelo por
// outro agente, "license-system"). Caso as rotas ainda não existam no backend atingido,
// a chamada falha com 404 e a UI exibe "aguardando módulo de licenciamento" sem travar
// o restante do onboarding (ver src/screens/LicenseActivation.tsx).

interface LicenseApiResponse {
  success: boolean;
  data?: { token: string; tenantId: string; plan: string; expiresAt: string };
  error?: { code: string; message: string };
}

async function activateLicense(apiBaseUrl: string, licenseKey: string): Promise<LicenseCache | { error: string }> {
  try {
    const response = await fetch(`${apiBaseUrl}/licensing/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ licenseKey }),
    });
    const body = (await response.json().catch(() => null)) as LicenseApiResponse | null;
    if (!response.ok || !body?.data) {
      return { error: body?.error?.message ?? `HTTP ${response.status} — módulo de licenciamento indisponível.` };
    }
    const cache: LicenseCache = {
      token: body.data.token,
      tenantId: body.data.tenantId,
      plan: body.data.plan,
      expiresAt: body.data.expiresAt,
      mode: "ACTIVATED",
      cachedAt: new Date().toISOString(),
    };
    patchConfig({ license: cache });
    return cache;
  } catch (error) {
    return { error: (error as Error).message };
  }
}

async function startTrial(
  apiBaseUrl: string,
  payload: { tenantSlug: string; email: string },
): Promise<LicenseCache | { error: string }> {
  try {
    const response = await fetch(`${apiBaseUrl}/licensing/trial`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await response.json().catch(() => null)) as LicenseApiResponse | null;
    if (!response.ok || !body?.data) {
      return { error: body?.error?.message ?? `HTTP ${response.status} — módulo de licenciamento indisponível.` };
    }
    const cache: LicenseCache = {
      token: body.data.token,
      tenantId: body.data.tenantId,
      plan: body.data.plan,
      expiresAt: body.data.expiresAt,
      mode: "TRIAL",
      cachedAt: new Date().toISOString(),
    };
    patchConfig({ license: cache });
    return cache;
  } catch (error) {
    return { error: (error as Error).message };
  }
}

/**
 * Revalida o token de licença em background quando há rede (GET /licensing/status).
 * Se a chamada falhar (offline ou backend fora do ar), mantém o cache local e permite
 * uso 100% offline enquanto `license.expiresAt` ainda não tiver vencido — a validação
 * "dura" fica a cargo do próprio backend em cada chamada de API normal (JWT assinado).
 */
async function checkLicenseStatus(config: DesktopConfig): Promise<{ valid: boolean; offline: boolean; license: LicenseCache | null }> {
  const cached = config.license;
  if (!cached) return { valid: false, offline: false, license: null };

  const notExpired = new Date(cached.expiresAt).getTime() > Date.now();
  const apiBaseUrl = resolveActiveApiBaseUrl(config);

  try {
    const response = await fetch(`${apiBaseUrl}/licensing/status`, {
      headers: { Authorization: `Bearer ${cached.token}` },
    });
    if (response.ok) {
      const body = (await response.json()) as { data?: { valid: boolean; expiresAt: string } };
      if (body.data) {
        const refreshed: LicenseCache = { ...cached, expiresAt: body.data.expiresAt, cachedAt: new Date().toISOString() };
        patchConfig({ license: refreshed });
        return { valid: body.data.valid, offline: false, license: refreshed };
      }
    }
  } catch {
    // Sem rede ou backend indisponível — cai para validação 100% offline pelo cache local.
  }

  return { valid: notExpired, offline: true, license: cached };
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createLauncherWindow();

  // Reabre a janela do backend/HOST ao religar o app, se já estava configurado em HOST
  // e o onboarding já havia sido concluído anteriormente (reinício do Windows, etc.).
  const config = getFullConfig();
  if (config.installMode === "HOST" && config.onboardingComplete) {
    startBackend(config.network);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createLauncherWindow();
  });
});

app.on("window-all-closed", () => {
  stopBackend();
  if (process.platform !== "darwin") app.quit();
});

// Links externos (ex. "baixar PostgreSQL") abrem no navegador do sistema, nunca dentro
// do shell Electron.
app.on("web-contents-created", (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
});

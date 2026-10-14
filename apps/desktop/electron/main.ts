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
import os from "node:os";
import { randomUUID } from "node:crypto";
import { IPC_CHANNELS, type DesktopConfig, type LicenseCache, type TenantSessionCache } from "./ipc-contract";
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

function openErpWindow(apiBaseUrl: string, session: TenantSessionCache | null): void {
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

  const params = new URLSearchParams({ apiBaseUrl });
  if (session) {
    // SSO: repassa o mesmo AuthResponse de /auth/login (base64url de um JSON) para o
    // apps/web consumir no boot e nunca pedir login uma segunda vez — ver
    // `consumeSsoBootstrap()` em apps/web/src/api/client.ts.
    params.set("sso", Buffer.from(JSON.stringify(session)).toString("base64url"));
  }
  const search = `?${params.toString()}`;

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

  ipcMain.handle(IPC_CHANNELS.LICENSE_ACTIVATE, async () => {
    const config = getFullConfig();
    const apiBaseUrl = resolveActiveApiBaseUrl(config);
    return activateLicense(apiBaseUrl, config.session);
  });

  ipcMain.handle(IPC_CHANNELS.LICENSE_TRIAL, async () => {
    const config = getFullConfig();
    const apiBaseUrl = resolveActiveApiBaseUrl(config);
    return startTrial(apiBaseUrl, config.session);
  });

  ipcMain.handle(IPC_CHANNELS.LICENSE_STATUS, async () => {
    const config = getFullConfig();
    return checkLicenseStatus(config);
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_LOGIN, async (_event, payload: { tenantSlug: string; email: string; password: string }) => {
    const config = getFullConfig();
    const apiBaseUrl = resolveActiveApiBaseUrl(config);
    return loginTenantUser(apiBaseUrl, payload);
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_LOGOUT, () => {
    patchConfig({ session: null });
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_OPEN_ERP, (_event, apiBaseUrl: string) => {
    const config = getFullConfig();
    openErpWindow(apiBaseUrl, config.session);
  });

  ipcMain.handle(IPC_CHANNELS.APP_VERSION, () => app.getVersion());

  onBackendStateChange((state) => {
    launcherWindow?.webContents.send(IPC_CHANNELS.BACKEND_STATUS_CHANGED, state);
  });
}

// --- Autenticação + Licenciamento --------------------------------------------------
// /licensing/* exige `requireAuth` (Capítulo 2.10: a licença mestra é consultada no
// contexto de um usuário de sistema já autenticado do tenant) — por isso o onboarding
// do shell desktop precisa logar o usuário (POST /auth/login, MESMO endpoint do
// apps/web) antes de poder iniciar o trial ou ativar o dispositivo. O token retornado é
// reaproveitado tanto para as chamadas de licenciamento quanto para abrir a janela do
// apps/web (window:open-erp) sem pedir login uma segunda vez.

interface AuthLoginApiResponse {
  success: boolean;
  token?: string;
  tenant?: { id: string; slug: string; tradeName: string; status: string; tenantType: string };
  user?: { id: string; name: string; email: string; role: string };
  error?: { code: string; message: string };
}

async function loginTenantUser(
  apiBaseUrl: string,
  payload: { tenantSlug: string; email: string; password: string },
): Promise<TenantSessionCache | { error: string }> {
  try {
    const response = await fetch(`${apiBaseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await response.json().catch(() => null)) as AuthLoginApiResponse | null;
    if (!response.ok || !body?.token || !body.tenant || !body.user) {
      return { error: body?.error?.message ?? `HTTP ${response.status} — credenciais inválidas ou backend indisponível.` };
    }
    const session: TenantSessionCache = { token: body.token, tenant: body.tenant, user: body.user };
    patchConfig({ session });
    return session;
  } catch (error) {
    return { error: (error as Error).message };
  }
}

/** UUID estável do PC (persistido), usado como `deviceFingerprint` em /licensing/activate. */
function ensureDeviceId(): string {
  const config = getFullConfig();
  if (config.deviceId) return config.deviceId;
  const deviceId = randomUUID();
  patchConfig({ deviceId });
  return deviceId;
}

interface LicenseTrialApiResponse {
  success: boolean;
  data?: { status: LicenseCache["status"]; trialEndsAt: string | null; licensedModules: string[] };
  error?: { code: string; message: string };
}

interface LicenseActivateApiResponse {
  success: boolean;
  data?: {
    token: string;
    status: LicenseCache["status"];
    licensedModules: string[];
    trialEndsAt: string | null;
    offlineTokenExpiresAt: string | null;
  };
  error?: { code: string; message: string };
}

interface LicenseStatusApiResponse {
  success: boolean;
  data?: {
    license: {
      status: LicenseCache["status"];
      trialEndsAt: string | null;
      licensedModules: string[];
      offlineTokenExpiresAt: string | null;
    } | null;
    canStartTrial: boolean;
    tenantStatus: string;
  };
  error?: { code: string; message: string };
}

async function activateLicense(
  apiBaseUrl: string,
  session: TenantSessionCache | null,
): Promise<LicenseCache | { error: string }> {
  if (!session) {
    return { error: "Faça login com o usuário de sistema do tenant antes de ativar a licença neste dispositivo." };
  }
  try {
    const deviceFingerprint = ensureDeviceId();
    const response = await fetch(`${apiBaseUrl}/licensing/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ deviceFingerprint, deviceLabel: os.hostname() }),
    });
    const body = (await response.json().catch(() => null)) as LicenseActivateApiResponse | null;
    if (!response.ok || !body?.data) {
      return { error: body?.error?.message ?? `HTTP ${response.status} — módulo de licenciamento indisponível.` };
    }
    const cache: LicenseCache = {
      token: body.data.token,
      status: body.data.status,
      licensedModules: body.data.licensedModules,
      trialEndsAt: body.data.trialEndsAt,
      offlineTokenExpiresAt: body.data.offlineTokenExpiresAt,
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
  session: TenantSessionCache | null,
): Promise<LicenseCache | { error: string }> {
  if (!session) {
    return { error: "Faça login com o usuário de sistema do tenant antes de iniciar o trial." };
  }
  try {
    const response = await fetch(`${apiBaseUrl}/licensing/trial`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
      body: "{}",
    });
    const body = (await response.json().catch(() => null)) as LicenseTrialApiResponse | null;
    if (!response.ok || !body?.data) {
      return { error: body?.error?.message ?? `HTTP ${response.status} — módulo de licenciamento indisponível.` };
    }
    // O trial sozinho não emite token offline (só /licensing/activate emite) — o
    // dispositivo precisa ativar em seguida para operar offline dentro da janela.
    const cache: LicenseCache = {
      token: null,
      status: body.data.status,
      licensedModules: body.data.licensedModules,
      trialEndsAt: body.data.trialEndsAt,
      offlineTokenExpiresAt: null,
      cachedAt: new Date().toISOString(),
    };
    patchConfig({ license: cache });
    return activateLicense(apiBaseUrl, session);
  } catch (error) {
    return { error: (error as Error).message };
  }
}

/**
 * Revalida o token de licença em background quando há rede (GET /licensing/status).
 * Se a chamada falhar (offline, sem sessão, ou backend fora do ar), mantém o cache
 * local e permite uso 100% offline enquanto `offlineTokenExpiresAt` ainda não tiver
 * vencido — a validação "dura" fica a cargo do próprio backend em cada chamada de API
 * normal (JWT assinado) e do `POST /licensing/validate` puramente criptográfico.
 */
async function checkLicenseStatus(config: DesktopConfig): Promise<{ valid: boolean; offline: boolean; license: LicenseCache | null }> {
  const cached = config.license;
  if (!cached) return { valid: false, offline: false, license: null };

  const notExpired = cached.offlineTokenExpiresAt ? new Date(cached.offlineTokenExpiresAt).getTime() > Date.now() : false;
  const apiBaseUrl = resolveActiveApiBaseUrl(config);

  if (config.session) {
    try {
      const response = await fetch(`${apiBaseUrl}/licensing/status`, {
        headers: { Authorization: `Bearer ${config.session.token}` },
      });
      if (response.ok) {
        const body = (await response.json()) as LicenseStatusApiResponse;
        if (body.data?.license) {
          const refreshed: LicenseCache = {
            ...cached,
            status: body.data.license.status,
            trialEndsAt: body.data.license.trialEndsAt,
            licensedModules: body.data.license.licensedModules,
            offlineTokenExpiresAt: body.data.license.offlineTokenExpiresAt,
            cachedAt: new Date().toISOString(),
          };
          patchConfig({ license: refreshed });
          const stillValid = refreshed.status === "ACTIVE" || refreshed.status === "TRIAL";
          return { valid: stillValid, offline: false, license: refreshed };
        }
      }
    } catch {
      // Sem rede ou backend indisponível — cai para validação 100% offline pelo cache local.
    }
  }

  return { valid: notExpired && (cached.status === "ACTIVE" || cached.status === "TRIAL"), offline: true, license: cached };
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

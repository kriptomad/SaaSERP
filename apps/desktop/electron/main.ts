// apps/desktop/electron/main.ts
// Processo principal do shell desktop Electron. Responsabilidades:
//  1. Janela de onboarding/config/dashboard (renderer próprio deste pacote).
//  2. Em modo HOST: gerenciar o child_process do backend real (apps/api) via backend-manager.ts.
//  3. Expor IPC (com validação de schema em TODO handler, ver validation.ts) para
//     config de rede, teste de conectividade, escolha de pasta de backup, licenciamento
//     (ativação/trial/status) e abertura da janela do ERP real (apps/web).
//  4. Abrir uma segunda BrowserWindow carregando apps/web (UI de negócio — NUNCA
//     duplicada aqui), usando um preload DEDICADO (erp-preload.ts) que entrega
//     apiBaseUrl/SSO via IPC síncrono — nunca mais via query string da URL.
//
// GAP DE ESCOPO CONHECIDO, DOCUMENTADO (fa-desktop-no-tef-pinpad): este arquivo (e o
// resto de `electron/*`/`src/*`) NÃO contém nenhuma ponte TEF/pinpad — nenhum módulo,
// canal IPC ou bridge nativa para terminal de pagamento físico, apesar de ser um
// requisito de MVP para o PDV. Isso é INTENCIONAL para esta correção pontual: uma
// integração TEF/pinpad real exige um esforço dedicado próprio (bridge nativa para o
// driver/protocolo oficial do fabricante do pinpad, validação estrita de comandos —
// nunca aceitar comando bruto vindo do renderer sem whitelist —, timeouts, correlação
// de transação, idempotência e proteção contra replay). Não implementar aqui para não
// entregar uma integração de pagamento físico pela metade; ver `README.md` ("Correções
// de auditoria de segurança/robustez") para mais contexto.
import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from "electron";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { autoUpdater } from "electron-updater";
import {
  IPC_CHANNELS,
  type DesktopConfig,
  type LicenseCache,
  type TenantSessionCache,
  type ErpBootstrapPayload,
} from "./ipc-contract";
import { getFullConfig, patchConfig } from "./config-store";
import { startBackend, stopBackend, getBackendState, onBackendStateChange } from "./backend-manager";
import { listLocalIPv4Addresses, pingUrl } from "./network-utils";
import { verifyOfflineLicenseToken } from "./license-verify";
import {
  validate,
  networkConfigSchema,
  clientHostConfigSchema,
  installModePatchSchema,
  onboardingCompletePatchSchema,
  authLoginPayloadSchema,
  httpUrlSchema,
} from "./validation";

let launcherWindow: BrowserWindow | null = null;
let erpWindow: BrowserWindow | null = null;

// CORREÇÃO DE AUDITORIA (fa-desktop-sso-in-url, fa-desktop-arbitrary-erp-url): dados de
// bootstrap da janela do ERP (apiBaseUrl validado + SSO) ficam só em memória do main,
// indexados pelo id do `webContents` que ainda vai carregar a página, e são apagados
// assim que o preload dedicado (`erp-preload.ts`) os consome uma única vez via
// `ipcRenderer.sendSync` — nunca trafegam pela URL (logs/histórico/Referer).
const erpBootstrapRegistry = new Map<number, ErpBootstrapPayload>();

// CORREÇÃO DE AUDITORIA (fa-desktop-devtools-auto-open): gate explícito — mesmo que
// `ELECTRON_RENDERER_URL` vaze para um build empacotado por engano, DevTools só abre
// quando o app NÃO está empacotado (`app.isPackaged` é `false` só em `electron .` a
// partir do código-fonte, nunca num instalador gerado pelo electron-builder).
const RENDERER_DEV_URL = process.env.ELECTRON_RENDERER_URL;
const IS_DEV = !app.isPackaged && Boolean(RENDERER_DEV_URL);

// URL da API central na nuvem usada quando o app roda sem NENHUM ambiente local
// configurado ainda (primeiro uso, antes de escolher HOST/CLIENT) — ex. para permitir
// iniciar um trial de 15 dias direto contra a nuvem antes mesmo de escolher o modo de
// instalação. Documentado em README.md — endpoint real depende do deploy (Railway).
const CLOUD_API_BASE_URL = process.env.FILITECH_CLOUD_API_URL ?? "https://api.filitech.com.br";

// --- Hardening de navegação/popup (fa-desktop-websecurity-navigation) ---------------
function allowedOriginsForDevOrFile(devUrl: string | undefined, prodFile: string): string[] {
  const origins = [`file://${prodFile}`];
  if (devUrl) {
    try {
      origins.push(new URL(devUrl).origin);
    } catch {
      // ELECTRON_RENDERER_URL malformado — ignora, só os arquivos locais são permitidos.
    }
  }
  return origins;
}

function restrictNavigation(win: BrowserWindow, allowedOrigins: string[]): void {
  win.webContents.on("will-navigate", (event, url) => {
    const isAllowed = allowedOrigins.some((origin) => url === origin || url.startsWith(`${origin}/`) || url.startsWith(`${origin}?`) || url.startsWith("file://"));
    if (!isAllowed) {
      event.preventDefault();
      void shell.openExternal(url).catch(() => undefined);
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    // Nunca abre popups DENTRO do shell — só no navegador padrão do SO, e só http(s).
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  win.webContents.session.on("will-download", (_event, item) => {
    item.setSaveDialogOptions({ title: "Salvar arquivo" });
  });
}

// --- Hardening de falhas de carregamento (fa-desktop-loadurl-failure-unhandled) -----
function attachLoadFailureHandlers(win: BrowserWindow, label: string, retry: () => void): void {
  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    if (errorCode === -3) return; // ERR_ABORTED — navegação cancelada de propósito (ex. download), não é falha real
    console.error(`[${label}] did-fail-load`, { errorCode, errorDescription });
    if (win.isDestroyed()) return;
    const choice = dialog.showMessageBoxSync(win, {
      type: "error",
      title: "Falha ao carregar",
      message: `Não foi possível carregar a interface (${label}).`,
      detail: `Código ${errorCode}: ${errorDescription}`,
      buttons: ["Tentar novamente", "Fechar"],
      defaultId: 0,
      cancelId: 1,
    });
    if (choice === 0) retry();
    else if (!win.isDestroyed()) win.close();
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    console.error(`[${label}] render-process-gone`, details.reason);
    if (win.isDestroyed()) return;
    dialog.showErrorBox("Processo travou", `A interface (${label}) travou (${details.reason}). Feche e abra novamente.`);
  });
  win.on("unresponsive", () => {
    console.error(`[${label}] unresponsive`);
  });
}

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
      webSecurity: true,
    },
  });

  const prodFile = path.join(__dirname, "..", "dist", "index.html");
  restrictNavigation(launcherWindow, allowedOriginsForDevOrFile(RENDERER_DEV_URL, prodFile));
  attachLoadFailureHandlers(launcherWindow, "launcher", () => loadLauncherContent());

  function loadLauncherContent(): void {
    if (!launcherWindow || launcherWindow.isDestroyed()) return;
    const loadPromise = RENDERER_DEV_URL ? launcherWindow.loadURL(RENDERER_DEV_URL) : launcherWindow.loadFile(prodFile);
    loadPromise.catch((error) => {
      console.error("[launcher] load failed", (error as Error).message);
    });
    if (IS_DEV) {
      launcherWindow.webContents.openDevTools({ mode: "detach" });
    }
  }
  loadLauncherContent();

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

/**
 * CORREÇÃO DE AUDITORIA (fa-desktop-arbitrary-erp-url): allowlist explícita de
 * esquema/host/porta para a URL que será carregada na janela do ERP — nunca aceita um
 * valor arbitrário, mesmo que `resolveActiveApiBaseUrl` já só componha a partir do
 * config validado (defesa em profundidade contra uma regressão futura nessa função).
 */
function isAllowedApiBaseUrl(candidate: string, config: DesktopConfig): boolean {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;

  const allowedOrigins = new Set<string>();
  allowedOrigins.add(new URL(CLOUD_API_BASE_URL).origin);
  if (config.installMode === "HOST") {
    allowedOrigins.add(`http://127.0.0.1:${config.network.port}`);
    if (config.network.bindAddress !== "0.0.0.0") {
      allowedOrigins.add(`http://${config.network.bindAddress}:${config.network.port}`);
    }
  }
  if (config.installMode === "CLIENT" && config.clientHost) {
    const scheme = config.clientHost.useHttps ? "https" : "http";
    allowedOrigins.add(`${scheme}://${config.clientHost.host}:${config.clientHost.port}`);
  }
  return allowedOrigins.has(url.origin);
}

function openErpWindow(config: DesktopConfig): void {
  if (erpWindow && !erpWindow.isDestroyed()) {
    erpWindow.focus();
    return;
  }
  if (erpWindow && erpWindow.isDestroyed()) {
    erpWindow = null; // referência obsoleta de uma janela já destruída — CORREÇÃO fa-desktop-erpwindow-race-recreate
  }

  const apiBaseUrl = resolveActiveApiBaseUrl(config);
  if (!isAllowedApiBaseUrl(apiBaseUrl, config)) {
    dialog.showErrorBox("Configuração inválida", "A URL da API calculada não é permitida. Reconfigure a conexão.");
    return;
  }

  const win = new BrowserWindow({
    width: 1366,
    height: 860,
    title: "Filitech ERP",
    webPreferences: {
      preload: path.join(__dirname, "erp-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    },
  });
  erpWindow = win;

  // CORREÇÃO DE AUDITORIA (fa-desktop-sso-in-url): bootstrap (apiBaseUrl + sessão SSO)
  // é entregue via IPC síncrono dedicado, nunca pela URL.
  erpBootstrapRegistry.set(win.webContents.id, { apiBaseUrl, sso: config.session });

  const webDistFile = path.join(process.resourcesPath ?? "", "web", "index.html");
  restrictNavigation(win, RENDERER_DEV_URL ? [new URL("http://localhost:5173").origin] : [`file://${webDistFile}`]);
  attachLoadFailureHandlers(win, "erp", () => loadErpContent());

  function loadErpContent(): void {
    if (!erpWindow || erpWindow.isDestroyed()) return;
    const loadPromise = RENDERER_DEV_URL
      ? // Dev: espera que `npm run web:dev` (apps/web, porta 5173) esteja rodando à parte —
        // documentado no README, pois o shell desktop não gerencia o Vite dev server do web.
        erpWindow.loadURL("http://localhost:5173/")
      : // Produção: apps/web/dist é copiado para resources/web pelo empacotamento
        // (extraResources em package.json).
        erpWindow.loadFile(webDistFile);
    loadPromise.catch((error) => {
      console.error("[erp] load failed", (error as Error).message);
    });
  }
  loadErpContent();

  win.on("closed", () => {
    erpBootstrapRegistry.delete(win.webContents.id);
    if (erpWindow === win) erpWindow = null;
  });
}

// --- Guarda de remetente (fa-desktop-ipc-no-schema-validation) ----------------------
// Canais privilegiados (config, licenciamento, backend, auth) só podem ser chamados
// pela janela do launcher — a janela do ERP (apps/web) usa um preload totalmente
// diferente e mais restrito (erp-preload.ts) que nem expõe esses métodos, mas
// validamos o remetente aqui também como defesa em profundidade.
function assertTrustedSender(event: IpcMainInvokeEvent): void {
  if (!launcherWindow || event.sender !== launcherWindow.webContents) {
    throw new Error("Remetente não autorizado para este canal IPC.");
  }
}

function requireValid<T>(schema: Parameters<typeof validate<T>>[0], payload: unknown): T {
  const result = validate(schema, payload);
  if (!result.success) throw new Error(`Payload inválido: ${result.error}`);
  return result.data;
}

// --- Mutex simples por chave (fa-desktop-login-double-submit) -----------------------
const inFlightOperations = new Map<string, Promise<unknown>>();
function withMutex<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inFlightOperations.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const promise = run().finally(() => {
    inFlightOperations.delete(key);
  });
  inFlightOperations.set(key, promise);
  return promise;
}

// --- Fetch com timeout obrigatório (fa-desktop-login-fetch-no-timeout) --------------
class FetchTimeoutError extends Error {}
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 10_000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      throw new FetchTimeoutError("Tempo esgotado ao contatar o servidor — verifique sua conexão ou tente novamente.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.CONFIG_GET, (event) => {
    assertTrustedSender(event);
    return getFullConfig();
  });

  ipcMain.handle(IPC_CHANNELS.CONFIG_SET_INSTALL_MODE, (event, payload) => {
    assertTrustedSender(event);
    const { installMode } = requireValid(installModePatchSchema, payload);
    return patchConfig({ installMode });
  });

  ipcMain.handle(IPC_CHANNELS.CONFIG_SET_NETWORK, (event, payload) => {
    assertTrustedSender(event);
    const network = requireValid(networkConfigSchema, payload);
    return patchConfig({ network });
  });

  ipcMain.handle(IPC_CHANNELS.CONFIG_SET_CLIENT_HOST, (event, payload) => {
    assertTrustedSender(event);
    const clientHost = requireValid(clientHostConfigSchema, payload);
    return patchConfig({ clientHost });
  });

  ipcMain.handle(IPC_CHANNELS.CONFIG_SET_ONBOARDING_COMPLETE, (event, payload) => {
    assertTrustedSender(event);
    requireValid(onboardingCompletePatchSchema, payload);
    const config = getFullConfig();
    // CORREÇÃO DE AUDITORIA (fa-desktop-bypass-no-license): onboarding só pode ser
    // concluído com uma licença válida já cacheada — nunca mais aceito "prosseguir
    // mesmo assim" sem nenhuma licença (ver LicenseActivation.tsx).
    if (!config.license) {
      throw new Error("Não é possível concluir o onboarding sem uma licença ativa ou trial válido.");
    }
    return patchConfig({ onboardingComplete: true });
  });

  ipcMain.handle(IPC_CHANNELS.BACKEND_START, (event, payload) => {
    assertTrustedSender(event);
    const network = requireValid(networkConfigSchema, payload);
    return startBackend(network);
  });
  ipcMain.handle(IPC_CHANNELS.BACKEND_STOP, (event) => {
    assertTrustedSender(event);
    return stopBackend();
  });
  ipcMain.handle(IPC_CHANNELS.BACKEND_STATUS, (event) => {
    assertTrustedSender(event);
    return getBackendState();
  });

  ipcMain.handle(IPC_CHANNELS.NETWORK_LOCAL_IPS, (event) => {
    assertTrustedSender(event);
    return listLocalIPv4Addresses();
  });

  // CORREÇÃO DE AUDITORIA (fa-desktop-ssrf-ping-url, fa-desktop-pingurl-redirect-ssrf):
  // só aceita http(s) (validado) E só permite alcançar origens já configuradas
  // (backend HOST local, host CLIENT configurado, ou a API cloud) — nunca um host
  // arbitrário escolhido pelo renderer, bloqueando SSRF contra localhost/LAN/metadata
  // não relacionados a esta instalação. `pingUrl` ainda bloqueia redirects (defesa extra).
  ipcMain.handle(IPC_CHANNELS.NETWORK_PING_URL, (event, payload) => {
    assertTrustedSender(event);
    const url = requireValid(httpUrlSchema, payload);
    const config = getFullConfig();
    if (!isAllowedApiBaseUrl(new URL(url).origin, config)) {
      throw new Error("URL de ping não permitida — só endpoints já configurados podem ser testados.");
    }
    return pingUrl(url);
  });

  // CORREÇÃO DE AUDITORIA (fa-desktop-client-host-config-no-validation): canal
  // dedicado para testar um candidato a PC HOST AINDA NÃO salvo (tela
  // `ClientHostConfig.tsx`, antes de existir um `config.clientHost` para o allowlist
  // de `NETWORK_PING_URL` reconhecer). O payload é validado por schema (host/porta),
  // não é uma URL livre — o risco de SSRF genérico não se aplica, pois o alvo é
  // sempre digitado explicitamente pelo usuário nesta tela de configuração, nunca
  // vindo de conteúdo web não confiável.
  ipcMain.handle(IPC_CHANNELS.NETWORK_TEST_CANDIDATE_HOST, (event, payload) => {
    assertTrustedSender(event);
    const candidate = requireValid(clientHostConfigSchema, payload);
    if (candidate.host === "169.254.169.254") {
      throw new Error("Host não permitido.");
    }
    const scheme = candidate.useHttps ? "https" : "http";
    return pingUrl(`${scheme}://${candidate.host}:${candidate.port}/health`);
  });

  ipcMain.handle(IPC_CHANNELS.DIALOG_CHOOSE_FOLDER, async (event) => {
    assertTrustedSender(event);
    if (!launcherWindow) return null;
    const result = await dialog.showOpenDialog(launcherWindow, { properties: ["openDirectory", "createDirectory"] });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle(IPC_CHANNELS.LICENSE_ACTIVATE, async (event) => {
    assertTrustedSender(event);
    const config = getFullConfig();
    const apiBaseUrl = resolveActiveApiBaseUrl(config);
    const deviceId = ensureDeviceId();
    return withMutex(`activate:${deviceId}`, () => activateLicense(apiBaseUrl, config.session));
  });

  ipcMain.handle(IPC_CHANNELS.LICENSE_TRIAL, async (event) => {
    assertTrustedSender(event);
    const config = getFullConfig();
    const apiBaseUrl = resolveActiveApiBaseUrl(config);
    const key = `trial:${config.session?.tenant.id ?? "anon"}`;
    return withMutex(key, () => startTrial(apiBaseUrl, config.session));
  });

  ipcMain.handle(IPC_CHANNELS.LICENSE_STATUS, async (event) => {
    assertTrustedSender(event);
    const config = getFullConfig();
    return checkLicenseStatus(config);
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_LOGIN, async (event, payload) => {
    assertTrustedSender(event);
    const credentials = requireValid(authLoginPayloadSchema, payload);
    const config = getFullConfig();
    const apiBaseUrl = resolveActiveApiBaseUrl(config);
    const key = `login:${credentials.tenantSlug}:${credentials.email}`;
    return withMutex(key, () => loginTenantUser(apiBaseUrl, credentials));
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_LOGOUT, (event) => {
    assertTrustedSender(event);
    return logoutCurrentSession();
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_OPEN_ERP, (event) => {
    assertTrustedSender(event);
    const config = getFullConfig();
    openErpWindow(config);
  });

  ipcMain.handle(IPC_CHANNELS.APP_VERSION, (event) => {
    assertTrustedSender(event);
    return app.getVersion();
  });

  // Canal síncrono — lido uma única vez pelo preload dedicado da janela do ERP, antes
  // de qualquer script de página rodar (ver erp-preload.ts).
  ipcMain.on(IPC_CHANNELS.ERP_BOOTSTRAP, (event) => {
    const senderId = event.sender.id;
    const payload = erpBootstrapRegistry.get(senderId) ?? { apiBaseUrl: CLOUD_API_BASE_URL, sso: null };
    erpBootstrapRegistry.delete(senderId); // uso único
    event.returnValue = payload;
  });

  onBackendStateChange((state) => {
    launcherWindow?.webContents.send(IPC_CHANNELS.BACKEND_STATUS_CHANGED, state);
  });
}

/**
 * CORREÇÃO DE AUDITORIA (fa-desktop-logout-incomplete-cleanup): além de limpar a
 * sessão, também limpa a licença cacheada (ambas atreladas ao tenant anterior) e
 * fecha/limpa a janela do ERP (que ainda poderia ter o JWT antigo em `localStorage`
 * do `apps/web`). Não existe endpoint de revogação de sessão no backend (JWT
 * stateless, sem blacklist — ver apps/api/src/modules/auth) — documentado aqui como
 * limitação conhecida; quando esse endpoint existir, chamá-lo antes de limpar o cache
 * local deve ser adicionado aqui.
 */
async function logoutCurrentSession(): Promise<void> {
  patchConfig({ session: null, license: null });
  if (erpWindow && !erpWindow.isDestroyed()) {
    try {
      await erpWindow.webContents.session.clearStorageData({ storages: ["localstorage", "cookies", "indexdb", "serviceworkers"] });
    } catch (error) {
      console.error("[logout] falha ao limpar storage da janela do ERP", (error as Error).message);
    }
    erpWindow.close();
  }
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
    const response = await fetchWithTimeout(`${apiBaseUrl}/auth/login`, {
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
    const response = await fetchWithTimeout(`${apiBaseUrl}/licensing/activate`, {
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
    const response = await fetchWithTimeout(`${apiBaseUrl}/licensing/trial`, {
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
 * Se a chamada falhar (offline, sem sessão, ou backend fora do ar), cai para
 * validação 100% offline — mas, diferente de antes (fa-desktop-offline-license-no-signature),
 * essa validação offline agora EXIGE verificar a assinatura RS256 do `license.token`
 * cacheado (`verifyOfflineLicenseToken`) contra o tenant/dispositivo atuais; nunca mais
 * confia apenas no campo solto `status`/`offlineTokenExpiresAt` do JSON local.
 */
async function checkLicenseStatus(config: DesktopConfig): Promise<{ valid: boolean; offline: boolean; license: LicenseCache | null }> {
  const cached = config.license;
  if (!cached) return { valid: false, offline: false, license: null };

  const apiBaseUrl = resolveActiveApiBaseUrl(config);

  if (config.session) {
    try {
      const response = await fetchWithTimeout(`${apiBaseUrl}/licensing/status`, {
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
      // Sem rede ou backend indisponível — cai para validação 100% offline abaixo.
    }
  }

  if (!cached.token) {
    // Trial sem ativação de dispositivo ainda não emitiu token offline assinado —
    // não há nada criptográfico para verificar; não pode ser considerado válido offline.
    return { valid: false, offline: true, license: cached };
  }

  const verification = verifyOfflineLicenseToken(cached.token, config.deviceId, config.session);
  if (!verification.valid) {
    console.error("[license] verificação offline falhou:", verification.reason);
    return { valid: false, offline: true, license: cached };
  }
  const stillValid = verification.claims.status === "ACTIVE" || verification.claims.status === "TRIAL";
  return { valid: stillValid, offline: true, license: cached };
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createLauncherWindow();

  // Reabre a janela do backend/HOST ao religar o app, se já estava configurado em HOST
  // e o onboarding já havia sido concluído anteriormente (reinício do Windows, etc.).
  const config = getFullConfig();
  if (config.installMode === "HOST" && config.onboardingComplete) {
    void startBackend(config.network);
  }

  // CORREÇÃO DE AUDITORIA (fa-desktop-no-auto-updater): wiring real do electron-updater
  // (HTTPS + sha512 embutido no `latest.yml` publicado, assinatura de código do
  // instalador verificada pelo Windows no momento da instalação quando o artefato é
  // assinado). O provedor ("generic", URL em `package.json#build.publish`) é um
  // placeholder — substituir pela URL HTTPS real do servidor de updates antes de
  // publicar. Certificado de assinatura de código (`win.certificateFile`/`CSC_LINK`)
  // ainda precisa ser configurado em CI para builds de release reais (gap documentado
  // no README — não disponível neste ambiente sandbox).
  if (app.isPackaged) {
    autoUpdater.autoDownload = true;
    autoUpdater.on("error", (error) => console.error("[auto-updater]", error.message));
    autoUpdater.checkForUpdatesAndNotify().catch((error) => console.error("[auto-updater] check failed", error.message));
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createLauncherWindow();
  });
});

app.on("window-all-closed", () => {
  void stopBackend().finally(() => {
    if (process.platform !== "darwin") app.quit();
  });
});

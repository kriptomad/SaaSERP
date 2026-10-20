// apps/web/src/api/client.ts
// Cliente HTTP real contra apps/api — sem mocks. Base URL configurável via
// VITE_API_BASE_URL (Vercel/Railway injetam em build/runtime; dev usa localhost).
//
// Override em runtime via `window.filitech.apiBaseUrl`: usado pelo shell Electron
// (apps/desktop/electron/erp-preload.ts) para apontar esta mesma UI web — sem
// duplicar nenhum código de página/componente — tanto para o backend local (modo
// HOST) quanto para o PC HOST configurado na rede (modo USUÁRIO), sem precisar de um
// build do apps/web diferente por modo/host.
//
// CORREÇÃO DE AUDITORIA (fa-desktop-apibaseurl-override-web, fa-desktop-arbitrary-erp-url):
// antes, `?apiBaseUrl=` era aceito via query string em QUALQUER contexto (inclusive a
// web pública) sempre que `window.filitech` existisse, e o valor em si vinha
// diretamente da URL — um link malicioso (ex.: enviado por e-mail/WhatsApp) com
// `?apiBaseUrl=https://atacante.exemplo` redirecionaria todas as chamadas de API —
// incluindo login — para um servidor controlado por um atacante (phishing de
// credenciais), mesmo dentro do shell Electron. Agora `apiBaseUrl` só pode vir de
// `window.filitech.apiBaseUrl`, uma propriedade somente-leitura injetada pelo preload
// do processo main ANTES de qualquer script da página rodar — nunca da URL/query
// string, que nunca é lida para este fim. Na web pública (sem `window.filitech`), o
// comportamento é inalterado: sempre `VITE_API_BASE_URL`.
export function resolveApiBaseUrl(): string {
  const bridge = typeof window !== "undefined" ? (window as unknown as { filitech?: { apiBaseUrl?: string } }).filitech : undefined;
  if (bridge && typeof bridge.apiBaseUrl === "string" && bridge.apiBaseUrl) {
    return bridge.apiBaseUrl;
  }
  return import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3333";
}

const API_BASE_URL = resolveApiBaseUrl();

const TOKEN_STORAGE_KEY = "filitech.session.token";
const SSO_TENANT_KEY = "filitech.session.tenant";
const SSO_USER_KEY = "filitech.session.user";
const SSO_IMPERSONATION_KEY = "filitech.session.impersonation";

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setStoredToken(token: string | null): void {
  if (token) {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
  // CORREÇÃO DE AUDITORIA (full-audit, sev. 98/96): espelha o token no IndexedDB
  // (lido por raw IndexedDB dentro do service worker) para que o Background Sync
  // real consiga autenticar a sincronização de vendas pendentes mesmo com todas as
  // abas do PDV fechadas — ver `shared/offline/db.ts` (AuthMirrorState).
  void mirrorAuthStateToOfflineDb(token);
}

async function mirrorAuthStateToOfflineDb(token: string | null): Promise<void> {
  try {
    const { offlineDb } = await import("../shared/offline/db");
    await offlineDb.authMirror.put({ key: "session", token, apiBaseUrl: API_BASE_URL, updatedAt: Date.now() });
  } catch {
    // Ambiente sem IndexedDB (ex.: SSR/teste) — a sincronização em segundo plano via
    // service worker simplesmente não vai conseguir autenticar; o fallback
    // "online"/postMessage para abas abertas continua funcionando normalmente.
  }
}

function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // CORREÇÃO DE AUDITORIA (full-audit, sev. 67): dado corrompido/adulterado em
    // sessionStorage não deve derrubar o boot do AuthProvider — apenas trata como
    // sessão ausente (o usuário volta para a tela de login).
    return null;
  }
}

export function getStoredTenant(): AuthResponse["tenant"] | null {
  return safeJsonParse<AuthResponse["tenant"]>(sessionStorage.getItem(SSO_TENANT_KEY));
}

export function getStoredUser(): AuthResponse["user"] | null {
  return safeJsonParse<AuthResponse["user"]>(sessionStorage.getItem(SSO_USER_KEY));
}

// Capítulo 13.1 — presente apenas quando esta janela foi aberta por impersonation a
// partir do painel de plataforma (via `?sso=`); usado pelo AppShell para exibir o
// aviso "Sessão de suporte" com botão de encerrar.
export function getStoredImpersonation(): AuthResponse["impersonation"] | null {
  return safeJsonParse<AuthResponse["impersonation"]>(sessionStorage.getItem(SSO_IMPERSONATION_KEY));
}

export function setStoredSession(response: AuthResponse | null): void {
  setStoredToken(response?.token ?? null);
  if (response) {
    sessionStorage.setItem(SSO_TENANT_KEY, JSON.stringify(response.tenant));
    sessionStorage.setItem(SSO_USER_KEY, JSON.stringify(response.user));
    if (response.impersonation) {
      sessionStorage.setItem(SSO_IMPERSONATION_KEY, JSON.stringify(response.impersonation));
    } else {
      sessionStorage.removeItem(SSO_IMPERSONATION_KEY);
    }
  } else {
    sessionStorage.removeItem(SSO_TENANT_KEY);
    sessionStorage.removeItem(SSO_USER_KEY);
    sessionStorage.removeItem(SSO_IMPERSONATION_KEY);
  }
}

/**
 * SSO do shell desktop (apps/desktop/electron/main.ts + erp-preload.ts): repassa o
 * AuthResponse já obtido no login do onboarding via `window.filitech.sso` (injetado
 * pelo preload síncrono ANTES de qualquer script desta página rodar) para esta janela
 * do apps/web nunca pedir login uma segunda vez.
 *
 * CORREÇÃO DE AUDITORIA (fa-desktop-sso-in-url): antes, o AuthResponse (contendo o
 * token de sessão) era serializado como `?sso=<base64url JSON>` na própria URL,
 * ficando exposto em logs do Electron, histórico de navegação e no `Referer` de
 * qualquer requisição subsequente feita pela página. Agora nunca é lido da URL — só
 * de `window.filitech.sso`, que o main apaga do seu registro interno após a primeira
 * leitura desta janela (uso único).
 */
function consumeSsoFromBridge(): void {
  if (typeof window === "undefined") return;
  const bridge = (window as unknown as { filitech?: { sso?: AuthResponse | null } }).filitech;
  const response = bridge?.sso;
  if (response?.token && response.tenant && response.user) {
    setStoredSession(response);
  }
}
consumeSsoFromBridge();
// Garante que o service worker tenha o token espelhado mesmo após um reload de
// página (onde nenhum novo `setStoredToken` é chamado, pois a sessão já existia em
// localStorage de um boot anterior) — sem isto, o Background Sync real só passaria a
// funcionar depois do PRÓXIMO login.
void mirrorAuthStateToOfflineDb(getStoredToken());

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

function describeError(body: any): string {
  const error = body?.error;
  if (error?.message) return error.message;
  const fieldErrors = error?.details?.fieldErrors as Record<string, string[]> | undefined;
  if (fieldErrors) {
    const lines = Object.entries(fieldErrors).map(([field, msgs]) => `${field}: ${msgs.join(", ")}`);
    if (lines.length > 0) return `Dados inválidos — ${lines.join("; ")}`;
  }
  return error?.code ?? "Erro inesperado na API.";
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getStoredToken();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(describeError(body), response.status, body?.error?.code);
  }

  return body as T;
}

export interface SignupInput {
  legalName: string;
  tradeName: string;
  slug: string;
  cnpj?: string;
  tenantType: "BUSINESS" | "PERSONAL" | "ACCOUNTING_OFFICE";
  ownerName: string;
  ownerEmail: string;
  ownerPassword: string;
  termsAccepted: true;
}

export interface LoginInput {
  tenantSlug: string;
  email: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  tenant: { id: string; slug: string; tradeName: string; status: string; tenantType: string; cnpj: string | null };
  user: { id: string; name: string; email: string; role: string };
  // Capítulo 13.1 — presente somente quando este AuthResponse foi gerado por
  // impersonation no painel de plataforma (nunca em login/signup normais).
  impersonation?: { sessionId: string; expiresAt: string };
}

export function signup(input: SignupInput): Promise<AuthResponse> {
  return request("/auth/signup", { method: "POST", body: JSON.stringify(input) });
}

export function login(input: LoginInput): Promise<AuthResponse> {
  return request("/auth/login", { method: "POST", body: JSON.stringify(input) });
}

export function requestPasswordReset(input: { tenantSlug: string; email: string }): Promise<{ message: string }> {
  return api.post("/auth/password-reset/request", input);
}

export function confirmPasswordReset(input: { token: string; newPassword: string }): Promise<{ message: string }> {
  return api.post("/auth/password-reset/confirm", input);
}

export function fetchMe(): Promise<{ session: { tenantId: string; userId: string; role: string } }> {
  return request("/me");
}

// Capítulo 13.1 — encerra a sessão de impersonation atual (se houver). Chamado pelo
// banner do AppShell; também encerrável do lado do painel de plataforma.
export function endImpersonation(): Promise<{ ended: boolean }> {
  return api.post("/auth/impersonation/end");
}

// Capítulo 4 — feature-flipping por nicho: lista de códigos de módulo (ex.: WORK_ORDER,
// LIQUOR_LEDGER, RECIPE_BOM, PHARMACY_SNGPC) ativos para o tenant logado. Usado pela
// navegação (apps/web/src/layout/AppShell.tsx) para esconder telas de nicho não contratadas.
export function fetchActiveModules(): Promise<{ moduleCodes: string[] }> {
  return api.get("/billing/modules/active");
}

export function checkHealth(): Promise<{ status: string; database: string }> {
  return request("/health");
}

export interface ViaCepAddress {
  cep: string;
  logradouro: string;
  complemento: string;
  bairro: string;
  localidade: string;
  uf: string;
  ibge: string;
}

export interface BrasilApiCnpjResult {
  cnpj: string;
  razao_social: string;
  nome_fantasia: string | null;
  descricao_situacao_cadastral: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  bairro: string | null;
  municipio: string | null;
  uf: string | null;
  ddd_telefone_1: string | null;
}

// Consultas públicas (ViaCEP/BrasilAPI) — sem sessão, usadas no onboarding para
// autopreencher endereço/razão social a partir do CEP/CNPJ digitado.
export function lookupCep(cep: string): Promise<ViaCepAddress> {
  return api.get(`/lookup/cep/${encodeURIComponent(cep)}`);
}

export function lookupCnpj(cnpj: string): Promise<BrasilApiCnpjResult> {
  return api.get(`/lookup/cnpj/${encodeURIComponent(cnpj)}`);
}

export interface CashRegister {
  id: string;
  status: "OPEN" | "CLOSED";
  openingAmount: string;
  openedAt: string;
}

export function fetchCurrentCashRegister(): Promise<{ success: boolean; data: CashRegister | null }> {
  return request("/cash-registers/current");
}

export function openCashRegister(openingAmount: number): Promise<{ success: boolean; data: CashRegister }> {
  return request("/cash-registers", { method: "POST", body: JSON.stringify({ openingAmount }) });
}

// Envelope padrão dos módulos REST: { success, data, error }. Os helpers devolvem direto `data`.
interface Envelope<T> {
  data: T;
  meta?: { page: number; pageSize: number; total: number };
}

export type QueryParams = Record<string, string | number | boolean | null | undefined>;

export function withQuery(path: string, params?: QueryParams): string {
  if (!params) return path;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `${path}?${text}` : path;
}

export interface PagedResult<T> {
  data: T;
  meta: { page: number; pageSize: number; total: number } | null;
}

export const api = {
  async get<T>(path: string, params?: QueryParams): Promise<T> {
    return (await request<Envelope<T>>(withQuery(path, params))).data;
  },
  // CORREÇÃO DE AUDITORIA (full-audit, sev. 78/80/73): expõe o `meta.total`/`page`
  // retornado pelos endpoints que agora suportam paginação real, para que as telas
  // possam mostrar "carregar mais"/paginação em vez de truncar silenciosamente a
  // listagem no limite fixo antigo.
  async getPaged<T>(path: string, params?: QueryParams): Promise<PagedResult<T>> {
    const envelope = await request<Envelope<T>>(withQuery(path, params));
    return { data: envelope.data, meta: envelope.meta ?? null };
  },
  // CORREÇÃO DE AUDITORIA (fa-w4-api-pagination-inconsistent): alguns consumidores
  // (sync do catálogo offline do PDV, tela de cadastro de produtos) ainda dependem de
  // receber a listagem COMPLETA de uma vez, mesmo depois do backend passar a paginar
  // de verdade — este helper itera as páginas reais do backend e concatena o
  // resultado, preservando o contrato "array completo" para quem já consome assim,
  // sem reintroduzir uma busca de profundidade ilimitada num único round-trip.
  async getAllPages<T>(path: string, params?: QueryParams & { pageSize?: number }): Promise<T[]> {
    const pageSize = params?.pageSize ?? 200;
    const items: T[] = [];
    let page = 1;
    for (;;) {
      const envelope = await request<Envelope<T[]>>(withQuery(path, { ...params, page, pageSize }));
      const batch = envelope.data ?? [];
      items.push(...batch);
      const total = envelope.meta?.total;
      if (batch.length < pageSize || total === undefined || items.length >= total) break;
      page += 1;
    }
    return items;
  },
  async post<T>(path: string, body?: unknown): Promise<T> {
    return (await request<Envelope<T>>(path, { method: "POST", body: JSON.stringify(body ?? {}) })).data;
  },
  async patch<T>(path: string, body?: unknown): Promise<T> {
    return (await request<Envelope<T>>(path, { method: "PATCH", body: JSON.stringify(body ?? {}) })).data;
  },
  async put<T>(path: string, body?: unknown): Promise<T> {
    return (await request<Envelope<T>>(path, { method: "PUT", body: JSON.stringify(body ?? {}) })).data;
  },
  async delete(path: string): Promise<void> {
    await request<unknown>(path, { method: "DELETE" });
  },
};

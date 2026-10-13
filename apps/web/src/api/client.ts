// apps/web/src/api/client.ts
// Cliente HTTP real contra apps/api — sem mocks. Base URL configurável via
// VITE_API_BASE_URL (Vercel/Railway injetam em build/runtime; dev usa localhost).
//
// Override em runtime via `?apiBaseUrl=...`: usado pelo shell Electron
// (apps/desktop/electron/main.ts) para apontar esta mesma UI web — sem duplicar
// nenhum código de página/componente — tanto para o backend local (modo HOST)
// quanto para o PC HOST configurado na rede (modo USUÁRIO), sem precisar de um
// build do apps/web diferente por modo/host.
export function resolveApiBaseUrl(): string {
  if (typeof window !== "undefined") {
    const fromQuery = new URLSearchParams(window.location.search).get("apiBaseUrl");
    if (fromQuery) return fromQuery;
  }
  return import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3333";
}

const API_BASE_URL = resolveApiBaseUrl();

const TOKEN_STORAGE_KEY = "filitech.session.token";

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setStoredToken(token: string | null): void {
  if (token) {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

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
}

export interface LoginInput {
  tenantSlug: string;
  email: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  tenant: { id: string; slug: string; tradeName: string; status: string; tenantType: string };
  user: { id: string; name: string; email: string; role: string };
}

export function signup(input: SignupInput): Promise<AuthResponse> {
  return request("/auth/signup", { method: "POST", body: JSON.stringify(input) });
}

export function login(input: LoginInput): Promise<AuthResponse> {
  return request("/auth/login", { method: "POST", body: JSON.stringify(input) });
}

export function fetchMe(): Promise<{ session: { tenantId: string; userId: string; role: string } }> {
  return request("/me");
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

export const api = {
  async get<T>(path: string, params?: QueryParams): Promise<T> {
    return (await request<Envelope<T>>(withQuery(path, params))).data;
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

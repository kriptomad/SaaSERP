// apps/web/src/modules/platform-admin/platform-admin-client.ts
// Cliente HTTP do painel de ADMINISTRAÇÃO DE PLATAFORMA (SUPER_ADMIN/SUPPORT_AGENT/
// FINANCE_ANALYST) — sessão TOTALMENTE separada da sessão de tenant (Capítulo 14.2):
// token próprio, storage key própria, nunca compartilha estado com `api/client.ts`.
import { resolveApiBaseUrl } from "../../api/client";

const API_BASE_URL = resolveApiBaseUrl();

const TOKEN_STORAGE_KEY = "filitech.platformAdmin.session.token";

export function getStoredPlatformAdminToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setStoredPlatformAdminToken(token: string | null): void {
  if (token) {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

export class PlatformAdminApiError extends Error {
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

// `bearerToken` opcional: usado nas etapas de 2FA (enrollToken/verifyToken), que
// autenticam a requisição mas ainda não são a sessão final de administrador.
export async function platformAdminRequest<T>(path: string, init?: RequestInit, bearerToken?: string): Promise<T> {
  const token = bearerToken ?? getStoredPlatformAdminToken();
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
    throw new PlatformAdminApiError(describeError(body), response.status, body?.error?.code);
  }

  return body as T;
}

interface Envelope<T> {
  data: T;
}

export const platformAdminApi = {
  async get<T>(path: string): Promise<T> {
    return (await platformAdminRequest<Envelope<T>>(path)).data;
  },
  async post<T>(path: string, body?: unknown, bearerToken?: string): Promise<T> {
    return (await platformAdminRequest<Envelope<T>>(path, { method: "POST", body: JSON.stringify(body ?? {}) }, bearerToken)).data;
  },
  async put<T>(path: string, body?: unknown): Promise<T> {
    return (await platformAdminRequest<Envelope<T>>(path, { method: "PUT", body: JSON.stringify(body ?? {}) })).data;
  },
  async patch<T>(path: string, body?: unknown): Promise<T> {
    return (await platformAdminRequest<Envelope<T>>(path, { method: "PATCH", body: JSON.stringify(body ?? {}) })).data;
  },
  async delete<T>(path: string): Promise<T> {
    return (await platformAdminRequest<Envelope<T>>(path, { method: "DELETE" })).data;
  },
};

// apps/desktop/electron/network-utils.ts
// Utilitários de rede usados pelo dashboard HOST (ping de saúde) e pela tela de
// configuração de rede (listar IPs locais da LAN para o usuário escolher o bind).
import os from "node:os";
import net from "node:net";
import type { HealthPingResult } from "./ipc-contract";

export function listLocalIPv4Addresses(): string[] {
  const interfaces = os.networkInterfaces();
  const addresses: string[] = [];
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) {
        addresses.push(entry.address);
      }
    }
  }
  return addresses;
}

/**
 * IPs de loopback/link-local/RFC1918 (inclui o endpoint de metadata de nuvem
 * 169.254.169.254, link-local) — usado como defesa em profundidade além do allowlist
 * de origem feito em main.ts (fa-desktop-ssrf-ping-url). Mantido aqui só para
 * referência/uso por quem compuser chamadas diretamente a `pingUrl`.
 */
export function isPrivateOrLoopbackHost(hostname: string): boolean {
  const kind = net.isIP(hostname);
  if (kind === 4) {
    const octets = hostname.split(".").map(Number);
    const [a, b] = octets;
    if (a === 127) return true; // loopback
    if (a === 10) return true; // RFC1918
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 192 && b === 168) return true; // RFC1918
    if (a === 169 && b === 254) return true; // link-local / metadata
    if (a === 0) return true;
    return false;
  }
  if (kind === 6) {
    const normalized = hostname.toLowerCase();
    if (normalized === "::1") return true; // loopback
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // fc00::/7 ULA
    if (normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return true; // fe80::/10
    return false;
  }
  // Hostname não-IP (ex. "localhost"): trata como privado por segurança.
  return hostname.toLowerCase() === "localhost" || !kind;
}

/**
 * Ping HTTP real (não apenas TCP) contra uma URL — usado para /health e saúde de
 * módulos. `redirect: "error"` é obrigatório (fa-desktop-pingurl-redirect-ssrf):
 * o fetch nativo segue redirects por padrão sem revalidar o destino contra o
 * allowlist feito pelo chamador (main.ts), permitindo que um endpoint
 * aparentemente permitido responda com um 3xx apontando para um alvo interno não
 * autorizado (ex. metadata da nuvem). Falhar explicitamente em redirect força o
 * chamador a decidir, em vez de seguir silenciosamente.
 */
export async function pingUrl(url: string, timeoutMs = 3000): Promise<HealthPingResult> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "error" });
    const latencyMs = Date.now() - startedAt;
    return { ok: response.ok, latencyMs, detail: `HTTP ${response.status}` };
  } catch (error) {
    const message = (error as Error).message;
    const isRedirectBlock = /redirect/i.test(message);
    return { ok: false, latencyMs: null, detail: isRedirectBlock ? "Redirecionamento bloqueado (SSRF)" : message };
  } finally {
    clearTimeout(timeout);
  }
}

/** Teste de conectividade TCP crua (ex. Postgres/Redis) — NÃO valida credenciais, só alcançabilidade. */
export function testTcpConnection(hostname: string, port: number, timeoutMs = 2500): Promise<HealthPingResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const socket = new net.Socket();
    const finish = (ok: boolean, detail?: string) => {
      socket.destroy();
      resolve({ ok, latencyMs: ok ? Date.now() - startedAt : null, detail });
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false, "Timeout"));
    socket.once("error", (error) => finish(false, error.message));
    socket.connect(port, hostname);
  });
}

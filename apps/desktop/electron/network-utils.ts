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

/** Ping HTTP real (não apenas TCP) contra uma URL — usado para /health e saúde de módulos. */
export async function pingUrl(url: string, timeoutMs = 3000): Promise<HealthPingResult> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const latencyMs = Date.now() - startedAt;
    return { ok: response.ok, latencyMs, detail: `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, latencyMs: null, detail: (error as Error).message };
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

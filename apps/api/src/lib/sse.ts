// apps/api/src/lib/sse.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 8.2 — Server-Sent Events sem memory
// leaks para atualização ao vivo de O.S. e notificações.
// GAP DE AUDITORIA ENCONTRADO E CORRIGIDO: nenhum endpoint SSE existia no backend;
// o frontend sempre dependia de polling manual. Este módulo é um broadcaster
// in-process (um processo API por instância — ok para o volume atual; se o
// deployment escalar para múltiplas réplicas, migrar para pub/sub via Redis
// `tenant:{id}:sse` antes de depender disso para consistência entre réplicas).
import { Response } from "express";
import { createModuleLogger } from "./logger";

const log = createModuleLogger("sse");

interface SseClient {
  res: Response;
  userId: string | null;
  heartbeat: NodeJS.Timeout;
}

// tenantId -> Set de clientes conectados
const clientsByTenant = new Map<string, Set<SseClient>>();

const HEARTBEAT_INTERVAL_MS = 25_000;

/**
 * Registra uma conexão SSE para o tenant/usuário logado. Cuida de headers,
 * heartbeat (comentário `:ping` a cada 25s para manter proxies/CDN não
 * derrubando a conexão ociosa) e limpeza garantida no `close`/`error` do
 * response — nunca deixa o Set crescer indefinidamente (memory leak).
 */
export function registerSseClient(tenantId: string, userId: string | null, res: Response): () => void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(`:ok\n\n`);

  const heartbeat = setInterval(() => {
    try {
      res.write(`:ping\n\n`);
    } catch {
      cleanup();
    }
  }, HEARTBEAT_INTERVAL_MS);

  const client: SseClient = { res, userId, heartbeat };

  let set = clientsByTenant.get(tenantId);
  if (!set) {
    set = new Set();
    clientsByTenant.set(tenantId, set);
  }
  set.add(client);

  function cleanup() {
    clearInterval(heartbeat);
    const s = clientsByTenant.get(tenantId);
    if (s) {
      s.delete(client);
      if (s.size === 0) clientsByTenant.delete(tenantId);
    }
  }

  res.on("close", cleanup);
  res.on("error", cleanup);

  return cleanup;
}

/**
 * Envia um evento SSE a todos os clientes conectados do tenant. Quando
 * `targetUserId` é informado, só chega a esse usuário OU a conexões sem filtro
 * de usuário (broadcast); quando omitido, chega a todos os conectados do tenant.
 */
export function broadcastToTenant(
  tenantId: string,
  eventType: string,
  data: unknown,
  targetUserId?: string | null,
): void {
  const set = clientsByTenant.get(tenantId);
  if (!set || set.size === 0) return;

  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of set) {
    if (targetUserId && client.userId && client.userId !== targetUserId) continue;
    try {
      client.res.write(payload);
    } catch (error) {
      log.error({ tenantId, err: error }, "falha ao escrever em cliente SSE, removendo conexão");
    }
  }
}

export function getSseConnectionCount(): number {
  let total = 0;
  for (const set of clientsByTenant.values()) total += set.size;
  return total;
}

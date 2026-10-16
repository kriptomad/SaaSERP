// apps/api/src/lib/sse.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 8.2 — Server-Sent Events sem memory
// leaks para atualização ao vivo de O.S. e notificações.
// GAP DE AUDITORIA ENCONTRADO E CORRIGIDO (rodada 1): nenhum endpoint SSE existia
// no backend; o frontend sempre dependia de polling manual.
// GAP DE AUDITORIA ENCONTRADO E CORRIGIDO (rodada 3): o broadcaster era 100%
// in-process (`clientsByTenant` só conhecia os clientes conectados NESTA réplica),
// então em qualquer deployment com mais de uma réplica da API um evento gerado
// numa réplica (ex.: `notifyTenant` chamado dentro de um worker BullMQ que roda em
// processo separado, ou um usuário cuja conexão SSE caiu numa réplica diferente de
// quem disparou o evento) nunca chegava a esses clientes. Agora todo broadcast é
// publicado num canal Redis Pub/Sub (`sse:broadcast`) e CADA réplica (inclusive a
// que originou o evento) tem um subscriber dedicado que entrega apenas aos seus
// próprios clientes conectados localmente — nenhuma réplica escreve diretamente no
// `res` de um cliente que não é seu.
import { Response } from "express";
import { redis } from "./redis";
import { createModuleLogger } from "./logger";

const log = createModuleLogger("sse");

interface SseClient {
  res: Response;
  userId: string | null;
  heartbeat: NodeJS.Timeout;
}

interface SseBroadcastMessage {
  tenantId: string;
  eventType: string;
  data: unknown;
  targetUserId?: string | null;
}

const SSE_BROADCAST_CHANNEL = "sse:broadcast";

// tenantId -> Set de clientes conectados NESTA réplica
const clientsByTenant = new Map<string, Set<SseClient>>();

const HEARTBEAT_INTERVAL_MS = 25_000;

// Conexão Redis dedicada para subscribe: o ioredis não permite reutilizar uma
// conexão já em modo subscriber para comandos normais (SET/GET/etc.), por isso
// duplicamos a conexão compartilhada só para este propósito.
const subscriber = redis.duplicate();

subscriber.subscribe(SSE_BROADCAST_CHANNEL).catch((error) => {
  log.error({ err: error }, "falha ao assinar canal Redis de broadcast SSE");
});

subscriber.on("message", (channel, message) => {
  if (channel !== SSE_BROADCAST_CHANNEL) return;
  let parsed: SseBroadcastMessage;
  try {
    parsed = JSON.parse(message);
  } catch (error) {
    log.error({ err: error }, "mensagem de broadcast SSE inválida recebida do Redis");
    return;
  }
  deliverToLocalClients(parsed.tenantId, parsed.eventType, parsed.data, parsed.targetUserId ?? null);
});

subscriber.on("error", (error) => {
  log.error({ err: error }, "erro na conexão Redis subscriber do SSE");
});

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
 * Entrega um evento apenas aos clientes conectados NESTA réplica (nunca chamado
 * diretamente fora deste módulo — todo caller externo usa `broadcastToTenant`,
 * que publica no Redis; esta função só existe para ser o handler do subscriber).
 */
function deliverToLocalClients(tenantId: string, eventType: string, data: unknown, targetUserId: string | null): void {
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

/**
 * Envia um evento SSE a todos os clientes conectados do tenant, em QUALQUER
 * réplica da API (publica no Redis; cada réplica entrega apenas aos seus próprios
 * clientes via `deliverToLocalClients`). Quando `targetUserId` é informado, só
 * chega a esse usuário OU a conexões sem filtro de usuário (broadcast); quando
 * omitido, chega a todos os conectados do tenant.
 */
export function broadcastToTenant(
  tenantId: string,
  eventType: string,
  data: unknown,
  targetUserId?: string | null,
): void {
  const message: SseBroadcastMessage = { tenantId, eventType, data, targetUserId: targetUserId ?? null };
  redis.publish(SSE_BROADCAST_CHANNEL, JSON.stringify(message)).catch((error) => {
    // Redis indisponível nunca pode derrubar o caller (ex.: fechamento de venda,
    // criação de notificação) — loga e segue; nesta réplica específica ainda
    // tentamos entregar localmente como fallback best-effort.
    log.error({ tenantId, err: error }, "falha ao publicar broadcast SSE no Redis — entregando apenas localmente");
    deliverToLocalClients(tenantId, eventType, data, targetUserId ?? null);
  });
}

export function getSseConnectionCount(): number {
  let total = 0;
  for (const set of clientsByTenant.values()) total += set.size;
  return total;
}

/**
 * Fecha ativamente todas as conexões SSE locais — chamado pelo graceful shutdown
 * (server.ts) ANTES de aguardar `httpServer.close()`. Sem isso, uma conexão SSE
 * (que é deliberadamente de longa duração / keep-alive) nunca fecharia sozinha,
 * fazendo `httpServer.close()` esperar até o timeout de segurança em TODO deploy
 * em vez de encerrar graciosamente assim que as requisições normais terminarem.
 */
export function closeAllSseConnections(): void {
  for (const set of clientsByTenant.values()) {
    for (const client of set) {
      clearInterval(client.heartbeat);
      try {
        client.res.end();
      } catch {
        // melhor esforço — conexão já pode estar fechada.
      }
    }
  }
  clientsByTenant.clear();
}


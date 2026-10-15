// apps/api/src/modules/platform-admin/system-status.routes.ts
// GAP DE AUDITORIA FECHADO (Mega-Audit Rodada 2, item 9): duas rotas distintas —
// (1) dashboard rico para o painel interno de plataforma (profundidade de fila,
// latência exata, uptime do processo — informação operacional sensível, nunca
// pública) e (2) `/status` público e simplificado (Capítulo 15.1.5), pensado para
// ser aberto em reunião/visita a cliente sem expor detalhes internos de infra.
// GAP DE AUDITORIA FECHADO (mega-audit round 3, r3-health-dashboard-realtime): o
// dashboard rico só existia como `GET` pontual, consumido via polling de 15s pelo
// frontend (`SystemStatusPage.tsx`). Adicionado `GET
// /platform-admin/system-status/stream` (SSE) que empurra uma nova leitura a cada
// 5s sem o cliente precisar reabrir conexão HTTP repetidamente. Diferente do SSE
// multi-tenant de `lib/sse.ts` (que precisa de Redis Pub/Sub porque o EVENTO se
// origina numa réplica/worker específico), aqui a fonte do dado é só o relógio +
// estado compartilhado (Postgres/Redis/BullMQ, já globais a qualquer réplica) —
// cada réplica computa e entrega seu próprio snapshot periódico diretamente aos
// clientes SSE conectados A ELA, sem necessidade de broadcast cross-réplica.
import { Router, Request, Response } from "express";
import { requirePlatformAdminAuth } from "./platform-admin-auth.middleware";
import { getSystemStatusSnapshot, QUEUE_DISPLAY_NAMES, ComponentStatus } from "./system-status.service";
import { createModuleLogger } from "../../lib/logger";

const log = createModuleLogger("system-status.routes");

export const systemStatusRouter = Router();

function serializeSnapshot(snapshot: Awaited<ReturnType<typeof getSystemStatusSnapshot>>) {
  return {
    ...snapshot,
    queues: snapshot.queues.map((q) => ({ ...q, label: QUEUE_DISPLAY_NAMES[q.name] ?? q.name })),
  };
}

systemStatusRouter.get("/platform-admin/system-status", requirePlatformAdminAuth, async (_req: Request, res: Response) => {
  const snapshot = await getSystemStatusSnapshot();
  return res.json({ success: true, data: serializeSnapshot(snapshot), error: null });
});

const SSE_PUSH_INTERVAL_MS = 5_000;
const SSE_HEARTBEAT_INTERVAL_MS = 25_000;

systemStatusRouter.get("/platform-admin/system-status/stream", requirePlatformAdminAuth, async (_req: Request, res: Response) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(":ok\n\n");

  let closed = false;

  async function pushSnapshot() {
    if (closed) return;
    try {
      const snapshot = await getSystemStatusSnapshot();
      res.write(`event: status\ndata: ${JSON.stringify(serializeSnapshot(snapshot))}\n\n`);
    } catch (error) {
      log.error({ err: error }, "falha ao computar snapshot de status para o stream SSE");
    }
  }

  // Primeira leitura imediata (o cliente não espera 5s pela primeira tela), depois
  // o intervalo normal de atualização.
  await pushSnapshot();
  const pushInterval = setInterval(pushSnapshot, SSE_PUSH_INTERVAL_MS);
  const heartbeat = setInterval(() => {
    try {
      res.write(":ping\n\n");
    } catch {
      cleanup();
    }
  }, SSE_HEARTBEAT_INTERVAL_MS);

  function cleanup() {
    if (closed) return;
    closed = true;
    clearInterval(pushInterval);
    clearInterval(heartbeat);
  }

  res.on("close", cleanup);
  res.on("error", cleanup);
});

// Cache simples em memória do processo (10s) — a página pública de status é o alvo
// mais óbvio de tráfego repetido (monitoramento externo tipo UptimeRobot, F5 do
// navegador em reunião) e não precisa de precisão de milissegundo: evita martelar
// Postgres/Redis/BullMQ a cada hit anônimo.
const PUBLIC_STATUS_CACHE_TTL_MS = 10_000;
let publicStatusCache: { expiresAt: number; payload: unknown } | null = null;

function statusLabel(status: ComponentStatus): string {
  if (status === "operational") return "Operacional";
  if (status === "degraded") return "Degradado";
  return "Indisponível";
}

systemStatusRouter.get("/status", async (_req: Request, res: Response) => {
  if (publicStatusCache && publicStatusCache.expiresAt > Date.now()) {
    return res.json(publicStatusCache.payload);
  }

  const snapshot = await getSystemStatusSnapshot();
  // Agrupa as 15 filas internas em categorias de componente visível ao cliente —
  // nunca expõe nome técnico de fila, profundidade de job ou contagem de falhas
  // (informação operacional interna, Capítulo 15.1.5).
  const backgroundJobsStatus: ComponentStatus =
    snapshot.queues.some((q) => q.status === "outage")
      ? "outage"
      : snapshot.queues.some((q) => q.status === "degraded")
        ? "degraded"
        : "operational";

  const payload = {
    success: true,
    data: {
      overallStatus: snapshot.overallStatus,
      overallStatusLabel: statusLabel(snapshot.overallStatus),
      checkedAt: snapshot.checkedAt,
      components: [
        { name: "API / Banco de dados", status: snapshot.database.status, statusLabel: statusLabel(snapshot.database.status) },
        { name: "Processamento em segundo plano (filas)", status: backgroundJobsStatus, statusLabel: statusLabel(backgroundJobsStatus) },
      ],
    },
    error: null,
  };

  publicStatusCache = { expiresAt: Date.now() + PUBLIC_STATUS_CACHE_TTL_MS, payload };
  return res.json(payload);
});

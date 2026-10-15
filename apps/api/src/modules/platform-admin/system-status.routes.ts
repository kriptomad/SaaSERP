// apps/api/src/modules/platform-admin/system-status.routes.ts
// GAP DE AUDITORIA FECHADO (Mega-Audit Rodada 2, item 9): duas rotas distintas —
// (1) dashboard rico para o painel interno de plataforma (profundidade de fila,
// latência exata, uptime do processo — informação operacional sensível, nunca
// pública) e (2) `/status` público e simplificado (Capítulo 15.1.5), pensado para
// ser aberto em reunião/visita a cliente sem expor detalhes internos de infra.
import { Router, Request, Response } from "express";
import { requirePlatformAdminAuth } from "./platform-admin-auth.middleware";
import { getSystemStatusSnapshot, QUEUE_DISPLAY_NAMES, ComponentStatus } from "./system-status.service";

export const systemStatusRouter = Router();

systemStatusRouter.get("/platform-admin/system-status", requirePlatformAdminAuth, async (_req: Request, res: Response) => {
  const snapshot = await getSystemStatusSnapshot();
  return res.json({
    success: true,
    data: {
      ...snapshot,
      queues: snapshot.queues.map((q) => ({ ...q, label: QUEUE_DISPLAY_NAMES[q.name] ?? q.name })),
    },
    error: null,
  });
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

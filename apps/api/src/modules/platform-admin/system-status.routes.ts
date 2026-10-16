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
import { requirePlatformAdminAuth, requireSuperAdmin } from "./platform-admin-auth.middleware";
import { getSystemStatusSnapshot, QUEUE_DISPLAY_NAMES, ComponentStatus, recordIncidentTransitions, INCIDENT_COMPONENTS } from "./system-status.service";
import { createModuleLogger } from "../../lib/logger";
import { prismaUnscoped as prisma } from "@filitech/db";
import { z } from "zod";

const log = createModuleLogger("system-status.routes");

export const systemStatusRouter = Router();

async function writeAuditLog(req: Request, action: string, targetType: string, targetId: string | null, metadata: Record<string, unknown>) {
  await prisma.auditLog.create({
    data: {
      platformAdminUserId: req.platformAdminSession!.platformAdminUserId,
      action,
      targetType,
      targetId,
      metadata: metadata as any,
    },
  });
}

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

  // Persiste abertura/resolução automática de IncidentEvent — única chamada deste
  // efeito colateral no sistema (ver nota em system-status.service.ts), throttled
  // naturalmente pelo cache de 10s desta rota.
  recordIncidentTransitions(snapshot).catch((err) => log.error({ err }, "falha ao registrar transição de incidente de status"));

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

// GAP DE AUDITORIA FECHADO (mega-audit round de 100%): histórico de incidentes
// público (changelog de disponibilidade) — exige transparência real com clientes
// B2B grandes, que costumam pedir isso em due diligence de segurança/infra antes
// de contratar. Só os últimos 90 dias, só os campos não-sensíveis (nunca nome
// técnico de fila ou profundidade de job).
systemStatusRouter.get("/status/incidents", async (_req: Request, res: Response) => {
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const incidents = await prisma.incidentEvent.findMany({
    where: { startedAt: { gte: since } },
    orderBy: { startedAt: "desc" },
    take: 50,
  });
  return res.json({
    success: true,
    data: incidents.map((i) => ({
      id: i.id,
      component: i.component,
      componentLabel: INCIDENT_COMPONENTS[i.component as keyof typeof INCIDENT_COMPONENTS] ?? i.component,
      severity: i.severity,
      description: i.description,
      startedAt: i.startedAt,
      resolvedAt: i.resolvedAt,
    })),
    error: null,
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PAINEL ADMIN — gestão manual de incidentes (edição de descrição pública para
// um post-mortem legível, ou registro manual de uma janela de manutenção
// planejada que não necessariamente dispara um componente para "degraded").
// ─────────────────────────────────────────────────────────────────────────
const manualIncidentSchema = z.object({
  component: z.enum(["DATABASE", "REDIS", "BACKGROUND_JOBS"]),
  severity: z.enum(["WARNING", "CRITICAL"]),
  description: z.string().min(1),
});

systemStatusRouter.get("/platform-admin/incidents", requirePlatformAdminAuth, async (_req: Request, res: Response) => {
  const incidents = await prisma.incidentEvent.findMany({ orderBy: { startedAt: "desc" }, take: 200 });
  return res.json({ success: true, data: incidents, error: null });
});

systemStatusRouter.post("/platform-admin/incidents", requirePlatformAdminAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  const parsed = manualIncidentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const incident = await prisma.incidentEvent.create({ data: parsed.data });
  await writeAuditLog(req, "INCIDENT_CREATED_MANUAL", "IncidentEvent", incident.id, parsed.data);
  return res.status(201).json({ success: true, data: incident, error: null });
});

const patchIncidentSchema = z.object({
  description: z.string().min(1).optional(),
  severity: z.enum(["WARNING", "CRITICAL"]).optional(),
  resolvedAt: z.union([z.string().datetime(), z.null()]).optional(),
});

systemStatusRouter.patch("/platform-admin/incidents/:id", requirePlatformAdminAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  const parsed = patchIncidentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const existing = await prisma.incidentEvent.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Incidente não encontrado." } });
  }
  const updated = await prisma.incidentEvent.update({
    where: { id: req.params.id },
    data: {
      ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
      ...(parsed.data.severity !== undefined ? { severity: parsed.data.severity } : {}),
      ...(parsed.data.resolvedAt !== undefined ? { resolvedAt: parsed.data.resolvedAt ? new Date(parsed.data.resolvedAt) : null } : {}),
    },
  });
  await writeAuditLog(req, "INCIDENT_UPDATED", "IncidentEvent", updated.id, { before: existing, after: updated });
  return res.json({ success: true, data: updated, error: null });
});

// apps/api/src/lib/metrics.ts
// fa-w4-obs-no-metrics-endpoint — expõe métricas no formato Prometheus (`/metrics`)
// cobrindo: (1) métricas de processo/runtime padrão (CPU, memória RSS/heap, event
// loop lag, file descriptors) via `collectDefaultMetrics` do prom-client; (2)
// latência/contagem de requisições HTTP por rota normalizada; (3) profundidade de
// TODAS as filas BullMQ (waiting/active/delayed/failed) coletada sob demanda a cada
// scrape — sem isso, um operador só descobria uma fila entupindo (ex.: Redis lento,
// worker travado) olhando logs manualmente ou esperando um sintoma (ex.: WhatsApp
// não sai, backup não roda), nunca por um dashboard/alerta real.
import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import client from "prom-client";
import { createModuleLogger } from "./logger";
import * as queues from "./queue";

const log = createModuleLogger("metrics");

export const metricsRegistry = new client.Registry();
client.collectDefaultMetrics({ register: metricsRegistry, prefix: "filitech_api_" });

const httpRequestDuration = new client.Histogram({
  name: "filitech_api_http_request_duration_seconds",
  help: "Duração das requisições HTTP em segundos, por método/rota normalizada/status.",
  labelNames: ["method", "route", "status"] as const,
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [metricsRegistry],
});

const httpRequestsTotal = new client.Counter({
  name: "filitech_api_http_requests_total",
  help: "Total de requisições HTTP concluídas, por método/rota normalizada/status.",
  labelNames: ["method", "route", "status"] as const,
  registers: [metricsRegistry],
});

// Todas as filas BullMQ declaradas em lib/queue.ts (array construído dinamicamente a
// partir dos exports do módulo para não exigir manutenção manual de uma segunda
// lista toda vez que uma fila nova for adicionada — risco de esquecimento já visto
// em outras rodadas de auditoria, ex.: fa-w4-queue-unbounded-retention).
const monitoredQueues = Object.values(queues).filter(
  (value): value is InstanceType<typeof import("bullmq").Queue> =>
    typeof value === "object" && value !== null && typeof (value as { getJobCounts?: unknown }).getJobCounts === "function",
);

const QUEUE_JOB_COUNT_STATES = ["waiting", "active", "delayed", "failed", "paused"] as const;

// Gauge com `collect()` assíncrono (suportado pelo prom-client desde a v14): só
// consulta o Redis (via `getJobCounts()` de cada fila) no instante exato em que o
// Prometheus faz o scrape de `/metrics` — nunca via polling contínuo em background,
// evitando carga desnecessária no Redis quando ninguém está olhando o dashboard.
const bullmqQueueJobs = new client.Gauge({
  name: "filitech_api_bullmq_queue_jobs",
  help: "Quantidade de jobs por fila BullMQ e estado (waiting/active/delayed/failed/paused).",
  labelNames: ["queue", "state"] as const,
  registers: [metricsRegistry],
  async collect() {
    await Promise.all(
      monitoredQueues.map(async (queue) => {
        try {
          const counts = await queue.getJobCounts(...QUEUE_JOB_COUNT_STATES);
          for (const state of QUEUE_JOB_COUNT_STATES) {
            this.set({ queue: queue.name, state }, counts[state] ?? 0);
          }
        } catch (err) {
          // Redis indisponível no instante do scrape não pode derrubar o endpoint
          // inteiro de métricas (que também expõe process/http, úteis mesmo com
          // Redis fora do ar) — apenas loga e deixa o valor anterior do gauge.
          log.warn({ err, queue: queue.name }, "falha ao coletar getJobCounts() para métricas");
        }
      }),
    );
  },
});
// Referenciado só para o TypeScript não acusar "declared but never read" — o valor
// em si é mantido pelo registry através do `collect()` acima.
void bullmqQueueJobs;

// Normaliza o path para manter cardinalidade baixa nas labels do Prometheus — IDs
// (UUID, cuid, ObjectId, inteiros) viram `:id`, nunca o valor literal (um path por
// venda/produto/cliente explodiria a cardinalidade das séries temporais).
const ID_SEGMENT_PATTERN = /^[0-9a-fA-F-]{8,}$|^\d+$|^c[a-z0-9]{20,}$/;

function normalizeRoute(path: string): string {
  const segments = path.split("/").map((segment) => (ID_SEGMENT_PATTERN.test(segment) ? ":id" : segment));
  return segments.join("/") || "/";
}

/**
 * Middleware Express — registra duração e contagem de toda requisição concluída
 * (inclusive as que terminam em erro, via `res.on("finish")`, nunca em `res.on("close")`
 * puro, que também dispara em desconexão abrupta do cliente sem resposta completa).
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const stopTimer = httpRequestDuration.startTimer();
  res.on("finish", () => {
    const route = normalizeRoute(req.path);
    const labels = { method: req.method, route, status: String(res.statusCode) };
    stopTimer(labels);
    httpRequestsTotal.inc(labels);
  });
  next();
}

// fa-w4-obs-no-metrics-endpoint — `/metrics` nunca pode ficar aberto sem autenticação
// em produção (vazaria topologia interna: nomes de fila, volume de requisições por
// rota, versão do Node) para qualquer um na rede aberta. Segue o MESMO padrão
// "fail-closed" já adotado para CORS (mega-audit rodada 5, ver server.ts): em
// produção, exige `METRICS_TOKEN` configurado E um header `Authorization: Bearer
// <token>` correspondente (comparação em tempo constante); se a env var não estiver
// configurada em produção, o endpoint responde 404 (nunca 200 "aberto por
// engano"). Fora de produção, libera sem token para facilitar scraping local/dev.
export const metricsRouter = Router();

function timingSafeTokenMatch(expected: string, provided: string): boolean {
  if (expected.length !== provided.length) {
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return mismatch === 0;
}

metricsRouter.get("/metrics", async (req, res) => {
  const metricsToken = process.env.METRICS_TOKEN;
  if (process.env.NODE_ENV === "production") {
    if (!metricsToken) {
      res.status(404).end();
      return;
    }
    const authHeader = req.header("authorization") ?? "";
    const provided = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
    if (!provided || !timingSafeTokenMatch(metricsToken, provided)) {
      res.status(404).end();
      return;
    }
  }

  res.set("Content-Type", metricsRegistry.contentType);
  res.end(await metricsRegistry.metrics());
});

// apps/web/src/modules/platform-admin/system-status.api.ts
// Cliente tipado do dashboard de status/saúde do sistema (painel interno de
// plataforma) — Mega-Audit Rodada 2, item 9.
import { platformAdminApi } from "./platform-admin-client";

export type ComponentStatus = "operational" | "degraded" | "outage";

export interface QueueHealth {
  name: string;
  label: string;
  status: ComponentStatus;
  waiting: number;
  active: number;
  failed: number;
  delayed: number;
}

export interface SystemStatusSnapshot {
  overallStatus: ComponentStatus;
  checkedAt: string;
  database: { status: ComponentStatus; latencyMs: number | null };
  redis: { status: ComponentStatus; latencyMs: number | null };
  queues: QueueHealth[];
  processUptimeSeconds: number;
  nodeVersion: string;
}

export function fetchSystemStatus(): Promise<SystemStatusSnapshot> {
  return platformAdminApi.get("/platform-admin/system-status");
}

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

// GAP DE AUDITORIA FECHADO (mega-audit round de 100%): CRUD de incidentes (edição
// de descrição pública/post-mortem e registro manual de manutenção planejada).
export interface IncidentEventRecord {
  id: string;
  component: string;
  severity: "WARNING" | "CRITICAL";
  description: string;
  startedAt: string;
  resolvedAt: string | null;
}

export function listIncidents(): Promise<IncidentEventRecord[]> {
  return platformAdminApi.get("/platform-admin/incidents");
}

export function createIncident(input: { component: "DATABASE" | "REDIS" | "BACKGROUND_JOBS"; severity: "WARNING" | "CRITICAL"; description: string }): Promise<IncidentEventRecord> {
  return platformAdminApi.post("/platform-admin/incidents", input);
}

export function updateIncident(id: string, input: { description?: string; severity?: "WARNING" | "CRITICAL"; resolvedAt?: string | null }): Promise<IncidentEventRecord> {
  return platformAdminApi.patch(`/platform-admin/incidents/${id}`, input);
}

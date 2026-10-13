// apps/web/src/modules/car-wash/api.ts
// Contratos reais de apps/api/src/modules/car-wash/car-wash-queue.routes.ts
// (Capítulo 11.11 — Estética Automotiva/Lava-Rápido: fila de atendimento walk-in).
import { api } from "../../api/client";

export type CarWashAppointmentStatus = "SCHEDULED" | "CONFIRMED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "NO_SHOW";

export interface CarWashQueueEntry {
  id: string;
  tenantId: string;
  clientId: string;
  serviceId: string;
  professionalId: string;
  vehicleId: string | null;
  scheduledAt: string;
  durationMinutes: number;
  status: CarWashAppointmentStatus;
  source: "INTERNAL" | "PUBLIC_BOOKING";
  client: { id: string; name: string; phone: string | null };
  service: { id: string; name: string; estimatedDurationMinutes: number };
  professional: { id: string; name: string };
  vehicle: { id: string; licensePlate: string; model: string } | null;
}

export interface WalkInInput {
  clientId: string;
  serviceId: string;
  vehiclePlate?: string;
  professionalId?: string;
}

export interface AverageServiceTimeEntry {
  serviceId: string;
  serviceName: string;
  completedCount: number;
  averageMinutes: number;
  isEstimate: boolean;
}

export const carWashQueueApi = {
  createWalkIn: (input: WalkInInput) => api.post<CarWashQueueEntry>("/car-wash-queue/walk-in", input),
  today: () => api.get<CarWashQueueEntry[]>("/car-wash-queue/today"),
  advanceStatus: (appointmentId: string) => api.patch<CarWashQueueEntry>(`/car-wash-queue/${appointmentId}/advance-status`),
  averageServiceTime: () => api.get<AverageServiceTimeEntry[]>("/car-wash-queue/average-service-time"),
};

export const CAR_WASH_STATUS_LABEL: Record<CarWashAppointmentStatus, string> = {
  SCHEDULED: "Aguardando",
  CONFIRMED: "Confirmado",
  IN_PROGRESS: "Em atendimento",
  COMPLETED: "Pronto/Entregue",
  CANCELLED: "Cancelado",
  NO_SHOW: "Não compareceu",
};

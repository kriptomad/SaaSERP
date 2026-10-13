// apps/web/src/modules/scheduling/api.ts
// Contratos reais de scheduling.routes.ts (/services e /appointments).
import { api } from "../../api/client";

export type NicheTag = "PETSHOP" | "BEAUTY_SALON" | "CAR_DETAILING" | "AUTOMOTIVE_WORKSHOP";

export const NICHE_LABEL: Record<NicheTag, string> = {
  PETSHOP: "Pet shop",
  BEAUTY_SALON: "Salão de beleza",
  CAR_DETAILING: "Estética automotiva",
  AUTOMOTIVE_WORKSHOP: "Oficina mecânica",
};

export interface Service {
  id: string;
  name: string;
  nicheTag: NicheTag;
  basePrice: string;
  estimatedDurationMinutes: number;
  commissionPercentage: string;
  active: boolean;
}

export interface ServiceInput {
  name: string;
  nicheTag: NicheTag;
  basePrice: number;
  estimatedDurationMinutes: number;
  commissionPercentage?: number;
  active?: boolean;
}

export type AppointmentStatus = "SCHEDULED" | "CONFIRMED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "NO_SHOW";

export const APPOINTMENT_STATUS: Record<AppointmentStatus, { label: string; color: "default" | "info" | "warning" | "success" | "error" | "primary" }> = {
  SCHEDULED: { label: "Agendado", color: "default" },
  CONFIRMED: { label: "Confirmado", color: "info" },
  IN_PROGRESS: { label: "Em atendimento", color: "primary" },
  COMPLETED: { label: "Concluído", color: "success" },
  CANCELLED: { label: "Cancelado", color: "error" },
  NO_SHOW: { label: "Não compareceu", color: "warning" },
};

export interface Appointment {
  id: string;
  scheduledAt: string;
  durationMinutes: number;
  status: AppointmentStatus;
  client: { id: string; name: string };
  service: Service;
  professional: { id: string; name: string };
}

export interface AppointmentInput {
  clientId: string;
  serviceId: string;
  professionalId: string;
  scheduledAt: string;
  durationMinutes?: number;
}

export interface ProfessionalWorkingHours {
  id: string;
  professionalId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export interface WorkingHoursInput {
  professionalId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export interface ServiceCommissionEntry {
  id: string;
  createdAt: string;
  commissionAmount: string;
  professional: { id: string; name: string };
  service: { id: string; name: string };
  sale: { id: string; createdAt: string } | null;
}

export const schedulingApi = {
  services: () => api.get<Service[]>("/services"),
  createService: (input: ServiceInput) => api.post<Service>("/services", input),
  updateService: (id: string, input: Partial<ServiceInput>) => api.patch<Service>(`/services/${id}`, input),
  appointments: (params: { from: string; to: string; professionalId?: string; status?: string }) =>
    api.get<Appointment[]>("/appointments", params),
  createAppointment: (input: AppointmentInput) => api.post<Appointment>("/appointments", input),
  setStatus: (id: string, status: AppointmentStatus) => api.patch<Appointment>(`/appointments/${id}/status`, { status }),
  workingHours: (professionalId?: string) =>
    api.get<ProfessionalWorkingHours[]>("/professional-working-hours", professionalId ? { professionalId } : undefined),
  saveWorkingHours: (input: WorkingHoursInput) => api.put<ProfessionalWorkingHours>("/professional-working-hours", input),
  deleteWorkingHours: (id: string) => api.delete(`/professional-working-hours/${id}`),
  serviceCommissions: (params: { professionalId?: string; from?: string; to?: string }) =>
    api.get<{ entries: ServiceCommissionEntry[]; totalCommission: string }>("/service-commissions", params),
};

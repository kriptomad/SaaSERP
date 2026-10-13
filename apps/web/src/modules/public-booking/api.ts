// apps/web/src/modules/public-booking/api.ts
// Contratos reais de apps/api/src/modules/public-booking/public-booking.routes.ts —
// rotas SEM autenticação (tenant resolvido por slug na própria URL). Reaproveita o
// helper genérico `api` (só envia Authorization se já houver token salvo — inofensivo).
import { api } from "../../api/client";

export interface PublicTenantInfo {
  id: string;
  name: string;
}

export interface PublicService {
  id: string;
  name: string;
  basePrice: string;
  estimatedDurationMinutes: number;
  nicheTag: string;
}

export interface PublicProfessional {
  id: string;
  name: string;
}

export const publicBookingApi = {
  tenant: (tenantSlug: string) => api.get<PublicTenantInfo>(`/public-booking/${tenantSlug}`),
  services: (tenantSlug: string) => api.get<PublicService[]>(`/public-booking/${tenantSlug}/services`),
  professionals: (tenantSlug: string) => api.get<PublicProfessional[]>(`/public-booking/${tenantSlug}/professionals`),
  slots: (tenantSlug: string, params: { professionalId: string; serviceId: string; date: string }) =>
    api.get<string[]>(`/public-booking/${tenantSlug}/slots`, params),
  createAppointment: (
    tenantSlug: string,
    input: { professionalId: string; serviceId: string; scheduledAt: string; clientName: string; clientPhone: string },
  ) => api.post<{ id: string; scheduledAt: string }>(`/public-booking/${tenantSlug}/appointments`, input),
};

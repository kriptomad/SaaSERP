// apps/web/src/modules/notifications/api.ts
// Contratos reais de apps/api/src/modules/notifications/notification-settings.routes.ts
// (Capítulo 8.4) e do novo PATCH /users/me/contact (Capítulo 20.2 — telefone WhatsApp
// pessoal do usuário). Antes desta rodada não existia NENHUM cliente web para estas
// rotas: o backend (CRUD completo de preferências + dispositivos push) ficava
// inacessível pelo app — gap de auditoria fechado aqui.
import { api } from "../../api/client";

export const NOTIFICATION_CATEGORIES = [
  "WORK_ORDER_STATUS",
  "SUPPORT_TICKET_UPDATE",
  "CASH_FLOW_ALERT",
  "BILLING_DUNNING",
  "ACCOUNTING_TASK_REMINDER",
  "STOCK_LOW",
  "FISCAL_DOCUMENT_REJECTED",
  "SYSTEM_ANNOUNCEMENT",
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const NOTIFICATION_CATEGORY_LABEL: Record<NotificationCategory, string> = {
  WORK_ORDER_STATUS: "Status de Ordem de Serviço",
  SUPPORT_TICKET_UPDATE: "Atualização de chamado de suporte",
  CASH_FLOW_ALERT: "Alerta de fluxo de caixa",
  BILLING_DUNNING: "Cobrança/assinatura em atraso",
  ACCOUNTING_TASK_REMINDER: "Lembrete de tarefa contábil",
  STOCK_LOW: "Estoque baixo",
  FISCAL_DOCUMENT_REJECTED: "Documento fiscal rejeitado",
  SYSTEM_ANNOUNCEMENT: "Comunicado do sistema",
};

export interface NotificationPreferenceChannels {
  category: NotificationCategory;
  inApp: boolean;
  email: boolean;
  push: boolean;
  whatsapp: boolean;
  isDefault: boolean;
}

export interface NotificationPreferenceUpdateInput {
  inApp?: boolean;
  email?: boolean;
  push?: boolean;
  whatsapp?: boolean;
}

export interface PushDeviceSummary {
  id: string;
  platform: "IOS" | "ANDROID" | "WEB";
  createdAt: string;
}

export interface RegisterPushDeviceInput {
  platform: "IOS" | "ANDROID" | "WEB";
  expoPushToken: string;
}

export const notificationSettingsApi = {
  listPreferences: () => api.get<NotificationPreferenceChannels[]>("/notification-preferences"),
  updatePreference: (category: NotificationCategory, channels: NotificationPreferenceUpdateInput) =>
    api.put<NotificationPreferenceChannels>(`/notification-preferences/${category}`, channels),
  listPushDevices: () => api.get<PushDeviceSummary[]>("/push-devices"),
  // Expo push tokens só existem em apps mobile construídos com Expo — este cliente
  // existe para o app mobile (fora deste repositório web) reaproveitar o mesmo
  // contrato tipado; a NotificationSettingsPage web não chama este método (ver
  // comentário em NotificationSettingsPage.tsx sobre push ser mobile-only por ora).
  registerPushDevice: (input: RegisterPushDeviceInput) => api.post<PushDeviceSummary>("/push-devices", input),
  revokePushDevice: (id: string) => api.delete(`/push-devices/${id}`),
};

export const userContactApi = {
  getContact: () => api.get<{ email: string; whatsappPhone: string | null }>("/users/me/contact"),
  setWhatsappPhone: (whatsappPhone: string | null) => api.patch<{ whatsappPhone: string | null }>("/users/me/contact", { whatsappPhone }),
};

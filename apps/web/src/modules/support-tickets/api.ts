// apps/web/src/modules/support-tickets/api.ts
// Contratos reais de apps/api/src/modules/support-tickets/support-tickets.routes.ts.
import { api } from "../../api/client";

export type TicketCategory = "BILLING" | "BUG" | "HOW_TO" | "INTEGRATION" | "OUTAGE";
export type TicketPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";
export type TicketStatus = "OPEN" | "IN_PROGRESS" | "WAITING_CUSTOMER" | "RESOLVED" | "CLOSED";

export interface SupportTicketMessage {
  id: string;
  ticketId: string;
  authorType: "TENANT_USER" | "PLATFORM_ADMIN";
  authorId: string;
  body: string;
  attachmentUrls: string[];
  createdAt: string;
}

export interface SupportTicket {
  id: string;
  tenantId: string;
  openedByUserId: string;
  assignedToPlatformAdminUserId: string | null;
  subject: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  createdAt: string;
  resolvedAt: string | null;
  messages?: SupportTicketMessage[];
}

export interface CreateTicketInput {
  subject: string;
  category: TicketCategory;
  priority?: TicketPriority;
  body: string;
  attachmentUrls?: string[];
}

export const TICKET_CATEGORY_LABEL: Record<TicketCategory, string> = {
  BILLING: "Cobrança/assinatura",
  BUG: "Erro no sistema",
  HOW_TO: "Dúvida de uso",
  INTEGRATION: "Integração (fiscal, WhatsApp, TEF…)",
  OUTAGE: "Instabilidade/indisponibilidade",
};

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  OPEN: "Aberto",
  IN_PROGRESS: "Em andamento",
  WAITING_CUSTOMER: "Aguardando sua resposta",
  RESOLVED: "Resolvido",
  CLOSED: "Encerrado",
};

export const supportTicketsApi = {
  list: (status?: TicketStatus) => api.get<SupportTicket[]>("/support-tickets", status ? { status } : undefined),
  get: (id: string) => api.get<SupportTicket>(`/support-tickets/${id}`),
  create: (input: CreateTicketInput) => api.post<SupportTicket>("/support-tickets", input),
  addMessage: (id: string, body: string, attachmentUrls: string[] = []) =>
    api.post<SupportTicketMessage>(`/support-tickets/${id}/messages`, { body, attachmentUrls }),
};

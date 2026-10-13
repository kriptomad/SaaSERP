// apps/web/src/modules/liquor-ledger/api.ts
// Contratos reais de apps/api/src/modules/liquor-ledger/liquor-ledger.routes.ts
// (Capítulo 4.3 — Adega/Bebidas: conta-corrente de cascos/vasilhames retornáveis).
import { api } from "../../api/client";

export type ContainerLedgerDirection = "BORROWED" | "RETURNED";

export interface ContainerLedgerEntry {
  id: string;
  tenantId: string;
  clientId: string;
  productId: string;
  productName: string;
  direction: ContainerLedgerDirection;
  quantity: number;
  saleId: string | null;
  createdAt: string;
}

export interface ClientContainerBalance {
  productId: string;
  productName: string;
  productSku: string | null;
  borrowed: number;
  returned: number;
  balance: number;
}

export interface ClientContainerLedgerSummary {
  client: { id: string; name: string };
  balances: ClientContainerBalance[];
}

export interface OverdueContainerEntry {
  clientId: string;
  clientName: string;
  clientPhone: string | null;
  productId: string;
  productName: string;
  outstandingQty: number;
  oldestBorrowedAt: string;
  ageDays: number;
  suggestedReplacementCharge: number | null;
}

export interface OverdueContainerReport {
  daysThreshold: number;
  overdue: OverdueContainerEntry[];
}

export interface ContainerLedgerEntryInput {
  clientId: string;
  productId: string;
  direction: ContainerLedgerDirection;
  quantity: number;
  saleId?: string | null;
}

export const liquorLedgerApi = {
  getClientBalance: (clientId: string) => api.get<ClientContainerLedgerSummary>(`/liquor-ledger/clients/${clientId}`),
  listClientEntries: (clientId: string) => api.get<ContainerLedgerEntry[]>(`/liquor-ledger/clients/${clientId}/entries`),
  getOverdue: (daysThreshold = 30) => api.get<OverdueContainerReport>("/liquor-ledger/overdue", { daysThreshold }),
  createEntry: (input: ContainerLedgerEntryInput) => api.post<ContainerLedgerEntry>("/liquor-ledger/entries", input),
};

export const CONTAINER_DIRECTION_LABEL: Record<ContainerLedgerDirection, string> = {
  BORROWED: "Emprestado (saiu com o cliente)",
  RETURNED: "Devolvido",
};

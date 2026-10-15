// apps/web/src/modules/pharmacy/api.ts
// Contratos reais de apps/api/src/modules/pharmacy/prescription-records.routes.ts.
// Decimais (Prisma) chegam como string.
import { api } from "../../api/client";

export type PrescriptionType = "NOTIFICACAO_B_AZUL" | "RECEITA_A_AMARELA" | "RECEITA_ELETRONICA_SNCR";

export interface PrescriptionRecord {
  id: string;
  tenantId: string;
  saleItemId: string;
  prescriptionType: PrescriptionType;
  electronicPrescriptionNumber: string | null;
  retainedDocumentStorageKey: string | null;
  patientDocument: string;
  validatedByUserId: string;
  validatedByUserName: string | null;
  createdAt: string;
  saleItem: {
    id: string;
    saleId: string;
    quantity: string;
    product: { id: string; name: string; sku: string };
    sale: { id: string; createdAt: string; clientId: string | null };
  };
}

export interface PrescriptionRecordInput {
  saleItemId: string;
  prescriptionType: PrescriptionType;
  patientDocument: string;
  electronicPrescriptionNumber?: string;
  retainedDocumentStorageKey?: string;
}

export type ExpiringBatchUrgency = "EXPIRED" | "CRITICAL" | "HIGH" | "MEDIUM";

export interface ExpiringBatch {
  id: string;
  productId: string;
  productName: string;
  productSku: string;
  requiresPrescriptionRetention: boolean;
  isControlledSubstance: boolean;
  batchNumber: string;
  quantity: string;
  expirationDate: string;
  daysUntilExpiration: number;
  urgency: ExpiringBatchUrgency;
}

export interface SngpcLedgerMovement {
  id: string;
  productId: string;
  productName: string;
  productSku: string;
  productNcm: string | null;
  movementType: "PURCHASE_IN" | "SALE_OUT" | "ADJUSTMENT" | "RECIPE_CONSUMPTION" | "PRODUCTION_CONSUMPTION" | "LOSS" | "RETURN";
  quantity: number;
  balanceAfter: number;
  documentReference: string | null;
  patientDocument: string | null;
  createdAt: string;
}

export interface SngpcLedgerSummaryRow {
  productId: string;
  productName: string;
  productSku: string;
  saldoAnterior: number;
  entradas: number;
  saidas: number;
  saldoAtual: number;
}

export interface SngpcLedger {
  month: string;
  summary: SngpcLedgerSummaryRow[];
  movements: SngpcLedgerMovement[];
}

export const pharmacyApi = {
  listPrescriptionRecords: (params?: { clientId?: string; productId?: string }) =>
    api.get<PrescriptionRecord[]>("/prescription-records", params),
  createPrescriptionRecord: (input: PrescriptionRecordInput) => api.post<PrescriptionRecord>("/prescription-records", input),
  listExpiringBatches: (daysAhead?: number) => api.get<ExpiringBatch[]>("/pharmacy/expiring-batches", { daysAhead }),
  getSngpcLedger: (month: string, productId?: string) =>
    api.get<SngpcLedger>("/pharmacy/sngpc-ledger", productId ? { month, productId } : { month }),
};

export const PRESCRIPTION_TYPE_LABEL: Record<PrescriptionType, string> = {
  NOTIFICACAO_B_AZUL: "Notificação de Receita B — Azul (psicotrópicos)",
  RECEITA_A_AMARELA: "Receita A — Amarela (entorpecentes)",
  RECEITA_ELETRONICA_SNCR: "Receita Eletrônica (SNCR — RDC 1.000/2025)",
};

export const URGENCY_LABEL: Record<ExpiringBatchUrgency, string> = {
  EXPIRED: "Vencido",
  CRITICAL: "Crítico (≤ 7 dias)",
  HIGH: "Alto (≤ 15 dias)",
  MEDIUM: "Atenção",
};

export const URGENCY_COLOR: Record<ExpiringBatchUrgency, "error" | "warning" | "info" | "default"> = {
  EXPIRED: "error",
  CRITICAL: "error",
  HIGH: "warning",
  MEDIUM: "info",
};

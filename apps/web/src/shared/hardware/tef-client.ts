// apps/web/src/shared/hardware/tef-client.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 23.5 — cliente HTTP do PDV para a rota real
// de TEF (apps/api/src/modules/hardware/tef/tef.routes.ts), que por sua vez fala com
// o daemon SiTef local do PC do caixa. Mesma convenção de envelope `{ success, data,
// error }` de todo o backend (Capítulo 9).
import { api } from "../../api/client";

export type TefSessionStatus = "AWAITING_CONTINUATION" | "APPROVED" | "DENIED" | "CANCELLED";

export interface TefSessionResult {
  sessionId: string;
  status: TefSessionStatus;
  nsu: string | null;
  authorizationCode: string | null;
  customerReceipt: string | null;
  merchantReceipt: string | null;
  pendingContinuation: { fieldId: string; label: string; kind: "CONFIRMATION" | "TEXT" } | null;
  rejectionReason: string | null;
}

export function startTefTransaction(params: {
  amountCents: number;
  transactionType: "CREDIT" | "DEBIT";
  saleReference: string;
  // CORREÇÃO DE AUDITORIA (fa-w5-hw-tef-route-contract-mismatch): o backend
  // (tef.routes.ts) exige `cashRegisterId` desde a correção que vincula a sessão
  // TEF ao caixa físico que está cobrando — sem este campo no tipo da requisição,
  // o PDV nunca enviava o caixa aberto e TODA cobrança de cartão falhava com
  // VALIDATION_ERROR (400) antes mesmo de chegar à maquininha.
  cashRegisterId: string;
  installments?: number;
}): Promise<TefSessionResult> {
  return api.post("/hardware/tef/transactions", params);
}

export function continueTefTransaction(sessionId: string, fieldId: string, value: string): Promise<TefSessionResult> {
  return api.post(`/hardware/tef/transactions/${sessionId}/continue`, { fieldId, value });
}

export function confirmTefTransaction(sessionId: string): Promise<{ sessionId: string; confirmed: boolean }> {
  return api.post(`/hardware/tef/transactions/${sessionId}/confirm`, {});
}

export function cancelTefTransaction(sessionId: string, nsu: string, reason: string): Promise<{ sessionId: string; cancelled: boolean }> {
  return api.post(`/hardware/tef/transactions/${sessionId}/cancel`, { nsu, reason });
}

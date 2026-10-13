// apps/api/src/modules/hardware/tef/tef-provider.ts
// Fonte: BIBLE_ENGINEERING_V2.md, novo Capítulo 23 (Hardware/Periféricos do PDV),
// seção 23.5 — abstração de provedor de TEF (Transferência Eletrônica de Fundos),
// item 5 da missão de hardware desta rodada. `TEF_CLISITEF` já existia como valor do
// enum `IntegrationProvider` (schema.prisma) desde antes desta rodada, então a
// credencial (host/porta/loja/terminal do daemon SiTef local) reaproveita 100% o CRUD
// genérico já existente em `integration-credentials.routes.ts` — nenhuma tabela nova.
//
// `TefProvider` é a interface que qualquer adaptador de maquininha/TEF deve implementar
// (padrão "Strategy", mesmo usado para `IntegrationProvider` de fiscal/billing). O MVP
// implementa apenas `SitefAdapter` (decisão do usuário: SiTef genérico, não
// Stone/Cielo/Rede específico), mas o contrato já é desenhado para comportar outros
// provedores TEF no futuro sem alterar a rota HTTP.
export type TefTransactionType = "CREDIT" | "DEBIT";

export interface TefStartParams {
  /** Valor em CENTAVOS — nunca float, mesmo padrão de todo o módulo financeiro (Capítulo 2). */
  amountCents: number;
  transactionType: TefTransactionType;
  /** Identificador da venda/cupom no ERP — enviado ao SiTef para conciliação (campo `cupomFiscal`). */
  saleReference: string;
  /** Parcelas (apenas CREDIT) — SiTef pode negociar o número real com a adquirente; 1 = à vista. */
  installments?: number;
}

/**
 * Alguns passos do fluxo CliSiTef pedem dado adicional do operador do PDV antes de
 * prosseguir (ex.: confirmar via papel impressa, selecionar financiamento). Isto
 * nunca é "mock": é o próprio fluxo documentado do protocolo — o terminal físico
 * (pinpad) já colheu cartão/senha; o que falta aqui é só o diálogo operador-ERP.
 */
export interface TefContinuationRequest {
  fieldId: string;
  label: string;
  /** "CONFIRMATION" = sim/não; "TEXT" = texto livre (raro, ex.: código de autorização manual). */
  kind: "CONFIRMATION" | "TEXT";
}

export type TefSessionStatus = "AWAITING_CONTINUATION" | "APPROVED" | "DENIED" | "CANCELLED";

export interface TefSessionResult {
  sessionId: string;
  status: TefSessionStatus;
  /** NSU (Número Sequencial Único) da transação na adquirente — necessário para cancelamento posterior. */
  nsu: string | null;
  authorizationCode: string | null;
  /** Via do cliente / via do estabelecimento, já formatadas em texto puro para impressão ESC/POS (item 4 da missão). */
  customerReceipt: string | null;
  merchantReceipt: string | null;
  pendingContinuation: TefContinuationRequest | null;
  rejectionReason: string | null;
}

export class TefNotConfiguredError extends Error {}
export class TefDaemonUnreachableError extends Error {}
export class TefSessionNotFoundError extends Error {}

export interface TefProvider {
  /** Inicia uma transação; pode retornar `AWAITING_CONTINUATION` se o daemon pedir mais dados. */
  startTransaction(params: TefStartParams): Promise<TefSessionResult>;
  /** Responde a uma pendência de continuação (ex.: operador confirma "COMPROVANTE OK? (S/N)"). */
  continueTransaction(sessionId: string, fieldId: string, value: string): Promise<TefSessionResult>;
  /** Confirma definitivamente a transação junto à adquirente (passo final ABECS — "confirmação"). */
  confirmTransaction(sessionId: string): Promise<void>;
  /** Desfaz uma transação já aprovada (estorno) — usado quando a venda é cancelada após o pagamento aprovado. */
  cancelTransaction(sessionId: string, nsu: string, reason: string): Promise<void>;
}

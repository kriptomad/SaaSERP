// apps/web/src/modules/personal-finance/api.ts
// Tipos e helpers de API do módulo "Filitech Pessoal" (B2C — Capítulo 22). Espelha
// 1:1 os contratos de apps/api/src/modules/personal-finance/*.routes.ts — nenhum
// campo foi inventado, todos conferidos linha a linha nos arquivos de rota e no
// schema.prisma (seção "FILITECH PESSOAL").
import { api, type QueryParams } from "../../api/client";

// ─────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────

export type PersonalAccountType = "CHECKING" | "SAVINGS" | "WALLET_CASH" | "CREDIT_CARD" | "INVESTMENT_BROKERAGE";

export const ACCOUNT_TYPE_LABEL: Record<PersonalAccountType, string> = {
  CHECKING: "Conta corrente",
  SAVINGS: "Poupança",
  WALLET_CASH: "Dinheiro físico",
  CREDIT_CARD: "Cartão de crédito",
  INVESTMENT_BROKERAGE: "Corretora de investimentos",
};

export interface PersonalAccount {
  id: string;
  ownerId: string | null;
  name: string;
  type: PersonalAccountType;
  institutionName: string | null;
  currentBalance: string;
  creditLimit: string | null;
  invoiceClosingDay: number | null;
  invoiceDueDay: number | null;
  isShared: boolean;
  archivedAt: string | null;
  createdAt: string;
}

export type PersonalCategoryType = "INCOME" | "EXPENSE";

export interface PersonalCategory {
  id: string;
  parentCategoryId: string | null;
  name: string;
  icon: string | null;
  type: PersonalCategoryType;
  isSystemDefault: boolean;
  isCarneLeaoIncome: boolean;
  active: boolean;
}

export type PersonalTransactionType = "INCOME" | "EXPENSE" | "TRANSFER";

export interface PersonalTransactionSplit {
  id: string;
  userId: string;
  percentage: string;
  amount: string;
}

export interface PersonalTransaction {
  id: string;
  accountId: string;
  categoryId: string | null;
  createdByUserId: string;
  recurrenceRuleId: string | null;
  description: string;
  merchantName: string | null;
  type: PersonalTransactionType;
  amount: string;
  transactionDate: string;
  isPrivate: boolean;
  attachmentStorageKey: string | null;
  category?: PersonalCategory | null;
  splits?: PersonalTransactionSplit[];
}

export type PersonalRecurrenceFrequency = "WEEKLY" | "MONTHLY" | "YEARLY";

export const RECURRENCE_FREQUENCY_LABEL: Record<PersonalRecurrenceFrequency, string> = {
  WEEKLY: "Semanal",
  MONTHLY: "Mensal",
  YEARLY: "Anual",
};

export interface PersonalRecurrenceRule {
  id: string;
  frequency: PersonalRecurrenceFrequency;
  dayOfMonth: number | null;
  templateDescription: string;
  templateAmount: string;
  templateAccountId: string;
  templateCategoryId: string | null;
  nextOccurrenceAt: string;
  endDate: string | null;
  active: boolean;
}

export interface PersonalBudget {
  id: string;
  categoryId: string;
  monthReference: string;
  limitAmount: string;
  rolloverEnabled: boolean;
  category?: PersonalCategory;
  spentAmount: string;
  percentageUsed: number;
}

export type PersonalGoalType = "SAVINGS" | "DEBT_PAYOFF" | "EMERGENCY_FUND" | "PURCHASE";
export type PersonalGoalStatus = "ACTIVE" | "COMPLETED" | "ABANDONED";

export const GOAL_TYPE_LABEL: Record<PersonalGoalType, string> = {
  SAVINGS: "Poupança",
  DEBT_PAYOFF: "Quitação de dívida",
  EMERGENCY_FUND: "Reserva de emergência",
  PURCHASE: "Compra planejada",
};

export const GOAL_STATUS_LABEL: Record<PersonalGoalStatus, string> = {
  ACTIVE: "Ativa",
  COMPLETED: "Concluída",
  ABANDONED: "Abandonada",
};

export interface PersonalGoal {
  id: string;
  linkedAccountId: string | null;
  name: string;
  type: PersonalGoalType;
  targetAmount: string;
  currentAmount: string;
  targetDate: string | null;
  status: PersonalGoalStatus;
  createdAt: string;
}

export type PersonalInvestmentAssetType =
  | "TESOURO_DIRETO"
  | "CDB"
  | "LCI_LCA"
  | "ACOES"
  | "FII"
  | "CRIPTO"
  | "PREVIDENCIA_PRIVADA"
  | "POUPANCA";

export const INVESTMENT_ASSET_TYPE_LABEL: Record<PersonalInvestmentAssetType, string> = {
  TESOURO_DIRETO: "Tesouro Direto",
  CDB: "CDB",
  LCI_LCA: "LCI/LCA",
  ACOES: "Ações",
  FII: "Fundo Imobiliário (FII)",
  CRIPTO: "Criptomoeda",
  PREVIDENCIA_PRIVADA: "Previdência privada",
  POUPANCA: "Poupança",
};

export interface PersonalInvestment {
  id: string;
  accountId: string;
  assetType: PersonalInvestmentAssetType;
  assetName: string;
  ticker: string | null;
  quantity: string;
  averagePrice: string;
  currentPrice: string;
  updatedAt: string;
  marketValue: string;
  unrealizedGainLoss: string;
}

export interface PersonalInvestmentPriceHistory {
  id: string;
  investmentId: string;
  priceDate: string;
  closingPrice: string;
}

export type PersonalDebtType = "FINANCIAMENTO_IMOVEL" | "FINANCIAMENTO_VEICULO" | "EMPRESTIMO_PESSOAL" | "CARTAO_PARCELADO" | "CHEQUE_ESPECIAL";
export type PersonalDebtStatus = "ACTIVE" | "PAID_OFF";
export type PersonalDebtInstallmentStatus = "PENDING" | "PAID" | "OVERDUE";

export const DEBT_TYPE_LABEL: Record<PersonalDebtType, string> = {
  FINANCIAMENTO_IMOVEL: "Financiamento imobiliário",
  FINANCIAMENTO_VEICULO: "Financiamento de veículo",
  EMPRESTIMO_PESSOAL: "Empréstimo pessoal",
  CARTAO_PARCELADO: "Cartão parcelado",
  CHEQUE_ESPECIAL: "Cheque especial",
};

export interface PersonalDebtInstallment {
  id: string;
  debtId: string;
  installmentNumber: number;
  dueDate: string;
  amount: string;
  paidAt: string | null;
  status: PersonalDebtInstallmentStatus;
}

export interface PersonalDebt {
  id: string;
  name: string;
  type: PersonalDebtType;
  originalAmount: string;
  remainingAmount: string;
  interestRateMonthly: string;
  installmentsTotal: number;
  installmentsPaid: number;
  dueDay: number;
  status: PersonalDebtStatus;
  createdAt: string;
  installments: PersonalDebtInstallment[];
}

export interface DebtPayoffAllocation {
  debtId: string;
  paid: string;
  remainingAfter: string;
}

export interface DebtPayoffPlanMonth {
  month: number;
  allocations: DebtPayoffAllocation[];
}

export type PersonalBillStatus = "PENDING" | "PAID" | "OVERDUE";

export const BILL_STATUS_LABEL: Record<PersonalBillStatus, string> = {
  PENDING: "Pendente",
  PAID: "Paga",
  OVERDUE: "Vencida",
};

export interface PersonalBill {
  id: string;
  categoryId: string | null;
  autoDebitAccountId: string | null;
  name: string;
  amount: string;
  dueDay: number;
  isRecurring: boolean;
  reminderDaysBefore: number;
  lastPaidAt: string | null;
  status: PersonalBillStatus;
  createdAt: string;
}

export interface NetWorthSnapshot {
  id: string;
  snapshotDate: string;
  totalAssets: string;
  totalLiabilities: string;
  netWorth: string;
}

export type OpenFinanceConsentStatus = "UPDATING" | "UPDATED" | "LOGIN_ERROR" | "OUTDATED" | "WAITING_USER_INPUT";

export const OPEN_FINANCE_STATUS_LABEL: Record<OpenFinanceConsentStatus, string> = {
  UPDATING: "Atualizando",
  UPDATED: "Atualizado",
  LOGIN_ERROR: "Erro de login",
  OUTDATED: "Desatualizado",
  WAITING_USER_INPUT: "Aguardando confirmação do usuário",
};

export interface OpenFinanceConsent {
  id: string;
  provider: string;
  itemId: string;
  institutionName: string;
  status: OpenFinanceConsentStatus;
  consentExpiresAt: string;
  lastSyncedAt: string | null;
  createdAt: string;
}

export interface InvoiceSummary {
  accountId: string;
  creditLimit: string;
  currentInvoiceTotal: string;
  availableLimit: string;
  invoicePeriodStart: string;
  invoicePeriodEnd: string;
  invoiceDueDay: number | null;
}

export interface CarneLeaoResult {
  rendimentoTributavel: number;
  aliquotaAplicada: number;
  impostoSugerido: string;
  codigoDarf: string;
  vencimento: string;
  disclaimer: string;
}

// ─────────────────────────────────────────────────────────────────────────
// API
// ─────────────────────────────────────────────────────────────────────────

export const personalFinanceApi = {
  // Contas
  accounts: (params?: QueryParams) => api.get<PersonalAccount[]>("/personal/accounts", params),
  createAccount: (body: Record<string, unknown>) => api.post<PersonalAccount>("/personal/accounts", body),
  updateAccount: (id: string, body: Record<string, unknown>) => api.patch<PersonalAccount>(`/personal/accounts/${id}`, body),
  reconcileAccount: (id: string) =>
    api.post<{ account: PersonalAccount; previousCachedBalance: string; recalculatedBalance: string }>(`/personal/accounts/${id}/reconcile`),
  invoiceSummary: (accountId: string) => api.get<InvoiceSummary>(`/personal/accounts/${accountId}/invoice-summary`),

  // Categorias
  categories: () => api.get<PersonalCategory[]>("/personal/categories"),
  createCategory: (body: Record<string, unknown>) => api.post<PersonalCategory>("/personal/categories", body),
  updateCategory: (id: string, body: Record<string, unknown>) => api.patch<PersonalCategory>(`/personal/categories/${id}`, body),

  // Transações
  transactions: (params?: QueryParams) => api.get<PersonalTransaction[]>("/personal/transactions", params),
  createTransaction: (body: Record<string, unknown>) => api.post<PersonalTransaction>("/personal/transactions", body),
  createTransfer: (body: Record<string, unknown>) =>
    api.post<{ outgoing: PersonalTransaction; incoming: PersonalTransaction }>("/personal/transactions/transfer", body),
  deleteTransaction: (id: string) => api.delete(`/personal/transactions/${id}`),

  // Recorrência
  recurrenceRules: () => api.get<PersonalRecurrenceRule[]>("/personal/recurrence-rules"),
  createRecurrenceRule: (body: Record<string, unknown>) => api.post<PersonalRecurrenceRule>("/personal/recurrence-rules", body),
  updateRecurrenceRule: (id: string, body: Record<string, unknown>) => api.patch<PersonalRecurrenceRule>(`/personal/recurrence-rules/${id}`, body),

  // Orçamento
  budgets: (monthReference?: string) => api.get<PersonalBudget[]>("/personal/budgets", monthReference ? { monthReference } : undefined),
  createBudget: (body: Record<string, unknown>) => api.post<PersonalBudget>("/personal/budgets", body),

  // Metas
  goals: () => api.get<PersonalGoal[]>("/personal/goals"),
  createGoal: (body: Record<string, unknown>) => api.post<PersonalGoal>("/personal/goals", body),
  updateGoal: (id: string, body: Record<string, unknown>) => api.patch<PersonalGoal>(`/personal/goals/${id}`, body),

  // Dívidas
  debts: () => api.get<PersonalDebt[]>("/personal/debts"),
  createDebt: (body: Record<string, unknown>) => api.post<PersonalDebt>("/personal/debts", body),
  payInstallment: (debtId: string, installmentId: string) =>
    api.post<{ installment: PersonalDebtInstallment; debt: PersonalDebt }>(`/personal/debts/${debtId}/installments/${installmentId}/pay`),
  simulatePayoff: (body: { extraMonthlyBudget: number; strategy: "AVALANCHE" | "SNOWBALL" }) =>
    api.post<{ plan: DebtPayoffPlanMonth[]; monthsToPayoff: number }>("/personal/debts/payoff-simulation", body),

  // Investimentos
  investments: () => api.get<PersonalInvestment[]>("/personal/investments"),
  createInvestment: (body: Record<string, unknown>) => api.post<PersonalInvestment>("/personal/investments", body),
  updateInvestmentPrice: (id: string, body: Record<string, unknown>) =>
    api.patch<{ investment: PersonalInvestment; history: PersonalInvestmentPriceHistory }>(`/personal/investments/${id}/price`, body),
  priceHistory: (id: string) => api.get<PersonalInvestmentPriceHistory[]>(`/personal/investments/${id}/price-history`),
  deleteInvestment: (id: string) => api.delete(`/personal/investments/${id}`),

  // Contas a pagar (bills)
  bills: () => api.get<PersonalBill[]>("/personal/bills"),
  createBill: (body: Record<string, unknown>) => api.post<PersonalBill>("/personal/bills", body),
  payBill: (id: string, body?: Record<string, unknown>) =>
    api.post<{ bill: PersonalBill; transaction: PersonalTransaction | null }>(`/personal/bills/${id}/pay`, body),

  // Patrimônio líquido
  netWorthSnapshots: () => api.get<NetWorthSnapshot[]>("/personal/net-worth-snapshots"),
  recomputeNetWorth: () => api.post<NetWorthSnapshot>("/personal/net-worth-snapshots/recompute"),

  // Open Finance
  openFinanceConsents: () => api.get<OpenFinanceConsent[]>("/personal/open-finance-consents"),
  createOpenFinanceConsent: (body: Record<string, unknown>) => api.post<OpenFinanceConsent>("/personal/open-finance-consents", body),
  deleteOpenFinanceConsent: (id: string) => api.delete(`/personal/open-finance-consents/${id}`),
  syncOpenFinanceConsent: (id: string) => api.post<{ enqueued: boolean }>(`/personal/open-finance-consents/${id}/sync-now`),

  // Carnê-Leão
  carneLeao: (referenceMonth: string) => api.get<CarneLeaoResult>("/personal/tax-tools/carne-leao", { referenceMonth }),
};

// apps/web/src/modules/loyalty/api.ts
// Contratos reais de apps/api/src/modules/loyalty/loyalty.routes.ts.
// Decimais (Prisma) chegam como string.
import { api } from "../../api/client";

export interface LoyaltyProgram {
  id: string;
  tenantId: string;
  active: boolean;
  pointsPerCurrencyUnit: string;
  redemptionValuePerPoint: string;
  minPointsToRedeem: number;
  pointsExpireAfterDays: number | null;
}

export interface LoyaltyProgramInput {
  active: boolean;
  pointsPerCurrencyUnit: number;
  redemptionValuePerPoint: number;
  minPointsToRedeem: number;
  pointsExpireAfterDays: number | null;
}

export interface LoyaltyAccount {
  id: string;
  tenantId: string;
  clientId: string;
  pointsBalance: number;
  client: { id: string; name: string; document: string | null; phone: string | null };
}

export interface LoyaltyAccountSummary {
  client: { id: string; name: string };
  accountId: string | null;
  pointsBalance: number;
  programActive: boolean;
  redeemable: boolean;
  redeemableValue: number;
}

export type LoyaltyTransactionType = "EARN" | "REDEEM" | "EXPIRE" | "MANUAL_ADJUST";

export interface LoyaltyTransaction {
  id: string;
  loyaltyAccountId: string;
  type: LoyaltyTransactionType;
  points: number;
  reason: string | null;
  createdAt: string;
}

export interface ReferralCode {
  id: string;
  tenantId: string;
  code: string;
  createdAt: string;
}

export type ReferralStatus = "PENDING" | "CONFIRMED" | "EXPIRED";

export interface Referral {
  id: string;
  referralCodeId: string;
  referredTenantId: string;
  status: ReferralStatus;
  expiresAt: string;
  createdAt: string;
  referredTenant: { tradeName: string };
}

export const loyaltyApi = {
  getProgram: () => api.get<LoyaltyProgram | null>("/loyalty/program"),
  saveProgram: (input: LoyaltyProgramInput) => api.put<LoyaltyProgram>("/loyalty/program", input),
  listAccounts: (search?: string) => api.get<LoyaltyAccount[]>("/loyalty/accounts", { search }),
  getAccount: (clientId: string) => api.get<LoyaltyAccountSummary>(`/loyalty/accounts/${clientId}`),
  listTransactions: (clientId: string, type?: LoyaltyTransactionType) =>
    api.get<LoyaltyTransaction[]>(`/loyalty/accounts/${clientId}/transactions`, { type }),
  adjust: (clientId: string, input: { points: number; reason: string }) =>
    api.post<{ transaction: LoyaltyTransaction; pointsBalance: number }>(`/loyalty/accounts/${clientId}/adjust`, input),
  myReferralCode: () => api.get<ReferralCode>("/referrals/my-code"),
  listReferrals: () => api.get<Referral[]>("/referrals"),
  registerReferral: (code: string) => api.post<Referral>("/referrals/register", { code }),
};

export const LOYALTY_TRANSACTION_LABEL: Record<LoyaltyTransactionType, string> = {
  EARN: "Ganho",
  REDEEM: "Resgate",
  EXPIRE: "Expirado",
  MANUAL_ADJUST: "Ajuste manual",
};

export const REFERRAL_STATUS_LABEL: Record<ReferralStatus, string> = {
  PENDING: "Pendente",
  CONFIRMED: "Confirmada",
  EXPIRED: "Expirada",
};

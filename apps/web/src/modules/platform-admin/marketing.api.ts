// apps/web/src/modules/platform-admin/marketing.api.ts
// Cliente HTTP da aba "Marketing" do painel de administração de plataforma — cupons
// de desconto globais e indicações (ver apps/api/src/modules/platform-admin/marketing.routes.ts).
import { platformAdminApi } from "./platform-admin-client";

export interface DiscountCoupon {
  id: string;
  code: string;
  discountType: "PERCENTAGE" | "FIXED_AMOUNT";
  discountValue: string;
  scopeType: "PLAN" | "MODULE" | "GLOBAL";
  scopeReferenceId: string | null;
  maxRedemptions: number | null;
  redemptionCount: number;
  validFrom: string;
  validUntil: string;
  active: boolean;
}

export interface DiscountCouponInput {
  code: string;
  discountType: "PERCENTAGE" | "FIXED_AMOUNT";
  discountValue: number;
  scopeType: "PLAN" | "MODULE" | "GLOBAL";
  scopeReferenceId?: string | null;
  maxRedemptions?: number | null;
  validFrom: string;
  validUntil: string;
  active?: boolean;
}

export interface Referral {
  id: string;
  status: "PENDING" | "CONVERTED" | "EXPIRED";
  expiresAt: string;
  rewardAppliedAt: string | null;
  createdAt: string;
  referralCode: { code: string; tenant: { id: string; tradeName: string } };
  referredTenant: { id: string; tradeName: string } | null;
}

export const marketingAdminApi = {
  listCoupons: (active?: boolean) =>
    platformAdminApi.get<DiscountCoupon[]>(`/platform-admin/discount-coupons${active === undefined ? "" : `?active=${active}`}`),
  createCoupon: (input: DiscountCouponInput) => platformAdminApi.post<DiscountCoupon>("/platform-admin/discount-coupons", input),
  updateCoupon: (id: string, input: Partial<DiscountCouponInput>) =>
    platformAdminApi.patch<DiscountCoupon>(`/platform-admin/discount-coupons/${id}`, input),
  deleteCoupon: (id: string) => platformAdminApi.delete<{ id: string }>(`/platform-admin/discount-coupons/${id}`),

  listReferrals: (status?: Referral["status"]) =>
    platformAdminApi.get<Referral[]>(`/platform-admin/referrals${status ? `?status=${status}` : ""}`),
  convertReferral: (id: string) => platformAdminApi.post<Referral>(`/platform-admin/referrals/${id}/convert`),
  applyReferralReward: (id: string) => platformAdminApi.post<Referral>(`/platform-admin/referrals/${id}/reward-applied`),
};

// apps/api/src/modules/platform-admin/marketing.routes.ts
// `DiscountCoupon` NÃO tem tenantId: é cupom GLOBAL da plataforma (escopo PLAN/MODULE/GLOBAL, billing SaaS).
// Expô-lo por permissão de tenant (ex. "marketing:coupon:write") deixaria qualquer gerente editar cupons
// de todos os tenants — por isso o CRUD vive no painel do dono da plataforma (SUPER_ADMIN), assim como a
// conversão de `Referral` (conversão para plano pago só a plataforma/billing pode atestar).
import { Router, Request, Response } from "express";
import { z } from "zod";
import { prismaUnscoped as prisma } from "@filitech/db";
import { requirePlatformAdminAuth, requireSuperAdmin } from "./platform-admin-auth.middleware";
import { applyReferrerCreditToProvider, applyReferredDiscountToProvider } from "../billing/referral-billing.service";
import { readEnumQuery } from "../../lib/query-enum";

export const marketingAdminRouter = Router();

async function writeAuditLog(req: Request, action: string, targetType: string, targetId: string | null, metadata: Record<string, unknown>) {
  await prisma.auditLog.create({
    data: {
      platformAdminUserId: req.platformAdminSession!.platformAdminUserId,
      action,
      targetType,
      targetId,
      metadata: metadata as any,
    },
  });
}

const err = (res: Response, status: number, code: string, message: string, details?: unknown) =>
  res.status(status).json({ success: false, data: null, error: { code, message, ...(details ? { details } : {}) } });

// ─────────────────────────────────────────────────────────────────────────
// CUPONS DE DESCONTO
// ─────────────────────────────────────────────────────────────────────────

marketingAdminRouter.get("/platform-admin/discount-coupons", requirePlatformAdminAuth, async (req: Request, res: Response) => {
  const active = req.query.active === "true" ? true : req.query.active === "false" ? false : undefined;
  const coupons = await prisma.discountCoupon.findMany({
    where: active === undefined ? {} : { active },
    orderBy: { validUntil: "desc" },
    take: 200,
  });
  return res.json({ success: true, data: coupons, error: null });
});

const couponBase = z.object({
  code: z.string().trim().min(3).max(40).regex(/^[A-Za-z0-9_-]+$/, "Use apenas letras, números, - e _.").transform((s) => s.toUpperCase()),
  discountType: z.enum(["PERCENTAGE", "FIXED_AMOUNT"]),
  discountValue: z.number().positive(),
  scopeType: z.enum(["PLAN", "MODULE", "GLOBAL"]),
  scopeReferenceId: z.string().min(1).nullable().optional(),
  maxRedemptions: z.number().int().positive().nullable().optional(),
  validFrom: z.coerce.date(),
  validUntil: z.coerce.date(),
  active: z.boolean().default(true),
});

function couponRules(v: { discountType: string; discountValue: number; scopeType: string; scopeReferenceId?: string | null; validFrom: Date; validUntil: Date }): string | null {
  if (v.discountType === "PERCENTAGE" && v.discountValue > 100) return "Desconto percentual não pode passar de 100.";
  if (v.validUntil <= v.validFrom) return "validUntil deve ser posterior a validFrom.";
  if (v.scopeType !== "GLOBAL" && !v.scopeReferenceId) return "scopeReferenceId é obrigatório para escopo PLAN ou MODULE.";
  if (v.scopeType === "GLOBAL" && v.scopeReferenceId) return "scopeReferenceId deve ser vazio para escopo GLOBAL.";
  return null;
}

// Valida que o escopo aponta para um Plan/Module real (por code), nunca uma referência solta.
async function scopeExists(scopeType: string, ref?: string | null): Promise<boolean> {
  if (scopeType === "PLAN") return Boolean(await prisma.plan.findUnique({ where: { code: ref! } }));
  if (scopeType === "MODULE") return Boolean(await prisma.module.findUnique({ where: { code: ref! } }));
  return true;
}

marketingAdminRouter.post("/platform-admin/discount-coupons", requirePlatformAdminAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  const parsed = couponBase.safeParse(req.body);
  if (!parsed.success) return err(res, 400, "VALIDATION_ERROR", "Dados inválidos.", parsed.error.flatten());
  const input = parsed.data;
  const rule = couponRules(input);
  if (rule) return err(res, 400, "VALIDATION_ERROR", rule);
  if (!(await scopeExists(input.scopeType, input.scopeReferenceId))) {
    return err(res, 404, "SCOPE_NOT_FOUND", "O plano/módulo de escopo não existe (use o code do Plan/Module).");
  }
  if (await prisma.discountCoupon.findUnique({ where: { code: input.code } })) {
    return err(res, 409, "CODE_TAKEN", "Já existe um cupom com este código.");
  }
  const coupon = await prisma.discountCoupon.create({
    data: { ...input, scopeReferenceId: input.scopeReferenceId ?? null, maxRedemptions: input.maxRedemptions ?? null },
  });
  await writeAuditLog(req, "DISCOUNT_COUPON_CREATED", "DiscountCoupon", coupon.id, { code: coupon.code });
  return res.status(201).json({ success: true, data: coupon, error: null });
});

const couponPatch = z.object({
  discountType: z.enum(["PERCENTAGE", "FIXED_AMOUNT"]).optional(),
  discountValue: z.number().positive().optional(),
  scopeType: z.enum(["PLAN", "MODULE", "GLOBAL"]).optional(),
  scopeReferenceId: z.string().min(1).nullable().optional(),
  maxRedemptions: z.number().int().positive().nullable().optional(),
  validFrom: z.coerce.date().optional(),
  validUntil: z.coerce.date().optional(),
  active: z.boolean().optional(),
});

marketingAdminRouter.patch("/platform-admin/discount-coupons/:id", requirePlatformAdminAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  const parsed = couponPatch.safeParse(req.body);
  if (!parsed.success) return err(res, 400, "VALIDATION_ERROR", "Dados inválidos.", parsed.error.flatten());
  const current = await prisma.discountCoupon.findUnique({ where: { id: req.params.id } });
  if (!current) return err(res, 404, "NOT_FOUND", "Cupom não encontrado.");

  const merged = {
    discountType: parsed.data.discountType ?? current.discountType,
    discountValue: parsed.data.discountValue ?? Number(current.discountValue),
    scopeType: parsed.data.scopeType ?? current.scopeType,
    scopeReferenceId: parsed.data.scopeReferenceId !== undefined ? parsed.data.scopeReferenceId : current.scopeReferenceId,
    validFrom: parsed.data.validFrom ?? current.validFrom,
    validUntil: parsed.data.validUntil ?? current.validUntil,
  };
  const rule = couponRules(merged);
  if (rule) return err(res, 400, "VALIDATION_ERROR", rule);
  if (!(await scopeExists(merged.scopeType, merged.scopeReferenceId))) {
    return err(res, 404, "SCOPE_NOT_FOUND", "O plano/módulo de escopo não existe (use o code do Plan/Module).");
  }
  if (parsed.data.maxRedemptions != null && parsed.data.maxRedemptions < current.redemptionCount) {
    return err(res, 409, "LIMIT_BELOW_USAGE", "maxRedemptions não pode ser menor que os usos já registrados.");
  }

  const updated = await prisma.discountCoupon.update({
    where: { id: current.id },
    data: { ...parsed.data, scopeReferenceId: merged.scopeReferenceId ?? null },
  });
  await writeAuditLog(req, "DISCOUNT_COUPON_UPDATED", "DiscountCoupon", updated.id, { changes: Object.keys(parsed.data) });
  return res.json({ success: true, data: updated, error: null });
});

// Cupom já resgatado tem histórico financeiro: só desativa. Sem uso, pode ser removido de verdade.
marketingAdminRouter.delete("/platform-admin/discount-coupons/:id", requirePlatformAdminAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  const current = await prisma.discountCoupon.findUnique({ where: { id: req.params.id } });
  if (!current) return err(res, 404, "NOT_FOUND", "Cupom não encontrado.");
  if (current.redemptionCount > 0) {
    return err(res, 409, "COUPON_ALREADY_REDEEMED", "Cupom já foi resgatado; desative-o (PATCH active=false) em vez de excluir.");
  }
  await prisma.discountCoupon.delete({ where: { id: current.id } });
  await writeAuditLog(req, "DISCOUNT_COUPON_DELETED", "DiscountCoupon", current.id, { code: current.code });
  return res.json({ success: true, data: { id: current.id }, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// INDICAÇÕES — conversão atestada pela plataforma
// ─────────────────────────────────────────────────────────────────────────

marketingAdminRouter.get("/platform-admin/referrals", requirePlatformAdminAuth, async (req: Request, res: Response) => {
  const statusParsed = readEnumQuery(res, req.query.status, ["PENDING", "CONVERTED", "EXPIRED"] as const, "status");
  if (!statusParsed.ok) return;
  const status = statusParsed.value;
  const referrals = await prisma.referral.findMany({
    where: status ? { status } : {},
    include: { referralCode: { select: { code: true, tenant: { select: { id: true, tradeName: true } } } }, referredTenant: { select: { id: true, tradeName: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return res.json({ success: true, data: referrals, error: null });
});

marketingAdminRouter.post("/platform-admin/referrals/:id/convert", requirePlatformAdminAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  const referral = await prisma.referral.findUnique({ where: { id: req.params.id } });
  if (!referral) return err(res, 404, "NOT_FOUND", "Indicação não encontrada.");
  if (referral.status !== "PENDING") return err(res, 409, "NOT_PENDING", `Indicação já está ${referral.status}.`);

  if (referral.expiresAt <= new Date()) {
    const expired = await prisma.referral.update({ where: { id: referral.id }, data: { status: "EXPIRED" } });
    await writeAuditLog(req, "REFERRAL_EXPIRED", "Referral", referral.id, {});
    return err(res, 409, "REFERRAL_EXPIRED", "A janela de 90 dias encerrou sem conversão; indicação marcada como EXPIRED.", expired);
  }
  const updated = await prisma.referral.update({ where: { id: referral.id }, data: { status: "CONVERTED" } });
  await writeAuditLog(req, "REFERRAL_CONVERTED", "Referral", referral.id, {});
  return res.json({ success: true, data: updated, error: null });
});

// Separado de /convert: a recompensa (crédito de fatura) é um ato posterior e auditado, nunca presumido.
// Aplica de fato os dois benefícios do Capítulo 2.8 (antes só marcava `rewardAppliedAt`,
// sem nenhum efeito em billing — bug crítico reportado na mega-auditoria):
// 1) crédito de meses acumulados na Subscription do tenant QUE INDICOU
//    (`Subscription.creditBalanceMonths`, consumido antes de qualquer cobrança futura).
// 2) desconto no primeiro ciclo cobrado da Subscription do tenant INDICADO
//    (`Subscription.firstCycleDiscountPercent`).
// Valores parametrizáveis via painel admin → Infraestrutura (SystemParameter), com
// defaults conservadores caso o admin nunca os configure.
const DEFAULT_REFERRAL_REWARD_CREDIT_MONTHS = 1;
const DEFAULT_REFERRAL_REFERRED_DISCOUNT_PERCENT = 20;

async function resolveReferralRewardConfig(): Promise<{ creditMonths: number; referredDiscountPercent: number }> {
  const [creditMonthsParam, discountParam] = await Promise.all([
    prisma.systemParameter.findUnique({ where: { key: "REFERRAL_REWARD_CREDIT_MONTHS" } }),
    prisma.systemParameter.findUnique({ where: { key: "REFERRAL_REFERRED_DISCOUNT_PERCENT" } }),
  ]);
  const creditMonths = creditMonthsParam ? Number(creditMonthsParam.value) : DEFAULT_REFERRAL_REWARD_CREDIT_MONTHS;
  const referredDiscountPercent = discountParam ? Number(discountParam.value) : DEFAULT_REFERRAL_REFERRED_DISCOUNT_PERCENT;
  return {
    creditMonths: Number.isFinite(creditMonths) && creditMonths > 0 ? creditMonths : DEFAULT_REFERRAL_REWARD_CREDIT_MONTHS,
    referredDiscountPercent:
      Number.isFinite(referredDiscountPercent) && referredDiscountPercent > 0
        ? referredDiscountPercent
        : DEFAULT_REFERRAL_REFERRED_DISCOUNT_PERCENT,
  };
}

// Janela de backoff entre tentativas de aplicação da recompensa: evita que uma
// corrida de requisições concorrentes (ou um retry manual impaciente do admin)
// dispare chamadas duplicadas ao provedor enquanto uma tentativa anterior ainda
// pode estar em voo; depois desse intervalo sem confirmação, a tentativa é
// considerada "morta" (processo caiu, timeout, etc.) e pode ser reclamada de novo.
const REWARD_APPLY_RETRY_BACKOFF_MS = 60_000;

marketingAdminRouter.post("/platform-admin/referrals/:id/reward-applied", requirePlatformAdminAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  const referral = await prisma.referral.findUnique({
    where: { id: req.params.id },
    include: { referralCode: { select: { tenantId: true } } },
  });
  if (!referral) return err(res, 404, "NOT_FOUND", "Indicação não encontrada.");
  if (referral.status !== "CONVERTED") return err(res, 409, "NOT_CONVERTED", "Só indicações CONVERTED recebem recompensa.");
  if (referral.rewardAppliedAt) return err(res, 409, "REWARD_ALREADY_APPLIED", "Recompensa já registrada para esta indicação.");

  // Outbox/claim: registra a TENTATIVA pendente antes de chamar qualquer provedor
  // externo — nunca marca `rewardAppliedAt` neste passo. `rewardAppliedAt` só é
  // gravado mais abaixo, depois que o provedor confirma o crédito/desconto de
  // verdade, e sempre na mesma transação que a criação do crédito local — nunca
  // antes, fechando a janela em que a recompensa aparecia "aplicada" sem nenhum
  // efeito real em billing. `rewardAttemptedAt` com backoff impede processamento
  // concorrente duplicado (duas chamadas quase simultâneas a este endpoint).
  const backoffCutoff = new Date(Date.now() - REWARD_APPLY_RETRY_BACKOFF_MS);
  const claimed = await prisma.referral.updateMany({
    where: { id: referral.id, rewardAppliedAt: null, OR: [{ rewardAttemptedAt: null }, { rewardAttemptedAt: { lt: backoffCutoff } }] },
    data: { rewardAttemptedAt: new Date() },
  });
  if (claimed.count === 0) {
    const current = await prisma.referral.findUniqueOrThrow({ where: { id: referral.id } });
    if (current.rewardAppliedAt) return err(res, 409, "REWARD_ALREADY_APPLIED", "Recompensa já registrada para esta indicação.");
    return err(
      res,
      409,
      "REWARD_APPLY_IN_PROGRESS",
      "Outra tentativa de aplicar esta recompensa está em andamento; aguarde alguns instantes e tente novamente.",
    );
  }

  const { creditMonths, referredDiscountPercent } = await resolveReferralRewardConfig();

  // As duas Subscriptions mais recentes dos tenants envolvidos — nunca presume-se
  // "a única", pois um tenant pode ter histórico de Subscriptions antigas (upgrade de
  // provedor, por exemplo).
  const [referrerSubscription, referredSubscription] = await Promise.all([
    prisma.subscription.findFirst({ where: { tenantId: referral.referralCode.tenantId }, orderBy: { createdAt: "desc" } }),
    prisma.subscription.findFirst({ where: { tenantId: referral.referredTenantId }, orderBy: { createdAt: "desc" } }),
  ]);

  const referrerLegNeeded = Boolean(referrerSubscription) && !referral.referrerCreditAppliedAt;
  const referredLegNeeded = Boolean(referredSubscription && referredSubscription.firstCycleDiscountPercent == null) && !referral.referredDiscountAppliedAt;

  // Confirma no provedor ANTES de qualquer efeito local — cada perna só é chamada
  // de novo num retry se ainda não tiver sido confirmada antes (flags
  // `referrerCreditAppliedAt`/`referredDiscountAppliedAt`), nunca reaplicando no
  // Stripe/Asaas uma perna que um retry anterior já conseguiu confirmar.
  const referrerOk = referrerLegNeeded ? await applyReferrerCreditToProvider(referrerSubscription!.id, creditMonths) : true;
  if (referrerLegNeeded && referrerOk) {
    await prisma.referral.update({ where: { id: referral.id }, data: { referrerCreditAppliedAt: new Date() } });
  }

  const referredOk = referredLegNeeded ? await applyReferredDiscountToProvider(referredSubscription!.id, referredDiscountPercent) : true;
  if (referredLegNeeded && referredOk) {
    await prisma.referral.update({ where: { id: referral.id }, data: { referredDiscountAppliedAt: new Date() } });
  }

  if (!referrerOk || !referredOk) {
    // Tentativa fica registrada (`rewardAttemptedAt`) para retry após o backoff —
    // nenhum crédito/desconto local é criado e `rewardAppliedAt` permanece null.
    await writeAuditLog(req, "REFERRAL_REWARD_APPLY_FAILED", "Referral", referral.id, { referrerOk, referredOk });
    return err(
      res,
      502,
      "REWARD_PROVIDER_FAILURE",
      "Falha ao confirmar a recompensa no provedor de pagamento (Stripe/Asaas); tentativa registrada — repita em instantes.",
    );
  }

  // Confirmação do provedor obtida para as duas pernas: só agora a criação do
  // crédito/desconto local e a marcação de `rewardAppliedAt` acontecem, e sempre
  // juntas na mesma transação (nunca uma sem a outra).
  await prisma.$transaction([
    ...(referrerSubscription
      ? [
          prisma.subscription.update({
            where: { id: referrerSubscription.id },
            data: { creditBalanceMonths: { increment: creditMonths } },
          }),
        ]
      : []),
    ...(referredSubscription && referredSubscription.firstCycleDiscountPercent == null
      ? [
          prisma.subscription.update({
            where: { id: referredSubscription.id },
            data: { firstCycleDiscountPercent: referredDiscountPercent },
          }),
        ]
      : []),
    prisma.referral.update({ where: { id: referral.id }, data: { rewardAppliedAt: new Date() } }),
  ]);

  await writeAuditLog(req, "REFERRAL_REWARD_APPLIED", "Referral", referral.id, {
    creditMonthsGrantedToReferrer: referrerSubscription ? creditMonths : 0,
    firstCycleDiscountPercentGrantedToReferred:
      referredSubscription && referredSubscription.firstCycleDiscountPercent == null ? referredDiscountPercent : 0,
  });
  const updated = await prisma.referral.findUniqueOrThrow({ where: { id: referral.id } });
  return res.json({ success: true, data: updated, error: null });
});

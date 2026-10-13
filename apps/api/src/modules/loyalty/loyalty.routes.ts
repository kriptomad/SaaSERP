// apps/api/src/modules/loyalty/loyalty.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md — Fidelidade (LoyaltyProgram/LoyaltyAccount/LoyaltyTransaction)
// e Indicação (ReferralCode/Referral). GAP DE AUDITORIA: os models existiam no schema, sem nenhuma rota.
//
// Decisões ancoradas no schema REAL:
//   - `LoyaltyProgram.tenantId` é @unique: um programa por tenant → PUT faz upsert.
//   - `LoyaltyTransaction` não tem tenantId: o isolamento passa SEMPRE por `LoyaltyAccount.tenantId`.
//   - `ReferralCode`/`Referral` são por TENANT (indicação SaaS→SaaS), não por cliente final.
import { Router, Request, Response } from "express";
import { z } from "zod";
import { prismaUnscoped as prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";

export const loyaltyRouter = Router();

async function hasPermission(role: string, userId: string, permissionCode: string): Promise<boolean> {
  const [defaultGrant, override] = await Promise.all([
    prisma.roleDefaultPermission.findUnique({ where: { role_permissionCode: { role: role as any, permissionCode } } }),
    prisma.rolePermission.findUnique({ where: { userId_permission: { userId, permission: permissionCode } } }),
  ]);
  return override ? override.granted : Boolean(defaultGrant);
}

function forbidden(res: Response, message: string) {
  return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message } });
}
function notFound(res: Response, message: string) {
  return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message } });
}
function validationError(res: Response, details: unknown) {
  return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: "Dados inválidos.", details } });
}

// ─────────────────────────────────────────────────────────────────────────
// PROGRAMA DE FIDELIDADE
// ─────────────────────────────────────────────────────────────────────────

loyaltyRouter.get("/loyalty/program", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "loyalty:program:read"))) {
    return forbidden(res, "Seu nível de acesso não permite consultar o programa de fidelidade.");
  }
  const program = await prisma.loyaltyProgram.findUnique({ where: { tenantId } });
  return res.json({ success: true, data: program, error: null });
});

const programSchema = z.object({
  active: z.boolean(),
  pointsPerCurrencyUnit: z.number().positive().max(9999),
  redemptionValuePerPoint: z.number().positive().max(99),
  minPointsToRedeem: z.number().int().nonnegative(),
  pointsExpireAfterDays: z.number().int().positive().nullable().optional(),
});

loyaltyRouter.put("/loyalty/program", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "loyalty:program:write"))) {
    return forbidden(res, "Seu nível de acesso não permite alterar o programa de fidelidade.");
  }
  const parsed = programSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error.flatten());
  const input = parsed.data;

  const data = {
    active: input.active,
    pointsPerCurrencyUnit: input.pointsPerCurrencyUnit,
    redemptionValuePerPoint: input.redemptionValuePerPoint,
    minPointsToRedeem: input.minPointsToRedeem,
    pointsExpireAfterDays: input.pointsExpireAfterDays ?? null,
  };
  const program = await prisma.loyaltyProgram.upsert({
    where: { tenantId },
    update: data,
    create: { tenantId, ...data },
  });
  return res.json({ success: true, data: program, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// CONTAS DE PONTOS
// ─────────────────────────────────────────────────────────────────────────

loyaltyRouter.get("/loyalty/accounts", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "loyalty:account:read"))) {
    return forbidden(res, "Seu nível de acesso não permite consultar saldos de pontos.");
  }
  const search = typeof req.query.search === "string" && req.query.search ? req.query.search : null;
  const accounts = await prisma.loyaltyAccount.findMany({
    where: {
      tenantId,
      ...(search ? { client: { name: { contains: search, mode: "insensitive" } } } : {}),
    },
    include: { client: { select: { id: true, name: true, document: true, phone: true } } },
    orderBy: { pointsBalance: "desc" },
    take: 100,
  });
  return res.json({ success: true, data: accounts, error: null });
});

// Cliente sem conta ainda tem saldo 0 — a conta só é criada no primeiro lançamento.
loyaltyRouter.get("/loyalty/accounts/:clientId", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "loyalty:account:read"))) {
    return forbidden(res, "Seu nível de acesso não permite consultar saldos de pontos.");
  }
  const client = await prisma.client.findFirst({ where: { id: req.params.clientId, tenantId }, select: { id: true, name: true } });
  if (!client) return notFound(res, "Cliente não encontrado.");

  const [account, program] = await Promise.all([
    prisma.loyaltyAccount.findUnique({ where: { clientId: client.id } }),
    prisma.loyaltyProgram.findUnique({ where: { tenantId } }),
  ]);
  const pointsBalance = account?.pointsBalance ?? 0;
  const redeemable = Boolean(program?.active) && pointsBalance >= (program?.minPointsToRedeem ?? Number.MAX_SAFE_INTEGER);
  const redeemableValue = redeemable && program ? Number(program.redemptionValuePerPoint) * pointsBalance : 0;

  return res.json({
    success: true,
    data: { client, accountId: account?.id ?? null, pointsBalance, programActive: Boolean(program?.active), redeemable, redeemableValue },
    error: null,
  });
});

loyaltyRouter.get("/loyalty/accounts/:clientId/transactions", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "loyalty:account:read"))) {
    return forbidden(res, "Seu nível de acesso não permite consultar o extrato de pontos.");
  }
  const account = await prisma.loyaltyAccount.findFirst({ where: { clientId: req.params.clientId, tenantId } });
  if (!account) return res.json({ success: true, data: [], error: null });

  const type = typeof req.query.type === "string" ? req.query.type : undefined;
  const validTypes = ["EARN", "REDEEM", "EXPIRE", "MANUAL_ADJUST"];
  if (type && !validTypes.includes(type)) return validationError(res, { type: ["Tipo inválido."] });

  const transactions = await prisma.loyaltyTransaction.findMany({
    where: { loyaltyAccountId: account.id, ...(type ? { type: type as any } : {}) },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return res.json({ success: true, data: transactions, error: null });
});

const adjustSchema = z.object({
  points: z.number().int().refine((n) => n !== 0, "O ajuste não pode ser zero."),
  reason: z.string().trim().min(3, "O motivo é obrigatório em ajuste manual."),
});

loyaltyRouter.post("/loyalty/accounts/:clientId/adjust", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "loyalty:account:write"))) {
    return forbidden(res, "Seu nível de acesso não permite ajustar saldo de pontos.");
  }
  const parsed = adjustSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error.flatten());
  const { points, reason } = parsed.data;

  const client = await prisma.client.findFirst({ where: { id: req.params.clientId, tenantId }, select: { id: true } });
  if (!client) return notFound(res, "Cliente não encontrado.");

  const result = await prisma.$transaction(async (tx) => {
    const account = await tx.loyaltyAccount.upsert({
      where: { clientId: client.id },
      update: {},
      create: { tenantId, clientId: client.id },
    });
    // O guard `pointsBalance >= -points` no WHERE impede saldo negativo sem corrida (check-and-update atômico).
    const updated = await tx.loyaltyAccount.updateMany({
      where: { id: account.id, ...(points < 0 ? { pointsBalance: { gte: -points } } : {}) },
      data: { pointsBalance: { increment: points } },
    });
    if (updated.count === 0) return { insufficient: true as const };

    const transaction = await tx.loyaltyTransaction.create({
      data: { loyaltyAccountId: account.id, type: "MANUAL_ADJUST", points, reason: `${reason} (por usuário ${userId})` },
    });
    const fresh = await tx.loyaltyAccount.findUniqueOrThrow({ where: { id: account.id } });
    return { insufficient: false as const, transaction, pointsBalance: fresh.pointsBalance };
  });

  if (result.insufficient) {
    return res.status(409).json({ success: false, data: null, error: { code: "INSUFFICIENT_POINTS", message: "Saldo de pontos insuficiente para este ajuste negativo." } });
  }
  return res.status(201).json({ success: true, data: { transaction: result.transaction, pointsBalance: result.pointsBalance }, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// INDICAÇÃO (tenant → tenant). Permissões reaproveitadas: billing:subscription:read/manage.
// ─────────────────────────────────────────────────────────────────────────

function buildReferralCode(tradeName: string): string {
  const base = tradeName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
    .slice(0, 8) || "FILITECH";
  const suffix = Math.floor(1000 + Math.random() * 9000);
  return `${base}${suffix}`;
}

loyaltyRouter.get("/referrals/my-code", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "billing:subscription:read"))) {
    return forbidden(res, "Seu nível de acesso não permite consultar o código de indicação.");
  }
  const existing = await prisma.referralCode.findUnique({ where: { tenantId } });
  if (existing) return res.json({ success: true, data: existing, error: null });

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { tradeName: true } });
  if (!tenant) return notFound(res, "Tenant não encontrado.");

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const created = await prisma.referralCode.create({ data: { tenantId, code: buildReferralCode(tenant.tradeName) } });
      return res.status(201).json({ success: true, data: created, error: null });
    } catch (err: any) {
      if (err?.code !== "P2002") throw err;
      // Corrida no mesmo tenant: outro request já criou o código.
      const raced = await prisma.referralCode.findUnique({ where: { tenantId } });
      if (raced) return res.json({ success: true, data: raced, error: null });
      // Senão foi colisão do `code` — tenta outro sufixo.
    }
  }
  return res.status(500).json({ success: false, data: null, error: { code: "CODE_GENERATION_FAILED", message: "Não foi possível gerar um código de indicação único." } });
});

loyaltyRouter.get("/referrals", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "billing:subscription:read"))) {
    return forbidden(res, "Seu nível de acesso não permite consultar indicações.");
  }
  const code = await prisma.referralCode.findUnique({ where: { tenantId } });
  if (!code) return res.json({ success: true, data: [], error: null });

  const referrals = await prisma.referral.findMany({
    where: { referralCodeId: code.id },
    include: { referredTenant: { select: { tradeName: true } } },
    orderBy: { createdAt: "desc" },
  });
  return res.json({ success: true, data: referrals, error: null });
});

const registerReferralSchema = z.object({ code: z.string().trim().min(3).transform((s) => s.toUpperCase()) });

// O tenant logado declara ter sido indicado por `code`. Só uma vez (referredTenantId @unique) e nunca por si mesmo.
loyaltyRouter.post("/referrals/register", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "billing:subscription:manage"))) {
    return forbidden(res, "Seu nível de acesso não permite registrar uma indicação.");
  }
  const parsed = registerReferralSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error.flatten());

  const referralCode = await prisma.referralCode.findUnique({ where: { code: parsed.data.code } });
  if (!referralCode) return notFound(res, "Código de indicação não encontrado.");
  if (referralCode.tenantId === tenantId) {
    return res.status(400).json({ success: false, data: null, error: { code: "SELF_REFERRAL", message: "Um tenant não pode indicar a si mesmo." } });
  }
  const already = await prisma.referral.findUnique({ where: { referredTenantId: tenantId } });
  if (already) {
    return res.status(409).json({ success: false, data: null, error: { code: "ALREADY_REFERRED", message: "Este tenant já registrou uma indicação." } });
  }

  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
  try {
    const referral = await prisma.referral.create({
      data: { referralCodeId: referralCode.id, referredTenantId: tenantId, expiresAt },
    });
    return res.status(201).json({ success: true, data: referral, error: null });
  } catch (err: any) {
    if (err?.code === "P2002") {
      return res.status(409).json({ success: false, data: null, error: { code: "ALREADY_REFERRED", message: "Este tenant já registrou uma indicação." } });
    }
    throw err;
  }
});

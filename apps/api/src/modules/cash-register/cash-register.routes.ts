// apps/api/src/modules/cash-register/cash-register.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 6.7 — Abertura/Fechamento de Caixa,
// Sangria e Suprimento. GAP DE AUDITORIA ENCONTRADO E CORRIGIDO: o serviço
// transacional (closeCashRegister/registerCashMovement) e as permissões RBAC
// ("pdv:cash-register:open"/"close") existiam desde o início, mas nenhuma rota REST
// jamais expôs essas funções — o PDV não tinha como abrir caixa, fazer sangria/
// suprimento ou fechar caixa via API; a tela de PDV (Capítulo 8.3) precisava pedir o
// ID do caixa manualmente por falta desta camada.
import { Router, Request, Response } from "express";
import { z } from "zod";
import { Prisma, prismaUnscoped as prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";
import { closeCashRegister, registerCashMovement } from "./close-cash-register.service";

export const cashRegisterRouter = Router();

async function hasPermission(role: string, userId: string, permissionCode: string): Promise<boolean> {
  const [defaultGrant, override] = await Promise.all([
    prisma.roleDefaultPermission.findUnique({ where: { role_permissionCode: { role: role as any, permissionCode } } }),
    prisma.rolePermission.findUnique({ where: { userId_permission: { userId, permission: permissionCode } } }),
  ]);
  return override ? override.granted : Boolean(defaultGrant);
}

/**
 * Retorna o caixa OPEN do operador logado, se existir — usado pelo PDV (Capítulo
 * 8.3) para descobrir qual CashRegister usar sem exigir digitação manual do ID.
 */
cashRegisterRouter.get("/cash-registers/current", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId } = req.session!;
  const current = await prisma.cashRegister.findFirst({
    where: { tenantId, openedById: userId, status: "OPEN" },
    orderBy: { openedAt: "desc" },
  });
  return res.json({ success: true, data: current, error: null });
});

const openCashRegisterSchema = z.object({
  openingAmount: z.number().nonnegative(),
});

cashRegisterRouter.post("/cash-registers", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "pdv:cash-register:open"))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite abrir caixa." } });
  }

  const parsed = openCashRegisterSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  // Um operador não pode abrir um segundo caixa enquanto o anterior ainda está
  // OPEN — evita duas gavetas físicas sendo conferidas simultaneamente sob o mesmo
  // operador, o que inviabilizaria o cálculo de divergência da gaveta cega (6.7).
  const alreadyOpen = await prisma.cashRegister.findFirst({ where: { tenantId, openedById: userId, status: "OPEN" } });
  if (alreadyOpen) {
    return res.status(409).json({
      success: false,
      data: null,
      error: { code: "CASH_REGISTER_ALREADY_OPEN", message: "Você já possui um caixa aberto. Feche-o antes de abrir outro." },
    });
  }

  const register = await prisma.cashRegister.create({
    data: {
      tenantId,
      openedById: userId,
      openingAmount: new Prisma.Decimal(parsed.data.openingAmount),
      status: "OPEN",
    },
  });

  return res.status(201).json({ success: true, data: register, error: null });
});

cashRegisterRouter.get("/cash-registers/:id", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "pdv:cash-register:open"))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite consultar caixas." } });
  }
  const register = await prisma.cashRegister.findFirst({
    where: { id: req.params.id, tenantId },
    include: { movements: true },
  });
  if (!register) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Caixa não encontrado." } });
  }
  return res.json({ success: true, data: register, error: null });
});

const cashMovementSchema = z.object({
  type: z.enum(["WITHDRAWAL", "INJECTION"]),
  amount: z.number().positive(),
  reason: z.string().min(3),
});

cashRegisterRouter.post("/cash-registers/:id/movements", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "pdv:cash-register:open"))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite registrar sangria/suprimento." } });
  }

  const parsed = cashMovementSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const register = await prisma.cashRegister.findFirst({ where: { id: req.params.id, tenantId, status: "OPEN" } });
  if (!register) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Caixa aberto não encontrado." } });
  }

  try {
    const movement = await prisma.$transaction((tx) =>
      registerCashMovement(tx, {
        cashRegisterId: register.id,
        type: parsed.data.type,
        amount: new Prisma.Decimal(parsed.data.amount),
        reason: parsed.data.reason,
        performedByUserId: userId,
      }),
    );
    return res.status(201).json({ success: true, data: movement, error: null });
  } catch (err) {
    return res.status(400).json({ success: false, data: null, error: { code: "INVALID_MOVEMENT", message: (err as Error).message } });
  }
});

const closeCashRegisterSchema = z.object({
  countedAmount: z.number().nonnegative(),
});

cashRegisterRouter.post("/cash-registers/:id/close", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "pdv:cash-register:close"))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite fechar caixa." } });
  }

  const parsed = closeCashRegisterSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const register = await prisma.cashRegister.findFirst({ where: { id: req.params.id, tenantId, status: "OPEN" } });
  if (!register) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Caixa aberto não encontrado." } });
  }

  const closed = await prisma.$transaction((tx) => closeCashRegister(tx, register.id, new Prisma.Decimal(parsed.data.countedAmount)));

  // divergenceAmount só é revelado na resposta de fechamento — nunca antes, por
  // design de gaveta cega (Capítulo 4.1/6.7): o operador conta o dinheiro sem saber
  // o valor esperado, e só então o sistema confronta contagem x esperado.
  return res.json({ success: true, data: closed, error: null });
});

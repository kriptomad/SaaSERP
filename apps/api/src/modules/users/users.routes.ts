// apps/api/src/modules/users/users.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 2.2 (RBAC) + Capítulo 2.9 (novo —
// cobrança por assento: 10 usuários ativos inclusos por tenant, cada usuário
// ativo adicional soma R$ 35,00/mês ao próximo ciclo de cobrança). Criação de
// usuário é sempre feita pelo Owner/Manager do próprio tenant (nunca
// self-signup de funcionário) — protegida por "settings:users:manage".
//
// Convenção de resposta (Capítulo 9): envelope { success, data, error }.
import { Router, Request, Response } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@filitech/db";
import { requireAuth, invalidateUserTokenVersionCache, invalidateUserSessionCache } from "../../middlewares/auth.middleware";
import { hashPassword } from "../auth/password.service";
import { setManagerPin, InvalidManagerPinFormatError } from "../auth/manager-pin.service";
import { calculateSeatBilling, reconcileSeatBillingWithProvider } from "../billing/seat-billing.service";
import { validatePasswordPolicy } from "../../lib/password-policy";

export const usersRouter = Router();

async function hasManageUsersPermission(role: string, userId: string): Promise<boolean> {
  const permissionCode = "settings:users:manage";
  const [defaultGrant, override] = await Promise.all([
    prisma.roleDefaultPermission.findUnique({
      where: { role_permissionCode: { role: role as any, permissionCode } },
    }),
    prisma.rolePermission.findUnique({
      where: { userId_permission: { userId, permission: permissionCode } },
    }),
  ]);
  return override ? override.granted : Boolean(defaultGrant);
}

usersRouter.get("/users", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasManageUsersPermission(role, userId))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite gerenciar usuários." } });
  }

  // Paginação (mesmo padrão de stock.routes.ts/financial/registrations): tenants com
  // muitos usuários ativos antes retornavam a lista inteira sem limite, arriscando
  // degradação de performance.
  const page = Math.max(1, Number.parseInt(String(req.query.page ?? "1"), 10) || 1);
  const pageSize = Math.min(200, Math.max(1, Number.parseInt(String(req.query.pageSize ?? "50"), 10) || 50));

  const [users, total, seatBilling] = await Promise.all([
    prisma.user.findMany({
      where: { tenantId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.user.count({ where: { tenantId } }),
    calculateSeatBilling(prisma, tenantId),
  ]);

  return res.json({
    success: true,
    meta: { page, pageSize, total },
    data: {
      users,
      seatBilling: {
        activeUserCount: seatBilling.activeUserCount,
        includedUserSeats: seatBilling.includedUserSeats,
        extraSeatCount: seatBilling.extraSeatCount,
        extraUserSeatPrice: seatBilling.extraUserSeatPrice?.toFixed(2) ?? null,
        extraMonthlyCharge: seatBilling.extraMonthlyCharge.toFixed(2),
      },
    },
    error: null,
  });
});

const createUserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["OWNER", "MANAGER", "TECHNICIAN", "CASHIER", "ACCOUNTANT", "HOUSEHOLD_MEMBER"]),
});

usersRouter.post("/users", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasManageUsersPermission(role, userId))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite gerenciar usuários." } });
  }

  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const input = parsed.data;

  const passwordPolicy = validatePasswordPolicy(input.password);
  if (!passwordPolicy.valid) {
    return res.status(400).json({ success: false, data: null, error: { code: "WEAK_PASSWORD", message: passwordPolicy.errors.join(" ") } });
  }

  if (input.role === "OWNER" && role !== "OWNER") {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Apenas um OWNER pode criar outro OWNER." } });
  }

  const passwordHash = await hashPassword(input.password);

  // Regra de negócio (Capítulo 2.9): a criação NUNCA é bloqueada pelo teto de
  // assentos — o excedente apenas aumenta o valor cobrado no próximo ciclo.
  // Calculamos o excedente ANTES de criar (estado atual) e DEPOIS (estado novo)
  // para devolver ao admin, na própria resposta, um aviso transparente de que
  // este usuário específico entrou na faixa paga.
  const seatBillingBefore = await calculateSeatBilling(prisma, tenantId);

  // GAP DE AUDITORIA CORRIGIDO (race condition de unicidade de e-mail): um
  // `findFirst` prévio seguido de `create` deixava uma janela entre a checagem e
  // a escrita onde duas requisições concorrentes para o mesmo e-mail passavam
  // ambas pela checagem antes de qualquer uma commitar, criando dois usuários com
  // o mesmo e-mail no mesmo tenant. Confiamos na constraint única do banco
  // (`@@unique([tenantId, email])`) e tratamos a violação (P2002) como 409.
  let createdUser;
  try {
    createdUser = await prisma.user.create({
      data: { tenantId, name: input.name, email: input.email, passwordHash, role: input.role as any },
      select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return res.status(409).json({ success: false, data: null, error: { code: "EMAIL_TAKEN", message: "Já existe um usuário com este e-mail neste tenant." } });
    }
    throw err;
  }

  const seatBillingAfter = await calculateSeatBilling(prisma, tenantId);
  const enteredPaidSeat = seatBillingAfter.extraSeatCount > seatBillingBefore.extraSeatCount;

  await reconcileSeatBillingWithProvider(prisma, tenantId);

  return res.status(201).json({
    success: true,
    data: {
      user: createdUser,
      seatBilling: {
        activeUserCount: seatBillingAfter.activeUserCount,
        includedUserSeats: seatBillingAfter.includedUserSeats,
        extraSeatCount: seatBillingAfter.extraSeatCount,
        extraUserSeatPrice: seatBillingAfter.extraUserSeatPrice?.toFixed(2) ?? null,
        extraMonthlyCharge: seatBillingAfter.extraMonthlyCharge.toFixed(2),
        enteredPaidSeat,
      },
    },
    error: null,
  });
});

usersRouter.patch("/users/:id/deactivate", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasManageUsersPermission(role, userId))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite gerenciar usuários." } });
  }

  const { id } = req.params;
  if (id === userId) {
    return res.status(400).json({ success: false, data: null, error: { code: "CANNOT_SELF_DEACTIVATE", message: "Você não pode desativar sua própria conta." } });
  }

  const target = await prisma.user.findFirst({ where: { id, tenantId } });
  if (!target) {
    return res.status(404).json({ success: false, data: null, error: { code: "USER_NOT_FOUND", message: "Usuário não encontrado neste tenant." } });
  }

  if (target.role === "OWNER" && role !== "OWNER") {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Apenas um OWNER pode desativar outro OWNER." } });
  }

  await prisma.user.updateMany({ where: { id, tenantId }, data: { active: false } });

  // CORREÇÃO DE AUDITORIA (fa-w6-sess-deactivated-user-token-still-valid): antes,
  // `active=false` não tinha NENHUM efeito prático sobre um JWT já emitido para
  // este usuário — `auth.middleware.ts` nunca checava `User.active`, só
  // `tokenVersion` (que não era bumped aqui), então o token continuava válido
  // por até 8h depois da desativação. Agora bump de `tokenVersion` (mesmo campo
  // já usado para invalidar tokens após troca de senha) E revogação de toda
  // `ActiveSession` ativa, ambos na MESMA operação lógica da desativação — além
  // disso, `auth.middleware.ts` passou a checar `User.active` explicitamente
  // (cacheado junto com `tokenVersion`, ver comentário lá), então mesmo sem o
  // bump de versão o token pararia de funcionar assim que o cache expirasse.
  const activeSessions = await prisma.activeSession.findMany({ where: { userId: id, revokedAt: null }, select: { refreshTokenHash: true } });
  await prisma.$transaction([
    prisma.user.update({ where: { id }, data: { tokenVersion: { increment: 1 } } }),
    prisma.activeSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  await invalidateUserTokenVersionCache(id);
  await Promise.all(activeSessions.map((s) => invalidateUserSessionCache(s.refreshTokenHash)));

  // Desativar libera imediatamente um assento pago, se aplicável — refletido
  // já na próxima chamada de calculateSeatBilling (não há cache nesta métrica).
  const seatBillingAfter = await calculateSeatBilling(prisma, tenantId);
  await reconcileSeatBillingWithProvider(prisma, tenantId);

  return res.json({
    success: true,
    data: {
      userId: id,
      active: false,
      seatBilling: {
        activeUserCount: seatBillingAfter.activeUserCount,
        includedUserSeats: seatBillingAfter.includedUserSeats,
        extraSeatCount: seatBillingAfter.extraSeatCount,
        extraMonthlyCharge: seatBillingAfter.extraMonthlyCharge.toFixed(2),
      },
    },
    error: null,
  });
});

// GAP DE AUDITORIA ENCONTRADO E CORRIGIDO: setManagerPin (Capítulo 6.8 — PIN de
// gerente usado na dupla autorização do estorno de venda) existia desde o início
// como serviço, mas nunca foi exposto por nenhuma rota REST — um Owner/Manager não
// tinha como configurar o próprio PIN. Restrito a OWNER/MANAGER (quem pode
// autorizar estornos), e sempre sobre a própria conta — nunca o PIN de outro
// usuário, mesmo por um Owner, para preservar a cadeia de responsabilidade.
const setManagerPinSchema = z.object({ pin: z.string().min(4).max(6) });

// Capítulo 20.2 — número E.164 pessoal do usuário, usado pelo canal real de WhatsApp
// (notify.service.ts/whatsapp.channel.ts). Dado pessoal do próprio usuário autenticado
// (userId sempre de req.session, nunca do body/URL) — mesmo raciocínio de autorização
// já usado pelas rotas de notification-settings.routes.ts: sem RBAC novo, pois um
// usuário nunca edita o contato de outro, nem mesmo um OWNER.
//
// AVISO PARA IMPLEMENTAÇÕES FUTURAS (fa-w6-sess-no-email-change-workflow,
// verificado nesta rodada: NENHUMA rota deste arquivo, ou de qualquer outro
// módulo, altera `User.email` hoje — só `whatsappPhone`, abaixo, tem um fluxo de
// self-service). `User.email` é também a credencial de LOGIN (`auth.routes.ts`,
// POST /login busca por `tenantId+email`) — se algum dia for adicionado um PATCH
// que aceite trocar `email` diretamente (aqui ou em qualquer rota nova), ELE NUNCA
// PODE simplesmente sobrescrever o campo numa única requisição. Isso abriria uma
// janela de account takeover: um atacante com uma sessão sequestrada (ex.: XSS,
// token roubado) trocaria o e-mail de login para um endereço que controla, e o
// dono legítimo perderia a conta sem nenhuma confirmação. Qualquer futura feature
// de troca de e-mail DEVE seguir o mesmo padrão já usado para reset de senha
// (`PasswordResetToken`/fluxo de e-mail): gravar o novo endereço num campo
// "pendente" (nunca sobrescrever `email` direto), enviar um token de confirmação
// de uso único para o endereço NOVO (nunca para o antigo, que pode já estar
// comprometido), e só promover `pendingEmail -> email` depois do clique de
// confirmação — idealmente também notificando o e-mail ANTIGO da mudança, para
// que o dono legítimo possa reagir caso não tenha sido ele quem solicitou.
const setContactSchema = z.object({
  whatsappPhone: z
    .string()
    .regex(/^\+[1-9]\d{7,14}$/, "Telefone inválido — use o formato E.164, ex.: +5511999998888.")
    .nullable(),
});

usersRouter.get("/users/me/contact", requireAuth, async (req: Request, res: Response) => {
  const { userId } = req.session!;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, whatsappPhone: true } });
  return res.json({ success: true, data: user, error: null });
});

usersRouter.patch("/users/me/contact", requireAuth, async (req: Request, res: Response) => {
  const { userId } = req.session!;
  const parsed = setContactSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { whatsappPhone: parsed.data.whatsappPhone },
    select: { whatsappPhone: true },
  });

  return res.json({ success: true, data: updated, error: null });
});

usersRouter.post("/users/me/manager-pin", requireAuth, async (req: Request, res: Response) => {
  const { userId, role } = req.session!;
  if (role !== "OWNER" && role !== "MANAGER") {
    return res.status(403).json({
      success: false,
      data: null,
      error: { code: "FORBIDDEN", message: "Apenas Owner ou Manager configuram PIN de autorização de estorno." },
    });
  }

  const parsed = setManagerPinSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  try {
    await setManagerPin(prisma, userId, parsed.data.pin);
  } catch (err) {
    if (err instanceof InvalidManagerPinFormatError) {
      return res.status(400).json({ success: false, data: null, error: { code: "INVALID_MANAGER_PIN_FORMAT", message: err.message } });
    }
    throw err;
  }

  return res.json({ success: true, data: { configured: true }, error: null });
});

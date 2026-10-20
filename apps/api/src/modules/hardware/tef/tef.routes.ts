// apps/api/src/modules/hardware/tef/tef.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 23.5 — contrato HTTP exposto ao PDV para
// iniciar/continuar/confirmar/cancelar uma transação TEF via SiTef. A credencial
// (host/porta do daemon local + código de loja/terminal) é a mesma
// `IntegrationCredential` genérica (provider `TEF_CLISITEF`), cadastrada pelo lojista
// em Configurações > Integrações — nunca hardcoded aqui.
//
// Estado de sessão TEF é persistido no Redis compartilhado (`tenant:{id}:tef:{sessionId}`,
// TTL curto) em vez de um Map em memória por processo: o SitefAdapter não guarda
// nenhuma conexão TCP/socket persistente (cada chamada é uma requisição HTTP
// independente ao daemon local, reconstruída a partir da IntegrationCredential salva
// no banco), então qualquer processo da API consegue retomar a sessão a partir do
// mesmo `tenantId` — isso elimina a perda de sessão em restart/failover/scale-out
// sem exigir nenhuma afinidade de processo.
import { Router, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "@filitech/db";
import { requireAuth } from "../../../middlewares/auth.middleware";
import { decryptEnvelope } from "../../../lib/envelope-crypto";
import { redis } from "../../../lib/redis";
import { notifyTenant } from "../../notifications/notify.service";
import { SitefAdapter, SitefConnectionConfig } from "./sitef-adapter";
import { TefDaemonUnreachableError, TefProvider, TefSessionNotFoundError } from "./tef-provider";

export const tefRouter = Router();

// CORREÇÃO DE AUDITORIA (RBAC): este router só exigia `requireAuth` genérico —
// qualquer usuário autenticado do tenant, de QUALQUER papel, conseguia iniciar/
// confirmar/cancelar uma cobrança na maquininha, mesmo sem nenhuma permissão de
// caixa. Replicado o mesmo padrão `hasPermission` usado em todos os outros
// módulos do sistema (ex.: liquor-ledger.routes.ts, tire-service-orders.routes.ts),
// com a permissão "pdv:cash-register:tef-payment" (seedada em
// packages/db/prisma/seed.ts para OWNER/MANAGER/CASHIER — os mesmos papéis que já
// abrem/fecham caixa).
async function hasPermission(role: string, userId: string, permissionCode: string): Promise<boolean> {
  const [defaultGrant, override] = await Promise.all([
    prisma.roleDefaultPermission.findUnique({ where: { role_permissionCode: { role: role as any, permissionCode } } }),
    prisma.rolePermission.findUnique({ where: { userId_permission: { userId, permission: permissionCode } } }),
  ]);
  return override ? override.granted : Boolean(defaultGrant);
}
async function requireTefPermission(req: Request, res: Response): Promise<boolean> {
  const { userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "pdv:cash-register:tef-payment"))) {
    res.status(403).json({
      success: false,
      data: null,
      error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite operar pagamento via TEF/maquininha." },
    });
    return false;
  }
  return true;
}

// TTL generoso o bastante para cobrir a janela de interação humana no pinpad
// (inserir/aproximar cartão + digitar senha), mas curto o suficiente para nunca
// deixar uma sessão travada indefinidamente no Redis caso o operador abandone o PDV.
const TEF_SESSION_TTL_SECONDS = 180;
// Janela de retenção do registro de confirmação idempotente — maior que o TTL da
// sessão em si, pois o objetivo é sobreviver exatamente ao cenário em que a
// sessão TEF já foi limpa (confirmação bem-sucedida) mas o cliente HTTP perdeu a
// resposta e reenviou a mesma requisição de confirmação por timeout/retry.
const TEF_CONFIRMATION_IDEMPOTENCY_TTL_SECONDS = 3600;

function tefSessionKey(sessionId: string): string {
  return `tef:session:${sessionId}`;
}
function tefConfirmationKey(sessionId: string): string {
  return `tef:confirmed:${sessionId}`;
}

// Estado de sessão agora vincula tenantId + userId + cashRegisterId + saleId —
// CORREÇÃO DE AUDITORIA: antes só guardava `tenantId`, então qualquer usuário
// autenticado do MESMO tenant (não necessariamente quem abriu a transação, nem
// necessariamente no mesmo caixa/venda) conseguia continuar/confirmar/cancelar
// uma sessão TEF alheia apenas sabendo o `sessionId` (ex.: visível em logs de
// rede do PDV). Agora toda operação subsequente revalida esses 4 vínculos.
interface TefSessionState {
  tenantId: string;
  userId: string;
  cashRegisterId: string;
  saleId: string;
  // CORREÇÃO DE AUDITORIA (fa-w5-hw-tef-payment-record-gap): o valor/forma de
  // pagamento e o NSU/código de autorização da adquirente precisam sobreviver do
  // `start`/`continue` (quando a aprovação de fato acontece) até o `confirm` — sem
  // isso o endpoint de confirmação não tinha como criar o `Payment` real vinculado
  // à venda, só limpar o cache do Redis (nenhum registro durável da cobrança).
  amountCents: number;
  transactionType: "CREDIT" | "DEBIT";
  nsu: string | null;
  authorizationCode: string | null;
}

async function saveTefSession(sessionId: string, state: TefSessionState): Promise<void> {
  await redis.set(tefSessionKey(sessionId), JSON.stringify(state), "EX", TEF_SESSION_TTL_SECONDS);
}

async function loadTefSession(sessionId: string): Promise<TefSessionState | null> {
  const raw = await redis.get(tefSessionKey(sessionId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.tenantId === "string" &&
      typeof parsed.userId === "string" &&
      typeof parsed.cashRegisterId === "string" &&
      typeof parsed.saleId === "string" &&
      typeof parsed.amountCents === "number" &&
      (parsed.transactionType === "CREDIT" || parsed.transactionType === "DEBIT") &&
      (parsed.nsu === null || typeof parsed.nsu === "string") &&
      (parsed.authorizationCode === null || typeof parsed.authorizationCode === "string")
    ) {
      return parsed as TefSessionState;
    }
    return null;
  } catch {
    return null;
  }
}

async function clearTefSession(sessionId: string): Promise<void> {
  await redis.del(tefSessionKey(sessionId));
}

// Valida que a sessão carregada pertence de fato ao chamador atual (tenant +
// operador) E que a venda/caixa vinculados ainda são válidos para este tenant —
// chamado em toda operação subsequente (continue/confirm/cancel).
async function assertSessionBindings(session: TefSessionState, tenantId: string, userId: string): Promise<string | null> {
  if (session.tenantId !== tenantId) return "Sessão TEF não encontrada ou expirada.";
  if (session.userId !== userId) return "Esta sessão TEF pertence a outro operador; não pode ser manipulada por este usuário.";
  const cashRegister = await prisma.cashRegister.findFirst({ where: { id: session.cashRegisterId, tenantId } });
  if (!cashRegister || cashRegister.status !== "OPEN") {
    return "O caixa vinculado a esta sessão TEF não está mais aberto.";
  }
  const sale = await prisma.sale.findFirst({ where: { id: session.saleId, tenantId } });
  if (!sale) return "A venda vinculada a esta sessão TEF não foi encontrada.";
  return null;
}

function isSitefConnectionPayload(value: Record<string, unknown>): value is SitefConnectionConfig & Record<string, unknown> {
  return (
    typeof value.host === "string" &&
    value.host.length > 0 &&
    (typeof value.port === "number" || typeof value.port === "string") &&
    typeof value.storeCode === "string" &&
    typeof value.terminalId === "string"
  );
}

async function resolveTefProvider(tenantId: string): Promise<TefProvider> {
  const credential = await prisma.integrationCredential.findUnique({
    where: { tenantId_provider_environment: { tenantId, provider: "TEF_CLISITEF", environment: "PRODUCTION" } },
  });
  if (!credential || !credential.active) {
    throw new TefDaemonUnreachableError(
      "Nenhuma maquininha/TEF configurada para este tenant. Cadastre o host/porta do daemon SiTef local em Configurações > Hardware antes de aceitar pagamento por cartão.",
    );
  }
  const decrypted = decryptEnvelope(Buffer.from(credential.encryptedPayload), credential.encryptionKeyId);
  if (!isSitefConnectionPayload(decrypted)) {
    throw new TefDaemonUnreachableError(
      "Credencial TEF cadastrada está com formato inválido (esperado { host, port, storeCode, terminalId }). Refaça o cadastro em Configurações > Hardware.",
    );
  }
  return new SitefAdapter({ ...decrypted, port: Number(decrypted.port) });
}

function handleTefError(res: Response, error: unknown) {
  if (error instanceof TefDaemonUnreachableError) {
    return res.status(503).json({ success: false, data: null, error: { code: "TEF_DAEMON_UNREACHABLE", message: error.message } });
  }
  if (error instanceof TefSessionNotFoundError) {
    return res.status(404).json({ success: false, data: null, error: { code: "TEF_SESSION_NOT_FOUND", message: error.message } });
  }
  throw error;
}

const startSchema = z.object({
  amountCents: z.number().int().positive(),
  transactionType: z.enum(["CREDIT", "DEBIT"]),
  saleReference: z.string().min(1),
  // CORREÇÃO DE AUDITORIA: `cashRegisterId` passa a ser obrigatório para que a
  // sessão TEF possa ser vinculada ao caixa físico que está cobrando — sem isso
  // não havia como validar, em `continue/confirm/cancel`, que o caixa ainda
  // está aberto e é o mesmo que iniciou a cobrança.
  cashRegisterId: z.string().min(1),
  installments: z.number().int().positive().max(21).optional(),
});

tefRouter.post("/hardware/tef/transactions", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireTefPermission(req, res))) return;
  const { tenantId, userId } = req.session!;
  const parsed = startSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  // CORREÇÃO DE AUDITORIA: `saleReference`/`cashRegisterId` chegavam do client
  // sem nenhuma validação de pertencimento ao tenant — agora confirmados contra
  // o banco ANTES de abrir a sessão TEF, e seus ids ficam gravados no próprio
  // estado da sessão (ver `TefSessionState`).
  const [sale, cashRegister] = await Promise.all([
    prisma.sale.findFirst({ where: { id: parsed.data.saleReference, tenantId } }),
    prisma.cashRegister.findFirst({ where: { id: parsed.data.cashRegisterId, tenantId } }),
  ]);
  if (!sale) {
    return res.status(404).json({ success: false, data: null, error: { code: "SALE_NOT_FOUND", message: "Venda (saleReference) não encontrada neste tenant." } });
  }
  if (!cashRegister || cashRegister.status !== "OPEN") {
    return res.status(409).json({ success: false, data: null, error: { code: "CASH_REGISTER_NOT_OPEN", message: "O caixa informado não está aberto neste tenant." } });
  }

  // CORREÇÃO DE AUDITORIA (fa-w5-hw-tef-client-controlled-amount): `amountCents`
  // antes só era validado como inteiro positivo pelo `startSchema` (zod) — nunca
  // cruzado contra o valor real da venda, então um client comprometido/adulterado
  // podia mandar QUALQUER valor para a maquininha (inclusive menor que o total
  // devido, ou maior, abrindo espaço para cobrança indevida do cliente sem
  // lastro no saldo da venda). O client continua enviando `amountCents` só como
  // valor de conveniência/exibição — o servidor é sempre a fonte da verdade:
  // calcula aqui o saldo em aberto real (total da venda menos pagamentos já
  // CONFIRMADOS) e rejeita se o valor pedido ultrapassar esse saldo.
  const confirmedPayments = await prisma.payment.aggregate({
    where: { tenantId, saleId: sale.id, status: "CONFIRMED" },
    _sum: { amount: true },
  });
  const totalCents = Math.round(Number(sale.totalAmount) * 100);
  const paidCents = Math.round(Number(confirmedPayments._sum.amount ?? 0) * 100);
  const allowedCents = totalCents - paidCents;
  if (parsed.data.amountCents > allowedCents) {
    return res.status(400).json({
      success: false,
      data: null,
      error: {
        code: "AMOUNT_EXCEEDS_BALANCE",
        message: `Valor solicitado (R$ ${(parsed.data.amountCents / 100).toFixed(2)}) excede o saldo em aberto da venda (R$ ${(Math.max(0, allowedCents) / 100).toFixed(2)}). A cobrança na maquininha nunca pode ultrapassar o saldo real registrado no servidor.`,
      },
    });
  }

  try {
    const provider = await resolveTefProvider(tenantId);
    const result = await provider.startTransaction({
      amountCents: parsed.data.amountCents,
      transactionType: parsed.data.transactionType,
      saleReference: parsed.data.saleReference,
      installments: parsed.data.installments,
    });
    const sessionId = result.sessionId || randomUUID();
    await saveTefSession(sessionId, {
      tenantId,
      userId,
      cashRegisterId: cashRegister.id,
      saleId: sale.id,
      amountCents: parsed.data.amountCents,
      transactionType: parsed.data.transactionType,
      nsu: result.nsu,
      authorizationCode: result.authorizationCode,
    });
    return res.status(201).json({ success: true, data: { ...result, sessionId }, error: null });
  } catch (error) {
    return handleTefError(res, error);
  }
});

const continueSchema = z.object({ fieldId: z.string().min(1), value: z.string() });

tefRouter.post("/hardware/tef/transactions/:sessionId/continue", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireTefPermission(req, res))) return;
  const { tenantId, userId } = req.session!;
  const { sessionId } = req.params;
  const parsed = continueSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const session = await loadTefSession(sessionId);
  if (!session) {
    return res.status(404).json({ success: false, data: null, error: { code: "TEF_SESSION_NOT_FOUND", message: "Sessão TEF não encontrada ou expirada." } });
  }
  const bindingError = await assertSessionBindings(session, tenantId, userId);
  if (bindingError) {
    return res.status(404).json({ success: false, data: null, error: { code: "TEF_SESSION_NOT_FOUND", message: bindingError } });
  }
  try {
    const provider = await resolveTefProvider(tenantId);
    const result = await provider.continueTransaction(sessionId, parsed.data.fieldId, parsed.data.value);
    // Renova o TTL a cada interação — a janela de 180s é por passo, não para a
    // transação inteira (que pode ter N idas e vindas de `continue`) — e persiste o
    // NSU/código de autorização assim que a adquirente os devolver (geralmente só no
    // passo em que a transação é de fato aprovada), para que `confirm` tenha esses
    // dados disponíveis ao criar o `Payment` (ver fa-w5-hw-tef-payment-record-gap).
    await saveTefSession(sessionId, {
      ...session,
      nsu: result.nsu ?? session.nsu,
      authorizationCode: result.authorizationCode ?? session.authorizationCode,
    });
    return res.json({ success: true, data: result, error: null });
  } catch (error) {
    return handleTefError(res, error);
  }
});

tefRouter.post("/hardware/tef/transactions/:sessionId/confirm", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireTefPermission(req, res))) return;
  const { tenantId, userId } = req.session!;
  const { sessionId } = req.params;

  // CORREÇÃO DE AUDITORIA (idempotência): se esta sessão já foi confirmada com
  // sucesso antes (ex.: o cliente HTTP não recebeu a resposta por timeout de
  // rede e reenviou o mesmo POST), a sessão já foi limpa do Redis — sem este
  // registro de idempotência, o retry cairia no "TEF_SESSION_NOT_FOUND" e o
  // operador poderia ser levado a iniciar uma NOVA cobrança manualmente,
  // cobrando o cliente duas vezes. Retorna o mesmo resultado já confirmado sem
  // chamar `provider.confirmTransaction` de novo.
  const cachedConfirmation = await redis.get(tefConfirmationKey(sessionId));
  if (cachedConfirmation) {
    try {
      const cached = JSON.parse(cachedConfirmation);
      if (cached?.tenantId === tenantId) {
        return res.json({ success: true, data: { sessionId, confirmed: true, idempotentReplay: true }, error: null });
      }
    } catch {
      // registro corrompido — ignora e segue o fluxo normal abaixo
    }
  }

  const session = await loadTefSession(sessionId);
  if (!session) {
    return res.status(404).json({ success: false, data: null, error: { code: "TEF_SESSION_NOT_FOUND", message: "Sessão TEF não encontrada ou expirada." } });
  }
  const bindingError = await assertSessionBindings(session, tenantId, userId);
  if (bindingError) {
    return res.status(404).json({ success: false, data: null, error: { code: "TEF_SESSION_NOT_FOUND", message: bindingError } });
  }
  try {
    const provider = await resolveTefProvider(tenantId);
    // Retry local com backoff curto antes de desistir: a maioria das falhas de
    // confirmação é uma instabilidade transitória de rede local até o daemon, não
    // uma rejeição definitiva — tentar de novo silenciosamente evita incomodar o
    // operador do caixa por um soluço momentâneo.
    const delaysMs = [500, 1500, 4000];
    let lastError: unknown;
    for (let attempt = 0; attempt <= delaysMs.length; attempt += 1) {
      try {
        await provider.confirmTransaction(sessionId);
        // CORREÇÃO DE AUDITORIA (fa-w5-hw-tef-payment-record-gap): até aqui, uma
        // transação TEF aprovada só deixava rastro no cache de idempotência do
        // Redis (TTL de 1h) — nenhum registro DURÁVEL no banco vinculava a cobrança
        // aprovada na adquirente a um `Payment` real da venda. Se o Redis fosse
        // perdido (restart sem persistência, TTL expirado, falha de infra), o
        // dinheiro cobrado do cliente não tinha NENHUM lastro contábil no ERP.
        // `upsert` por `idempotencyKey` único (`tef:{sessionId}`) garante que, mesmo
        // com retries desta mesma confirmação, no máximo um `Payment` é criado.
        await prisma.payment.upsert({
          where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: `tef:${sessionId}` } },
          update: {},
          create: {
            tenantId,
            saleId: session.saleId,
            method: session.transactionType === "CREDIT" ? "CREDIT_CARD" : "DEBIT_CARD",
            status: "CONFIRMED",
            amount: session.amountCents / 100,
            tefAuthorizationCode: session.authorizationCode,
            externalProviderId: session.nsu,
            idempotencyKey: `tef:${sessionId}`,
          },
        });
        await redis.set(tefConfirmationKey(sessionId), JSON.stringify({ tenantId, confirmedAt: new Date().toISOString() }), "EX", TEF_CONFIRMATION_IDEMPOTENCY_TTL_SECONDS);
        await clearTefSession(sessionId);
        return res.json({ success: true, data: { sessionId, confirmed: true }, error: null });
      } catch (error) {
        lastError = error;
        if (attempt < delaysMs.length) {
          await new Promise((resolve) => setTimeout(resolve, delaysMs[attempt]));
        }
      }
    }
    // Todas as tentativas falharam: a adquirente pode ter aprovado o débito no
    // cartão do cliente sem que o ERP tenha confirmado — isso NUNCA deve ficar só
    // num toast que o operador pode perder. Mantém a sessão no Redis (não limpa)
    // para permitir nova tentativa manual e dispara um alerta crítico persistente
    // para o lojista reconciliar com o extrato da adquirente.
    await notifyTenant({
      tenantId,
      category: "TEF_CONFIRMATION_FAILED",
      severity: "CRITICAL",
      title: "Falha ao confirmar transação TEF junto à adquirente",
      body: `A sessão TEF ${sessionId} foi aprovada pelo cliente, mas o ERP não conseguiu confirmá-la junto à adquirente após ${delaysMs.length + 1} tentativas. Verifique o extrato da maquininha e, se o débito foi efetivado, reconcilie manualmente; caso contrário, a transação pode ter expirado sem captura. Erro: ${(lastError as Error)?.message ?? "desconhecido"}`,
      linkRoute: "/configuracoes/hardware",
      sourceType: "TEF_SESSION",
      sourceId: sessionId,
    });
    return res.status(502).json({
      success: false,
      data: null,
      error: {
        code: "TEF_CONFIRMATION_FAILED",
        message: "Venda registrada, mas não foi possível confirmar a transação na maquininha após múltiplas tentativas. Um alerta crítico foi enviado para o lojista reconciliar manualmente.",
      },
    });
  } catch (error) {
    return handleTefError(res, error);
  }
});

const cancelSchema = z.object({ nsu: z.string().min(1), reason: z.string().min(3) });

tefRouter.post("/hardware/tef/transactions/:sessionId/cancel", requireAuth, async (req: Request, res: Response) => {
  if (!(await requireTefPermission(req, res))) return;
  const { tenantId, userId } = req.session!;
  const { sessionId } = req.params;
  const parsed = cancelSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  // CORREÇÃO DE AUDITORIA: o fallback anterior (`session = { tenantId }` quando a
  // sessão não era encontrada no Redis) permitia "cancelar" usando SOMENTE o
  // tenantId do chamador — sem validar que o NSU informado de fato pertence a
  // uma sessão/transação real deste tenant/operador/caixa/venda, abrindo
  // margem para um cancelamento arbitrário contra o daemon só com um NSU
  // adivinhado/reaproveitado. Removido: a sessão original precisa continuar
  // válida (dentro do TTL) para que o cancelamento seja aceito; se ela já
  // expirou, a reconciliação deve ser feita manualmente pelo lojista (mesmo
  // fluxo de alerta já usado em `TEF_CONFIRMATION_FAILED`), nunca por este
  // endpoint sem lastro de sessão.
  const session = await loadTefSession(sessionId);
  if (!session) {
    return res.status(404).json({ success: false, data: null, error: { code: "TEF_SESSION_NOT_FOUND", message: "Sessão TEF não encontrada ou expirada." } });
  }
  const bindingError = await assertSessionBindings(session, tenantId, userId);
  if (bindingError) {
    return res.status(404).json({ success: false, data: null, error: { code: "TEF_SESSION_NOT_FOUND", message: bindingError } });
  }
  try {
    const provider = await resolveTefProvider(tenantId);
    await provider.cancelTransaction(sessionId, parsed.data.nsu, parsed.data.reason);
    await clearTefSession(sessionId);
    return res.json({ success: true, data: { sessionId, cancelled: true }, error: null });
  } catch (error) {
    return handleTefError(res, error);
  }
});

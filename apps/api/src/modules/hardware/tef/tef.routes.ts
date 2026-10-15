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

// TTL generoso o bastante para cobrir a janela de interação humana no pinpad
// (inserir/aproximar cartão + digitar senha), mas curto o suficiente para nunca
// deixar uma sessão travada indefinidamente no Redis caso o operador abandone o PDV.
const TEF_SESSION_TTL_SECONDS = 180;

function tefSessionKey(sessionId: string): string {
  return `tef:session:${sessionId}`;
}

async function saveTefSession(sessionId: string, tenantId: string): Promise<void> {
  await redis.set(tefSessionKey(sessionId), tenantId, "EX", TEF_SESSION_TTL_SECONDS);
}

async function loadTefSession(sessionId: string): Promise<{ tenantId: string } | null> {
  const tenantId = await redis.get(tefSessionKey(sessionId));
  return tenantId ? { tenantId } : null;
}

async function clearTefSession(sessionId: string): Promise<void> {
  await redis.del(tefSessionKey(sessionId));
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
  installments: z.number().int().positive().max(21).optional(),
});

tefRouter.post("/hardware/tef/transactions", requireAuth, async (req: Request, res: Response) => {
  const { tenantId } = req.session!;
  const parsed = startSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  try {
    const provider = await resolveTefProvider(tenantId);
    const result = await provider.startTransaction(parsed.data);
    const sessionId = result.sessionId || randomUUID();
    await saveTefSession(sessionId, tenantId);
    return res.status(201).json({ success: true, data: { ...result, sessionId }, error: null });
  } catch (error) {
    return handleTefError(res, error);
  }
});

const continueSchema = z.object({ fieldId: z.string().min(1), value: z.string() });

tefRouter.post("/hardware/tef/transactions/:sessionId/continue", requireAuth, async (req: Request, res: Response) => {
  const { tenantId } = req.session!;
  const { sessionId } = req.params;
  const parsed = continueSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const session = await loadTefSession(sessionId);
  if (!session || session.tenantId !== tenantId) {
    return res.status(404).json({ success: false, data: null, error: { code: "TEF_SESSION_NOT_FOUND", message: "Sessão TEF não encontrada ou expirada." } });
  }
  try {
    // Renova o TTL a cada interação — a janela de 180s é por passo, não para a
    // transação inteira (que pode ter N idas e vindas de `continue`).
    await saveTefSession(sessionId, tenantId);
    const provider = await resolveTefProvider(tenantId);
    const result = await provider.continueTransaction(sessionId, parsed.data.fieldId, parsed.data.value);
    return res.json({ success: true, data: result, error: null });
  } catch (error) {
    return handleTefError(res, error);
  }
});

tefRouter.post("/hardware/tef/transactions/:sessionId/confirm", requireAuth, async (req: Request, res: Response) => {
  const { tenantId } = req.session!;
  const { sessionId } = req.params;
  const session = await loadTefSession(sessionId);
  if (!session || session.tenantId !== tenantId) {
    return res.status(404).json({ success: false, data: null, error: { code: "TEF_SESSION_NOT_FOUND", message: "Sessão TEF não encontrada ou expirada." } });
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
  const { tenantId } = req.session!;
  const { sessionId } = req.params;
  const parsed = cancelSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  let session = await loadTefSession(sessionId);
  if (!session) {
    // Sessão já expirou/não existe no Redis (ex.: processo que a abriu caiu antes de
    // persistir) — ainda assim tentamos cancelar no daemon usando só o tenantId do
    // chamador autenticado, pois o SiTef identifica a transação pelo NSU informado.
    session = { tenantId };
  }
  if (session.tenantId !== tenantId) {
    return res.status(404).json({ success: false, data: null, error: { code: "TEF_SESSION_NOT_FOUND", message: "Sessão TEF não encontrada ou expirada." } });
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

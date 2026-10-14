// apps/api/src/modules/hardware/tef/tef.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 23.5 — contrato HTTP exposto ao PDV para
// iniciar/continuar/confirmar/cancelar uma transação TEF via SiTef. A credencial
// (host/porta do daemon local + código de loja/terminal) é a mesma
// `IntegrationCredential` genérica (provider `TEF_CLISITEF`), cadastrada pelo lojista
// em Configurações > Integrações — nunca hardcoded aqui.
//
// Estado de sessão TEF é mantido em memória (Map), por processo: a janela de uma
// transação de cartão (cliente insere/aproxima o cartão e digita a senha no pinpad)
// dura segundos, nunca sobrevive a um restart do processo, e exige o mesmo processo
// Node que iniciou a chamada para falar com o daemon local — manter em banco seria
// complexidade sem benefício real (nenhum outro processo precisa ler esse estado).
import { Router, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "@filitech/db";
import { requireAuth } from "../../../middlewares/auth.middleware";
import { decryptEnvelope } from "../../../lib/envelope-crypto";
import { SitefAdapter, SitefConnectionConfig } from "./sitef-adapter";
import { TefDaemonUnreachableError, TefProvider, TefSessionNotFoundError } from "./tef-provider";

export const tefRouter = Router();

interface TefSessionRecord {
  tenantId: string;
  provider: TefProvider;
}

const activeSessions = new Map<string, TefSessionRecord>();

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
    activeSessions.set(sessionId, { tenantId, provider });
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
  const session = activeSessions.get(sessionId);
  if (!session || session.tenantId !== tenantId) {
    return res.status(404).json({ success: false, data: null, error: { code: "TEF_SESSION_NOT_FOUND", message: "Sessão TEF não encontrada ou expirada." } });
  }
  try {
    const result = await session.provider.continueTransaction(sessionId, parsed.data.fieldId, parsed.data.value);
    return res.json({ success: true, data: result, error: null });
  } catch (error) {
    return handleTefError(res, error);
  }
});

tefRouter.post("/hardware/tef/transactions/:sessionId/confirm", requireAuth, async (req: Request, res: Response) => {
  const { tenantId } = req.session!;
  const { sessionId } = req.params;
  const session = activeSessions.get(sessionId);
  if (!session || session.tenantId !== tenantId) {
    return res.status(404).json({ success: false, data: null, error: { code: "TEF_SESSION_NOT_FOUND", message: "Sessão TEF não encontrada ou expirada." } });
  }
  try {
    await session.provider.confirmTransaction(sessionId);
    activeSessions.delete(sessionId);
    return res.json({ success: true, data: { sessionId, confirmed: true }, error: null });
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
  let session = activeSessions.get(sessionId);
  if (!session) {
    try {
      session = { tenantId, provider: await resolveTefProvider(tenantId) };
    } catch (error) {
      return handleTefError(res, error);
    }
  }
  if (session.tenantId !== tenantId) {
    return res.status(404).json({ success: false, data: null, error: { code: "TEF_SESSION_NOT_FOUND", message: "Sessão TEF não encontrada ou expirada." } });
  }
  try {
    await session.provider.cancelTransaction(sessionId, parsed.data.nsu, parsed.data.reason);
    activeSessions.delete(sessionId);
    return res.json({ success: true, data: { sessionId, cancelled: true }, error: null });
  } catch (error) {
    return handleTefError(res, error);
  }
});

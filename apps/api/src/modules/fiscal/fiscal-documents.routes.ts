// apps/api/src/modules/fiscal/fiscal-documents.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 21.19.3/21.19.4 — rotas REST para os dois
// eventos fiscais pós-emissão que ainda não tinham nenhuma rota: Carta de Correção
// Eletrônica (CC-e) e a parte MANUAL da Manifestação do Destinatário
// (`/fiscal/notas-recebidas`, citada textualmente na Bible). As partes automáticas
// (ciência via Distribuição DFe, confirmação no recebimento de mercadoria) já
// disparam sozinhas em `fetch-incoming-nfe.worker.ts`/`purchase-orders.routes.ts`.
//
// Permissão: reaproveita "stock:product:read"/"stock:product:write" — mesmo domínio
// RBAC do módulo de Compras (Capítulo 17.8), já que notas de compra recebidas e
// eventos fiscais sobre documentos emitidos pelo próprio tenant afetam diretamente o
// mesmo fluxo de estoque/custo.
import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";
import {
  issueCorrectionLetter,
  CorrectionLetterNotApplicableToDocumentTypeError,
  CorrectionLetterCannotAlterValuesTaxesOrDatesError,
  CorrectionLetterTextOutOfBoundsError,
  OnlyAuthorizedDocumentsAcceptCorrectionLetterError,
} from "./issue-correction-letter.service";
import {
  manifestRecipientOperation,
  RecipientManifestationNotApplicableError,
  RecipientManifestationJustificationTooShortError,
  RecipientManifestationAlreadyFinalError,
} from "./manifest-recipient.service";
import { FocusNfeNotConfiguredError, FiscalDocumentMissingAccessKeyError } from "./transmit-fiscal-event";

export const fiscalDocumentsRouter = Router();

async function hasPermission(role: string, userId: string, permissionCode: string): Promise<boolean> {
  const [defaultGrant, override] = await Promise.all([
    prisma.roleDefaultPermission.findUnique({ where: { role_permissionCode: { role: role as any, permissionCode } } }),
    prisma.rolePermission.findUnique({ where: { userId_permission: { userId, permission: permissionCode } } }),
  ]);
  return override ? override.granted : Boolean(defaultGrant);
}

// GET /fiscal/notas-recebidas — lista as NF-e de COMPRA recebidas via Distribuição
// DFe (tenant como destinatário), com o status da última manifestação de cada uma.
fiscalDocumentsRouter.get("/fiscal/notas-recebidas", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  // GAP DE AUDITORIA FECHADO (Rodada 13): esta rota devolve metadado fiscal
  // sensível (chave de acesso da NF-e, CNPJ do emitente, valores) e estava
  // liberada para qualquer papel com "stock:product:read" (ex.: estoquista),
  // um escopo muito mais amplo do que o necessário. "fiscal:document:read" já
  // existe na matriz RBAC (usada por Contador/Owner) e é a permissão correta
  // para dados fiscais.
  if (!(await hasPermission(role, userId, "fiscal:document:read"))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite consultar notas fiscais recebidas." } });
  }

  const notes = await prisma.fiscalDocument.findMany({
    where: { tenantId, type: "NFE_ENTRADA" },
    include: {
      supplier: { select: { id: true, name: true } },
      purchaseOrder: { select: { id: true, orderNumber: true } },
      events: { where: { eventType: "RECIPIENT_MANIFESTATION" }, orderBy: { sequenceNumber: "desc" }, take: 1 },
    },
    orderBy: { authorizedAt: "desc" },
    take: 200,
  });

  return res.json({
    success: true,
    data: notes.map((note) => ({
      id: note.id,
      accessKey: note.accessKey,
      emitterCnpj: note.emitterCnpj,
      emitterName: note.emitterName,
      totalAmount: note.totalAmount,
      authorizedAt: note.authorizedAt,
      supplier: note.supplier,
      purchaseOrder: note.purchaseOrder,
      lastManifestation: note.events[0] ? { type: note.events[0].manifestationType, status: note.events[0].status, createdAt: note.events[0].createdAt } : null,
    })),
    error: null,
  });
});

const manualManifestSchema = z.object({
  manifestationType: z.enum(["OPERACAO_NAO_REALIZADA", "DESCONHECIMENTO_DA_OPERACAO"]),
  justification: z.string().optional(),
});

// POST /fiscal/notas-recebidas/:id/manifestar — manifestação MANUAL do lojista,
// protegendo-o de ser responsabilizado por uma NF-e emitida indevidamente em seu
// CNPJ. CIENCIA_DA_OPERACAO (automática/diária) e CONFIRMACAO_DA_OPERACAO
// (automática no recebimento de mercadoria) nunca passam por esta rota.
fiscalDocumentsRouter.post("/fiscal/notas-recebidas/:id/manifestar", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "stock:product:write"))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite manifestar-se sobre notas fiscais recebidas." } });
  }
  const parsed = manualManifestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  try {
    const event = await manifestRecipientOperation(prisma, {
      tenantId,
      fiscalDocumentId: req.params.id,
      manifestationType: parsed.data.manifestationType,
      justification: parsed.data.justification,
    });
    return res.json({ success: true, data: event, error: null });
  } catch (err) {
    if (err instanceof RecipientManifestationNotApplicableError) {
      return res.status(422).json({ success: false, data: null, error: { code: "MANIFESTATION_NOT_APPLICABLE", message: err.message } });
    }
    if (err instanceof RecipientManifestationJustificationTooShortError) {
      return res.status(400).json({ success: false, data: null, error: { code: "JUSTIFICATION_TOO_SHORT", message: err.message } });
    }
    if (err instanceof RecipientManifestationAlreadyFinalError) {
      return res.status(409).json({ success: false, data: null, error: { code: "MANIFESTATION_ALREADY_FINAL", message: err.message } });
    }
    if (err instanceof FocusNfeNotConfiguredError) {
      return res.status(422).json({ success: false, data: null, error: { code: "FOCUS_NFE_NOT_CONFIGURED", message: err.message } });
    }
    if (err instanceof FiscalDocumentMissingAccessKeyError) {
      return res.status(422).json({ success: false, data: null, error: { code: "MISSING_ACCESS_KEY", message: err.message } });
    }
    return res.status(404).json({ success: false, data: null, error: { code: "FISCAL_DOCUMENT_NOT_FOUND", message: "Documento fiscal não encontrado." } });
  }
});

const correctionLetterSchema = z.object({ correctionText: z.string() });

// POST /fiscal/documents/:id/correction-letter — Carta de Correção Eletrônica (CC-e),
// aplicável apenas a NF-e modelo 55 (NFE_SAIDA) — ver issue-correction-letter.service.ts.
fiscalDocumentsRouter.post("/fiscal/documents/:id/correction-letter", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "stock:product:write"))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite emitir Carta de Correção." } });
  }
  const parsed = correctionLetterSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  try {
    const event = await issueCorrectionLetter(prisma, { tenantId, fiscalDocumentId: req.params.id, correctionText: parsed.data.correctionText });
    return res.json({ success: true, data: event, error: null });
  } catch (err) {
    if (err instanceof CorrectionLetterCannotAlterValuesTaxesOrDatesError) {
      return res.status(422).json({ success: false, data: null, error: { code: "CORRECTION_LETTER_FORBIDDEN_CONTENT", message: err.message } });
    }
    if (err instanceof CorrectionLetterTextOutOfBoundsError) {
      return res.status(400).json({ success: false, data: null, error: { code: "CORRECTION_LETTER_TEXT_OUT_OF_BOUNDS", message: err.message } });
    }
    if (err instanceof OnlyAuthorizedDocumentsAcceptCorrectionLetterError) {
      return res.status(422).json({ success: false, data: null, error: { code: "ONLY_AUTHORIZED_DOCUMENTS", message: err.message } });
    }
    if (err instanceof CorrectionLetterNotApplicableToDocumentTypeError) {
      return res.status(422).json({ success: false, data: null, error: { code: "CORRECTION_LETTER_NOT_APPLICABLE", message: err.message } });
    }
    if (err instanceof FocusNfeNotConfiguredError) {
      return res.status(422).json({ success: false, data: null, error: { code: "FOCUS_NFE_NOT_CONFIGURED", message: err.message } });
    }
    if (err instanceof FiscalDocumentMissingAccessKeyError) {
      return res.status(422).json({ success: false, data: null, error: { code: "MISSING_ACCESS_KEY", message: err.message } });
    }
    return res.status(404).json({ success: false, data: null, error: { code: "FISCAL_DOCUMENT_NOT_FOUND", message: "Documento fiscal não encontrado." } });
  }
});

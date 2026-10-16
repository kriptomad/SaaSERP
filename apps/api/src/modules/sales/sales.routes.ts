// apps/api/src/modules/sales/sales.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 9.5 — contrato HTTP de POST /api/sales,
// chamado pelo Service Worker do PDV offline (Capítulo 8.3) ao reconectar. O handler
// real é closeSaleAndEmitFiscalDocument (Capítulo 6.6) — esta rota nunca grava Sale
// diretamente. O cashierId NUNCA vem do corpo da requisição: é resolvido a partir de
// req.session.userId (contexto implícito, Capítulo 7), para que um caixa logado não
// possa forjar uma venda em nome de outro operador alterando o JSON enviado pelo
// navegador.
import { Router, Request, Response } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";
import { createModuleLogger } from "../../lib/logger";
import {
  closeSaleAndEmitFiscalDocument,
  SerialNotFoundError,
  SerialNotReadyForSaleError,
  CashRegisterNotFoundError,
  VariantRequiredError,
  VariantNotFoundError,
  InsufficientVariantStockError,
  PrescriptionRequiredError,
  ClientRequiredForStoreCreditError,
  CreditLimitExceededError,
  HealthInsurancePlanRequiredError,
  OpticalPrescriptionRequiredError,
  ConsignmentSupplierRequiredError,
  KitCompositionMissingError,
  SplitPaymentValidationError,
  PriceMismatchError,
} from "./close-sale.service";
import { RateLimitExceededError } from "../../lib/rate-limit";
import { InsufficientStockError } from "../../services/stock/deduct-stock-fefo.service";
import {
  refundSale,
  RefundReasonRequiredError,
  RefundRequiresManagerRoleError,
  RefundCannotSelfAuthorizeError,
  OnlyPaidSalesCanBeRefundedError,
} from "../pdv/refund-sale.service";
import {
  InvalidManagerPinError,
  ManagerPinNotConfiguredError,
} from "../auth/manager-pin.service";
import {
  CancellationJustificationTooShortError,
  OnlyAuthorizedDocumentsCanBeCancelledError,
  CancellationNotApplicableToDocumentTypeError,
  CancellationDeadlineExpiredError,
} from "../fiscal/cancel-fiscal-document.service";

export const salesRouter = Router();
const log = createModuleLogger("sales.routes");

async function hasPermission(role: string, userId: string, permissionCode: string): Promise<boolean> {
  const [defaultGrant, override] = await Promise.all([
    prisma.roleDefaultPermission.findUnique({ where: { role_permissionCode: { role: role as any, permissionCode } } }),
    prisma.rolePermission.findUnique({ where: { userId_permission: { userId, permission: permissionCode } } }),
  ]);
  return override ? override.granted : Boolean(defaultGrant);
}

const closeSaleSchema = z.object({
  idempotencyKey: z.string().uuid(),
  cashRegisterId: z.string(),
  // Capítulo 4.1.1 — cliente identificado via CPF na nota, usado para creditar
  // pontos de fidelidade (EARN); opcional, pois nem toda venda tem CPF informado.
  clientId: z.string().optional(),
  items: z
    .array(
      z.object({
        productId: z.string(),
        quantity: z.number().positive(),
        unitPrice: z.number().nonnegative(),
        serialNumber: z.string().optional(),
        productVariantId: z.string().optional(),
        // Capítulo 4.5 — Farmácia/Drogaria (SNGPC/SNCR, Portaria 344/1998, RDC
        // 1.000/2025): obrigatório quando o produto do item exige retenção de
        // receita (`Product.requiresPrescriptionRetention`); validado de fato em
        // close-sale.service.ts, nunca apenas aqui.
        prescriptionData: z
          .object({
            prescriptionType: z.enum(["NOTIFICACAO_B_AZUL", "RECEITA_A_AMARELA", "RECEITA_ELETRONICA_SNCR"]),
            patientDocument: z.string().min(11),
            electronicPrescriptionNumber: z.string().optional(),
            retainedDocumentStorageKey: z.string().optional(),
          })
          .optional(),
        // Capítulo 11.2 — Ótica: obrigatório quando o item vendido é uma lente de
        // grau (`Product.opticsCategory = LENS`); validado de fato em
        // close-sale.service.ts, que também confere que a receita pertence ao
        // mesmo cliente e tenant desta venda.
        opticalPrescriptionId: z.string().optional(),
      }),
    )
    .min(1),
  paymentMethod: z.enum(["CASH", "DEBIT_CARD", "CREDIT_CARD", "PIX", "BOLETO", "STORE_CREDIT", "HEALTH_INSURANCE"]).optional(),
  amountTendered: z.number().nonnegative().optional(),
  // Pagamento Dividido/Split (Capítulo 9) — alternativa a `paymentMethod` para
  // vendas pagas com 2+ métodos (ex.: metade PIX, metade cartão). Validação
  // definitiva de soma/combinação proibida (STORE_CREDIT/HEALTH_INSURANCE nunca
  // divididos) acontece em close-sale.service.ts, dentro da transação — aqui só a
  // forma do payload.
  payments: z
    .array(
      z.object({
        method: z.enum(["CASH", "DEBIT_CARD", "CREDIT_CARD", "PIX", "BOLETO", "STORE_CREDIT", "HEALTH_INSURANCE"]),
        amount: z.number().positive(),
        amountTendered: z.number().nonnegative().optional(),
      }),
    )
    .min(2)
    .optional(),
  closedAtClientTimestamp: z.string().datetime().optional(),
}).refine((data) => Boolean(data.paymentMethod) !== Boolean(data.payments), {
  // Informe exatamente um dos dois formatos — nunca ambos, nunca nenhum.
  message: "Informe paymentMethod (método único) OU payments (dividido) — nunca os dois nem nenhum.",
  path: ["paymentMethod"],
}).refine((data) => {
  const methods = data.payments ? data.payments.map((p) => p.method) : data.paymentMethod ? [data.paymentMethod] : [];
  return !methods.includes("STORE_CREDIT") || Boolean(data.clientId);
}, {
  // Capítulo 4.6 — Varejo Geral (Crediário/Fiado): sem clientId não há de quem
  // debitar o saldo de crediário — a venda STORE_CREDIT não pode ser anônima.
  message: "Venda a prazo (STORE_CREDIT) exige clientId.",
  path: ["clientId"],
}).refine((data) => {
  const methods = data.payments ? data.payments.map((p) => p.method) : data.paymentMethod ? [data.paymentMethod] : [];
  return !methods.includes("HEALTH_INSURANCE") || Boolean(data.clientId);
}, {
  // Capítulo 11.2 — Ótica: sem clientId não há convênio para identificar — a venda
  // HEALTH_INSURANCE não pode ser anônima.
  message: "Venda por convênio (HEALTH_INSURANCE) exige clientId.",
  path: ["clientId"],
});

salesRouter.post("/sales", requireAuth, async (req: Request, res: Response) => {
  if (!(await hasPermission(req.session!.role, req.session!.userId, "pdv:sale:create"))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite registrar vendas." } });
  }
  // Header Idempotency-Key obrigatório (Capítulo 9.5) — redundante de propósito com
  // o idempotencyKey do corpo: o Service Worker envia os dois, e a rota exige que
  // sejam idênticos para rejeitar cedo um payload corrompido em trânsito.
  const headerKey = req.header("Idempotency-Key");
  const parsed = closeSaleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      data: null,
      error: { code: "VALIDATION_ERROR", message: "Payload de venda inválido.", details: parsed.error.flatten() },
    });
  }
  const input = parsed.data;
  if (!headerKey || headerKey !== input.idempotencyKey) {
    return res.status(400).json({
      success: false,
      data: null,
      error: { code: "IDEMPOTENCY_KEY_MISMATCH", message: "Header Idempotency-Key ausente ou divergente do corpo." },
    });
  }

  const { tenantId, userId } = req.session!;

  // Nunca confia no clientId cru do body: valida aqui que o cliente pertence a este
  // tenant ANTES de abrir a transação de fechamento — evita vazamento cross-tenant
  // via accrueLoyaltyPoints (Capítulo 4.1.1).
  if (input.clientId) {
    const client = await prisma.client.findFirst({ where: { id: input.clientId, tenantId }, select: { id: true } });
    if (!client) {
      return res.status(404).json({ success: false, data: null, error: { code: "CLIENT_NOT_FOUND", message: "Cliente não encontrado neste tenant." } });
    }
  }

  try {
    const result = await closeSaleAndEmitFiscalDocument(prisma, {
      tenantId,
      idempotencyKey: input.idempotencyKey,
      cashRegisterId: input.cashRegisterId,
      cashierId: userId,
      clientId: input.clientId,
      items: input.items,
      paymentMethod: input.paymentMethod,
      amountTendered: input.amountTendered,
      payments: input.payments,
    });

    return res.status(result.isReplay ? 200 : 201).json({
      success: true,
      data: result.isReplay
        ? {
            saleId: result.sale.id,
            status: result.sale.status,
            totalAmount: result.sale.totalAmount,
            fiscalDocumentStatus: null,
            note: "Venda já processada anteriormente — retornando resultado idempotente.",
          }
        : {
            saleId: result.sale.id,
            status: result.sale.status,
            totalAmount: result.sale.totalAmount,
            changeDue: result.changeDue,
            fiscalDocumentStatus: result.fiscalDocument.status,
          },
      error: null,
    });
  } catch (err) {
    const resolved = resolveSaleCloseError(err);
    if (!resolved) throw err;
    // Qualquer erro de negócio recuperável (estoque, série, variação, convênio,
    // crédito etc.) durante o fechamento é persistido aqui, upsertando pela mesma
    // idempotencyKey do payload — cobre tanto a tentativa original quanto os
    // retries automáticos do Background Sync, sem duplicar o registro. Dá
    // visibilidade central (qualquer gestor, qualquer terminal) a vendas do PDV
    // offline que nunca vão conseguir ser sincronizadas sem intervenção manual.
    await prisma.failedOfflineSaleSync
      .upsert({
        where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: input.idempotencyKey } },
        create: {
          tenantId,
          idempotencyKey: input.idempotencyKey,
          cashRegisterId: input.cashRegisterId,
          cashierId: userId,
          payload: input as unknown as Prisma.InputJsonValue,
          errorCode: resolved.code,
          errorMessage: resolved.message,
        },
        update: { errorCode: resolved.code, errorMessage: resolved.message },
      })
      .catch((logError) => {
        // Nunca deixa a persistência do log de reconciliação derrubar a resposta
        // de erro original ao cliente.
        log.error({ tenantId, err: logError }, "falha ao registrar FailedOfflineSaleSync");
      });
    return res.status(resolved.status).json({ success: false, data: null, error: { code: resolved.code, message: resolved.message } });
  }
});

function resolveSaleCloseError(err: unknown): { status: number; code: string; message: string } | null {
  if (err instanceof InsufficientStockError) return { status: 409, code: "INSUFFICIENT_STOCK", message: err.message };
  if (err instanceof CashRegisterNotFoundError) return { status: 404, code: "CASH_REGISTER_NOT_FOUND", message: err.message };
  if (err instanceof SerialNotFoundError) return { status: 404, code: "SERIAL_NOT_FOUND", message: err.message };
  if (err instanceof SerialNotReadyForSaleError) return { status: 409, code: "SERIAL_NOT_READY", message: err.message };
  if (err instanceof VariantRequiredError) return { status: 400, code: "VARIANT_REQUIRED", message: err.message };
  if (err instanceof VariantNotFoundError) return { status: 404, code: "VARIANT_NOT_FOUND", message: err.message };
  if (err instanceof InsufficientVariantStockError) return { status: 409, code: "INSUFFICIENT_VARIANT_STOCK", message: err.message };
  if (err instanceof PrescriptionRequiredError) return { status: 400, code: "PRESCRIPTION_REQUIRED", message: err.message };
  if (err instanceof ClientRequiredForStoreCreditError) return { status: 400, code: "CLIENT_REQUIRED_FOR_STORE_CREDIT", message: err.message };
  if (err instanceof CreditLimitExceededError) return { status: 409, code: "CREDIT_LIMIT_EXCEEDED", message: err.message };
  if (err instanceof HealthInsurancePlanRequiredError) return { status: 400, code: "HEALTH_INSURANCE_PLAN_REQUIRED", message: err.message };
  if (err instanceof OpticalPrescriptionRequiredError) return { status: 400, code: "OPTICAL_PRESCRIPTION_REQUIRED", message: err.message };
  if (err instanceof ConsignmentSupplierRequiredError) return { status: 400, code: "CONSIGNMENT_SUPPLIER_REQUIRED", message: err.message };
  if (err instanceof KitCompositionMissingError) return { status: 400, code: "KIT_COMPOSITION_MISSING", message: err.message };
  if (err instanceof SplitPaymentValidationError) return { status: 400, code: "SPLIT_PAYMENT_VALIDATION_ERROR", message: err.message };
  if (err instanceof PriceMismatchError) return { status: 409, code: "PRICE_MISMATCH", message: err.message };
  return null;
}

// GAP DE AUDITORIA ENCONTRADO E CORRIGIDO (rodada 3, Capítulo 8.3): lista/resolve
// os registros de FailedOfflineSaleSync criados acima — fecha o gap de o gestor não
// ter nenhuma visibilidade central das vendas offline que falharam em sincronizar
// em qualquer terminal do tenant.
salesRouter.get("/sales/failed-offline-syncs", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "pdv:sale:create"))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite ver vendas offline pendentes de reconciliação." } });
  }
  const onlyUnresolved = req.query.status !== "all";
  const records = await prisma.failedOfflineSaleSync.findMany({
    where: { tenantId, ...(onlyUnresolved ? { resolvedAt: null } : {}) },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return res.json({ success: true, data: records, error: null });
});

const resolveFailedSyncSchema = z.object({ resolutionNote: z.string().min(3) });

salesRouter.patch("/sales/failed-offline-syncs/:id/resolve", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "pdv:sale:create"))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite resolver vendas offline pendentes de reconciliação." } });
  }
  const parsed = resolveFailedSyncSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const existing = await prisma.failedOfflineSaleSync.findFirst({ where: { id: req.params.id, tenantId } });
  if (!existing) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Registro não encontrado." } });
  }
  const updated = await prisma.failedOfflineSaleSync.update({
    where: { id: existing.id },
    data: { resolvedAt: new Date(), resolvedByUserId: userId, resolutionNote: parsed.data.resolutionNote },
  });
  return res.json({ success: true, data: updated, error: null });
});

// GAP DE AUDITORIA ENCONTRADO E CORRIGIDO: refundSale (Capítulo 6.8 — dupla
// autorização por PIN de gerente contra fraude interna de estorno) existia desde o
// início como serviço, mas nunca foi exposto por nenhuma rota REST.
const refundSaleSchema = z.object({
  reason: z.string().min(3),
  managerUserId: z.string(),
  managerPin: z.string().min(4).max(6),
});

salesRouter.post("/sales/:id/refund", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId } = req.session!;
  const parsed = refundSaleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  try {
    const refunded = await refundSale(prisma, {
      tenantId,
      saleId: req.params.id,
      requestedByUserId: userId,
      reason: parsed.data.reason,
      managerUserId: parsed.data.managerUserId,
      managerPin: parsed.data.managerPin,
    });
    return res.json({ success: true, data: refunded, error: null });
  } catch (err) {
    if (err instanceof RateLimitExceededError) {
      return res.status(429).json({ success: false, data: null, error: { code: "TOO_MANY_PIN_ATTEMPTS", message: err.message } });
    }
    if (err instanceof RefundReasonRequiredError) {
      return res.status(400).json({ success: false, data: null, error: { code: "REFUND_REASON_REQUIRED", message: err.message } });
    }
    if (err instanceof RefundRequiresManagerRoleError) {
      return res.status(403).json({ success: false, data: null, error: { code: "REFUND_REQUIRES_MANAGER_ROLE", message: err.message } });
    }
    if (err instanceof RefundCannotSelfAuthorizeError) {
      return res.status(403).json({ success: false, data: null, error: { code: "REFUND_CANNOT_SELF_AUTHORIZE", message: err.message } });
    }
    if (err instanceof OnlyPaidSalesCanBeRefundedError) {
      return res.status(409).json({ success: false, data: null, error: { code: "ONLY_PAID_SALES_CAN_BE_REFUNDED", message: err.message } });
    }
    if (err instanceof ManagerPinNotConfiguredError) {
      return res.status(409).json({ success: false, data: null, error: { code: "MANAGER_PIN_NOT_CONFIGURED", message: err.message } });
    }
    if (err instanceof InvalidManagerPinError) {
      return res.status(401).json({ success: false, data: null, error: { code: "INVALID_MANAGER_PIN", message: err.message } });
    }
    if (err instanceof CancellationJustificationTooShortError) {
      return res.status(400).json({ success: false, data: null, error: { code: "CANCELLATION_JUSTIFICATION_TOO_SHORT", message: err.message } });
    }
    if (err instanceof OnlyAuthorizedDocumentsCanBeCancelledError) {
      return res.status(409).json({ success: false, data: null, error: { code: "ONLY_AUTHORIZED_DOCUMENTS_CAN_BE_CANCELLED", message: err.message } });
    }
    if (err instanceof CancellationNotApplicableToDocumentTypeError) {
      return res.status(422).json({ success: false, data: null, error: { code: "CANCELLATION_NOT_APPLICABLE", message: err.message } });
    }
    if (err instanceof CancellationDeadlineExpiredError) {
      return res.status(409).json({ success: false, data: null, error: { code: "CANCELLATION_DEADLINE_EXPIRED", message: err.message } });
    }
    throw err;
  }
});

// GAP DE AUDITORIA ENCONTRADO E CORRIGIDO: nenhuma rota GET de venda jamais
// existiu — nem o estorno (`/sales/:id/refund` acima) nem a troca de item
// (Capítulo 11.4, `product-exchanges.routes.ts` desta rodada) tinham como o caixa
// localizar a venda original e seus itens na UI; o front-end nunca tinha um
// contrato para isso. Só devolve o essencial (sem dados de pagamento sensíveis),
// reaproveitando a mesma permissão de quem já pode operar o PDV.
salesRouter.get("/sales/:id", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "pdv:sale:create"))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite consultar vendas." } });
  }
  const sale = await prisma.sale.findFirst({
    where: { id: req.params.id, tenantId },
    select: {
      id: true,
      status: true,
      createdAt: true,
      clientId: true,
      totalAmount: true,
      paymentMethod: true,
      client: { select: { id: true, name: true } },
      items: {
        select: {
          id: true,
          productId: true,
          product: { select: { name: true } },
          productVariantId: true,
          productVariant: { select: { axisValue: true, axis: { select: { name: true } } } },
          quantity: true,
          unitPrice: true,
          totalPrice: true,
        },
      },
      // CORREÇÃO DE AUDITORIA (Rodada 7 — gap do cupom térmico): sem este bloco o
      // front-end jamais conseguia saber se a NFC-e já foi autorizada pela SEFAZ
      // (fila `fiscal-emission`, agora com worker real) para então oferecer a
      // reimpressão do cupom fiscal de verdade (com QR Code/chave reais), em vez do
      // "cupom não fiscal" impresso no balcão antes do sync (Capítulo 21.7/21.19).
      fiscalDocuments: {
        select: {
          id: true,
          type: true,
          status: true,
          accessKey: true,
          focusNfeNumero: true,
          focusNfeSerie: true,
          qrCodeUrl: true,
          totalTaxesApprox: true,
          rejectionReason: true,
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!sale) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Venda não encontrada." } });
  }
  return res.json({ success: true, data: sale, error: null });
});

// GAP DE AUDITORIA ENCONTRADO E CORRIGIDO (Rodada 7): nenhuma rota de LISTAGEM de
// vendas jamais existiu — sem ela, não havia como o front-end montar o histórico de
// vendas do caixa logado e oferecer a reimpressão do cupom fiscal depois que o sync
// offline-first (Capítulo 8.3) e a emissão real via Focus NFe (Capítulo 20.3)
// terminam, muitas vezes segundos após a impressão do cupom não fiscal no balcão.
// Paginação simples por cursor de data (nunca OFFSET, que degrada com volume alto de
// vendas em lojas de giro rápido como mercado/conveniência).
salesRouter.get("/sales", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "pdv:sale:create"))) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message: "Seu nível de acesso não permite consultar vendas." } });
  }
  const limitParam = Number(req.query.limit);
  const limit = Number.isFinite(limitParam) && limitParam > 0 && limitParam <= 100 ? limitParam : 25;
  const before = typeof req.query.before === "string" ? new Date(req.query.before) : null;

  const sales = await prisma.sale.findMany({
    where: {
      tenantId,
      cashierId: userId,
      ...(before && !Number.isNaN(before.getTime()) ? { createdAt: { lt: before } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      status: true,
      createdAt: true,
      totalAmount: true,
      paymentMethod: true,
      client: { select: { id: true, name: true } },
      fiscalDocuments: {
        select: { id: true, type: true, status: true, accessKey: true, qrCodeUrl: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
  return res.json({ success: true, data: sales, error: null });
});

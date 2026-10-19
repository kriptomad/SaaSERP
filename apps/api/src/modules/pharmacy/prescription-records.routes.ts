// apps/api/src/modules/pharmacy/prescription-records.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 4.5 — Farmácia/Drogaria. GAP DE AUDITORIA
// ENCONTRADO: `Product.requiresPrescriptionRetention` e o model `PrescriptionRecord`
// (Portaria 344/1998 — Lista B/Notificação de Receita Azul; RDC 1.000/2025 — SNCR)
// já existiam no schema, mas NENHUMA rota REST os expunha — a trava regulatória
// "venda de produto com retenção obrigatória exige PrescriptionRecord" não existia
// em lugar nenhum do sistema.
//
// Campos mínimos exigidos pela regulação (confirmados por pesquisa — RDC 1.000/2025 e
// cartilha ANVISA/SNCR): CPF do paciente (`patientDocument`), classificação do
// receituário (`prescriptionType`), numeração única da receita eletrônica quando
// houver (`electronicPrescriptionNumber` — obrigatória para emissão via SNCR),
// referência do documento retido/digitalizado (`retainedDocumentStorageKey`) e o
// usuário (farmacêutico/atendente) que validou a dispensação (`validatedByUserId`) —
// todos já modelados em `PrescriptionRecord` e usados tal como estão aqui.
//
// Decisão de schema real: `PrescriptionRecord.saleItemId` é FK obrigatória e @unique
// para `SaleItem` — ou seja, um registro de retenção só pode existir referenciando um
// item de venda JÁ CRIADO. Por isso a rota POST abaixo serve tanto o fluxo "retenção
// registrada no ato da venda" (chamado internamente por close-sale.service.ts, ver
// nota lá) quanto a correção/auditoria manual de uma venda já fechada.
import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";
import { requireModule } from "../../middlewares/gatekeeper.middleware";
import { isTenantStorageKey } from "../../lib/storage-key";

export const prescriptionRecordsRouter = Router();

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

const PRESCRIPTION_TYPES = ["NOTIFICACAO_B_AZUL", "RECEITA_A_AMARELA", "RECEITA_ELETRONICA_SNCR"] as const;

const createSchema = z.object({
  saleItemId: z.string().min(1),
  prescriptionType: z.enum(PRESCRIPTION_TYPES),
  patientDocument: z.string().min(11, "CPF do paciente é obrigatório (exigência regulatória SNGPC/RDC 1.000/2025)."),
  electronicPrescriptionNumber: z.string().min(1).optional(),
  retainedDocumentStorageKey: z.string().min(1).optional(),
});

// POST /prescription-records — registra a retenção de receita de um item de venda
// já existente (Lista B / tarja preta / psicotrópicos — Portaria 344/1998, RDC 1.000/2025).
prescriptionRecordsRouter.post("/prescription-records", requireAuth, requireModule("PHARMACY_SNGPC"), async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "pharmacy:prescription-record:write"))) {
    return forbidden(res, "Seu nível de acesso não permite registrar retenção de receita.");
  }
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error.flatten());
  const input = parsed.data;

  const saleItem = await prisma.saleItem.findFirst({
    where: { id: input.saleItemId, tenantId },
    include: { product: { select: { id: true, name: true, requiresPrescriptionRetention: true } }, prescriptionRecord: true },
  });
  if (!saleItem) return notFound(res, "Item de venda não encontrado neste tenant.");
  if (!saleItem.product) return notFound(res, "Produto do item de venda não encontrado.");
  if (saleItem.prescriptionRecord) {
    return res.status(409).json({
      success: false,
      data: null,
      error: { code: "PRESCRIPTION_ALREADY_RECORDED", message: "Este item de venda já possui uma receita retida registrada." },
    });
  }
  // CORREÇÃO DE AUDITORIA: a rota aceitava registrar retenção de receita para
  // QUALQUER item de venda, mesmo de produto sem exigência regulatória de
  // retenção (`Product.requiresPrescriptionRetention=false`) — permitindo criar
  // um `PrescriptionRecord` sem lastro, o que polui o livro SNGPC/relatórios de
  // compliance com dados irrelevantes. Só produtos que realmente exigem retenção
  // (Lista B/tarja preta/psicotrópicos) podem gerar este registro.
  if (!saleItem.product.requiresPrescriptionRetention) {
    return res.status(409).json({
      success: false,
      data: null,
      error: {
        code: "RETENTION_NOT_REQUIRED",
        message: `O produto "${saleItem.product.name}" não exige retenção de receita (requiresPrescriptionRetention=false).`,
      },
    });
  }
  // CORREÇÃO DE AUDITORIA: `retainedDocumentStorageKey` chegava do client sem
  // nenhuma validação de pertencimento ao tenant — um tenant malicioso poderia
  // gravar a chave de objeto de OUTRO tenant no R2 e, mais tarde, um relatório
  // que gere URL assinada de leitura a partir deste registro acabaria expondo o
  // arquivo do tenant alheio. Mesma trava usada em todo o resto do sistema para
  // ponteiros de storage recebidos do cliente.
  if (input.retainedDocumentStorageKey && !isTenantStorageKey(input.retainedDocumentStorageKey, tenantId)) {
    return validationError(res, { retainedDocumentStorageKey: ["Chave de armazenamento inválida para este tenant."] });
  }

  const record = await prisma.prescriptionRecord.create({
    data: {
      tenantId,
      saleItemId: input.saleItemId,
      prescriptionType: input.prescriptionType,
      patientDocument: input.patientDocument,
      electronicPrescriptionNumber: input.electronicPrescriptionNumber ?? null,
      retainedDocumentStorageKey: input.retainedDocumentStorageKey ?? null,
      validatedByUserId: userId,
    },
  });
  return res.status(201).json({ success: true, data: record, error: null });
});

// GET /prescription-records?clientId=&productId= — histórico de receitas retidas,
// usado para auditoria SNGPC (a escrituração eletrônica em si é feita pelo sistema da
// ANVISA; este endpoint serve a conferência interna do estabelecimento).
const listQuerySchema = z.object({
  clientId: z.string().optional(),
  productId: z.string().optional(),
});

prescriptionRecordsRouter.get("/prescription-records", requireAuth, requireModule("PHARMACY_SNGPC"), async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "pharmacy:prescription-record:read"))) {
    return forbidden(res, "Seu nível de acesso não permite consultar o histórico de receitas retidas.");
  }
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) return validationError(res, parsed.error.flatten());
  const { clientId, productId } = parsed.data;

  // CORREÇÃO DE AUDITORIA: os dois spreads abaixo usavam a MESMA chave de nível
  // superior ("saleItem"); quando ambos os filtros eram informados juntos, o
  // segundo spread (clientId) sobrescrevia silenciosamente o primeiro
  // (productId) — ou seja, o filtro de produto era descartado sempre que
  // clientId também estava presente na query. Mesclado em um único objeto
  // `saleItem` para que os dois filtros coexistam corretamente.
  const records = await prisma.prescriptionRecord.findMany({
    where: {
      tenantId,
      ...(productId || clientId
        ? {
            saleItem: {
              ...(productId ? { productId } : {}),
              ...(clientId ? { sale: { clientId } } : {}),
            },
          }
        : {}),
    },
    include: {
      saleItem: {
        select: {
          id: true,
          saleId: true,
          quantity: true,
          product: { select: { id: true, name: true, sku: true } },
          sale: { select: { id: true, createdAt: true, clientId: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  // `validatedByUserId` é um escalar sem relação declarada no schema — resolve-se o
  // nome em lote aqui, nunca via include (evitaria uma relação Prisma inexistente).
  const validatorIds = Array.from(new Set(records.map((r) => r.validatedByUserId)));
  const validators = validatorIds.length
    ? await prisma.user.findMany({ where: { id: { in: validatorIds } }, select: { id: true, name: true } })
    : [];
  const validatorNameById = new Map(validators.map((u) => [u.id, u.name]));
  const data = records.map((r) => ({ ...r, validatedByUserName: validatorNameById.get(r.validatedByUserId) ?? null }));
  return res.json({ success: true, data, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// GET /pharmacy/expiring-batches?daysAhead=30 — relatório gerencial de validade a
// vencer (ProductBatch.expirationDate), ordenado por urgência. Reaproveita apenas a
// leitura do model de lote já usado pela baixa FEFO (Capítulo 6) — não altera a
// lógica de dedução de estoque.
// ─────────────────────────────────────────────────────────────────────────
const expiringQuerySchema = z.object({
  daysAhead: z.coerce.number().int().positive().max(365).optional(),
});

prescriptionRecordsRouter.get("/pharmacy/expiring-batches", requireAuth, requireModule("PHARMACY_SNGPC"), async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "pharmacy:expiring-batches:read"))) {
    return forbidden(res, "Seu nível de acesso não permite consultar o relatório de validade a vencer.");
  }
  const parsed = expiringQuerySchema.safeParse(req.query);
  if (!parsed.success) return validationError(res, parsed.error.flatten());
  const daysAhead = parsed.data.daysAhead ?? 30;

  const now = new Date();
  const horizon = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

  const batches = await prisma.productBatch.findMany({
    where: {
      tenantId,
      quantity: { gt: 0 },
      expirationDate: { lte: horizon },
    },
    include: { product: { select: { id: true, name: true, sku: true, requiresPrescriptionRetention: true, isControlledSubstance: true } } },
    orderBy: { expirationDate: "asc" },
    take: 500,
  });

  const data = batches.map((batch) => {
    const daysUntilExpiration = Math.ceil((batch.expirationDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
    const urgency = daysUntilExpiration < 0 ? "EXPIRED" : daysUntilExpiration <= 7 ? "CRITICAL" : daysUntilExpiration <= 15 ? "HIGH" : "MEDIUM";
    return {
      id: batch.id,
      productId: batch.productId,
      productName: batch.product.name,
      productSku: batch.product.sku,
      requiresPrescriptionRetention: batch.product.requiresPrescriptionRetention,
      isControlledSubstance: batch.product.isControlledSubstance,
      batchNumber: batch.batchNumber,
      quantity: batch.quantity,
      expirationDate: batch.expirationDate,
      daysUntilExpiration,
      urgency,
    };
  });

  return res.json({ success: true, data, error: null });
});

// ─────────────────────────────────────────────────────────────────────────
// GET /pharmacy/sngpc-ledger?month=YYYY-MM&productId= — Livro de Escrituração de
// substâncias controladas (SNGPC — RDC 1.000/2025). GAP DE AUDITORIA FECHADO:
// `Product.isControlledSubstance` só era usado como um rótulo visual (filtro/chip)
// — não existia NENHUM lugar no sistema onde o farmacêutico responsável pudesse
// extrair o livro de movimentação (entradas via compra, saídas via dispensação)
// exigido para a prestação de contas periódica à ANVISA via Portal SNGPC (upload
// próprio da ANVISA; este endpoint gera os dados-fonte reais para esse upload —
// a transmissão ao órgão em si é um processo externo ao ERP, fora do nosso domínio).
//
// Reconstituído 100% a partir de `StockMovement` (nunca duplicando estado): entradas
// = StockMovement.type IN (PURCHASE_IN/RETURN/ADJUSTMENT positivo) com referenceId
// apontando para PurchaseOrder; saídas = StockMovement.type SALE_OUT/LOSS/ADJUSTMENT
// negativo, com referenceId apontando para Sale.idempotencyKey — join feito em
// memória (poucas centenas de linhas por mês mesmo em farmácia de grande porte,
// nunca justificaria uma tabela de cache redundante sujeita a dessincronizar).
const sngpcLedgerQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Informe o mês no formato YYYY-MM."),
  productId: z.string().optional(),
});

prescriptionRecordsRouter.get("/pharmacy/sngpc-ledger", requireAuth, requireModule("PHARMACY_SNGPC"), async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "pharmacy:sngpc-ledger:read"))) {
    return forbidden(res, "Seu nível de acesso não permite consultar o livro de escrituração SNGPC.");
  }
  const parsed = sngpcLedgerQuerySchema.safeParse(req.query);
  if (!parsed.success) return validationError(res, parsed.error.flatten());
  const { month, productId } = parsed.data;

  const [year, monthNum] = month.split("-").map(Number);
  const periodStart = new Date(Date.UTC(year, monthNum - 1, 1, 0, 0, 0));
  const periodEnd = new Date(Date.UTC(year, monthNum, 1, 0, 0, 0));

  const controlledProducts = await prisma.product.findMany({
    where: { tenantId, isControlledSubstance: true, ...(productId ? { id: productId } : {}) },
    select: { id: true, name: true, sku: true, ncm: true },
  });
  if (controlledProducts.length === 0) {
    return res.json({ success: true, data: { month, summary: [], movements: [] }, error: null });
  }
  const controlledProductIds = controlledProducts.map((p) => p.id);
  const productById = new Map(controlledProducts.map((p) => [p.id, p]));

  // Saldo anterior ao período: soma de TODAS as movimentações anteriores ao início
  // do mês consultado — garante que o "saldo anterior" do livro sempre bate com o
  // saldo real de estoque, mesmo que o tenant nunca tenha gerado este livro antes.
  const priorMovements = await prisma.stockMovement.groupBy({
    by: ["productId"],
    where: { tenantId, productId: { in: controlledProductIds }, createdAt: { lt: periodStart } },
    _sum: { quantity: true },
  });
  const priorBalanceByProduct = new Map(priorMovements.map((m) => [m.productId, Number(m._sum.quantity ?? 0)]));

  const movements = await prisma.stockMovement.findMany({
    where: { tenantId, productId: { in: controlledProductIds }, createdAt: { gte: periodStart, lt: periodEnd } },
    orderBy: { createdAt: "asc" },
    // CORREÇÃO DE AUDITORIA: relatório mensal sem nenhum teto — um tenant com
    // altíssimo volume de controlados (ou produto mal cadastrado gerando
    // movimentações em excesso) poderia estourar a resposta. Já é escopado por
    // produto controlado + mês único; o teto abaixo é só a última camada de
    // defesa (mesmo padrão usado em outras rotas de relatório do sistema).
    take: 10000,
  });

  // Referências cruzadas para o documento de origem de cada linha do livro — exigido
  // pela escrituração (não basta "saiu X unidades", precisa apontar a nota/receita
  // de origem): vendas (saída/dispensação, com a receita retida vinculada) e pedidos
  // de compra (entrada).
  const saleIdempotencyKeys = movements
    .filter((m) => m.type === "SALE_OUT" && m.referenceId)
    .map((m) => m.referenceId as string);
  const purchaseOrderIds = movements.filter((m) => m.type === "PURCHASE_IN" && m.referenceId).map((m) => m.referenceId as string);

  const [sales, purchaseOrders] = await Promise.all([
    saleIdempotencyKeys.length
      ? prisma.sale.findMany({
          where: { tenantId, idempotencyKey: { in: saleIdempotencyKeys } },
          select: {
            idempotencyKey: true,
            id: true,
            createdAt: true,
            items: {
              select: {
                productId: true,
                prescriptionRecord: {
                  select: { prescriptionType: true, patientDocument: true, electronicPrescriptionNumber: true },
                },
              },
            },
          },
        })
      : Promise.resolve([]),
    purchaseOrderIds.length
      ? prisma.purchaseOrder.findMany({
          where: { tenantId, id: { in: purchaseOrderIds } },
          select: { id: true, orderNumber: true, supplier: { select: { name: true } }, createdAt: true },
        })
      : Promise.resolve([]),
  ]);
  const saleByIdempotencyKey = new Map(sales.map((s) => [s.idempotencyKey, s]));
  const purchaseOrderById = new Map(purchaseOrders.map((po) => [po.id, po]));

  const runningBalance = new Map(priorBalanceByProduct);
  const ledgerRows = movements.map((movement) => {
    const quantity = Number(movement.quantity);
    const previous = runningBalance.get(movement.productId) ?? 0;
    const next = previous + quantity;
    runningBalance.set(movement.productId, next);

    let documentReference: string | null = null;
    let patientDocument: string | null = null;
    if (movement.type === "SALE_OUT" && movement.referenceId) {
      const sale = saleByIdempotencyKey.get(movement.referenceId);
      const saleItem = sale?.items.find((item) => item.productId === movement.productId);
      documentReference = sale ? `Venda ${sale.id}` : null;
      patientDocument = saleItem?.prescriptionRecord?.patientDocument ?? null;
    } else if (movement.type === "PURCHASE_IN" && movement.referenceId) {
      const po = purchaseOrderById.get(movement.referenceId);
      documentReference = po ? `Pedido de Compra #${po.orderNumber} — ${po.supplier.name}` : null;
    }

    const product = productById.get(movement.productId)!;
    return {
      id: movement.id,
      productId: movement.productId,
      productName: product.name,
      productSku: product.sku,
      productNcm: product.ncm,
      movementType: movement.type,
      quantity,
      balanceAfter: next,
      documentReference,
      patientDocument,
      createdAt: movement.createdAt,
    };
  });

  const summary = controlledProducts.map((product) => {
    const rows = ledgerRows.filter((r) => r.productId === product.id);
    const entradas = rows.filter((r) => r.quantity > 0).reduce((sum, r) => sum + r.quantity, 0);
    const saidas = rows.filter((r) => r.quantity < 0).reduce((sum, r) => sum + Math.abs(r.quantity), 0);
    return {
      productId: product.id,
      productName: product.name,
      productSku: product.sku,
      saldoAnterior: priorBalanceByProduct.get(product.id) ?? 0,
      entradas,
      saidas,
      saldoAtual: runningBalance.get(product.id) ?? priorBalanceByProduct.get(product.id) ?? 0,
    };
  });

  return res.json({ success: true, data: { month, summary, movements: ledgerRows }, error: null });
});

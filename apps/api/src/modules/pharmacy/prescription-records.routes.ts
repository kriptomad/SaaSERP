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
import { prismaUnscoped as prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";

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
prescriptionRecordsRouter.post("/prescription-records", requireAuth, async (req: Request, res: Response) => {
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
  if (saleItem.prescriptionRecord) {
    return res.status(409).json({
      success: false,
      data: null,
      error: { code: "PRESCRIPTION_ALREADY_RECORDED", message: "Este item de venda já possui uma receita retida registrada." },
    });
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

prescriptionRecordsRouter.get("/prescription-records", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  if (!(await hasPermission(role, userId, "pharmacy:prescription-record:read"))) {
    return forbidden(res, "Seu nível de acesso não permite consultar o histórico de receitas retidas.");
  }
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) return validationError(res, parsed.error.flatten());
  const { clientId, productId } = parsed.data;

  const records = await prisma.prescriptionRecord.findMany({
    where: {
      tenantId,
      ...(productId ? { saleItem: { productId } } : {}),
      ...(clientId ? { saleItem: { sale: { clientId } } } : {}),
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

prescriptionRecordsRouter.get("/pharmacy/expiring-batches", requireAuth, async (req: Request, res: Response) => {
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

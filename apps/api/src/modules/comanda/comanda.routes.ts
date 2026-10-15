// apps/api/src/modules/comanda/comanda.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, seção "Comanda Eletrônica" (Lanchonete/
// Restaurante, Salão de Beleza) — `RestaurantTable`, `Comanda`, `ComandaItem`.
// GAP DE AUDITORIA ENCONTRADO: os três models existiam no schema, mas nenhuma
// rota REST jamais existiu.
// GAP DE SCHEMA ENCONTRADO E CORRIGIDO: `SaleItem.productId` era obrigatório,
// o que tornava impossível fechar uma Comanda contendo itens de SERVIÇO
// (ex.: corte de cabelo em salão, cera em lava-rápido — `ComandaItem.serviceId`)
// como uma Sale real — `productId` passou a ser opcional e `serviceId` foi
// adicionado a `SaleItem` (ver Capítulo 5, model SaleItem).
// Reaproveita "pdv:comanda:read"/"pdv:comanda:write" (novo, seedado nesta
// correção) por estar no mesmo domínio operacional de caixa/PDV.
// CORREÇÃO DE AUDITORIA (Capítulo 21.8): o fechamento de uma Comanda com itens
// mistos (produto + serviço) gerava apenas UM FiscalDocument NFC-e cobrindo os
// itens de produto; itens de serviço nunca tinham ISS calculado nem NFS-e
// emitida — ver `calculateIss` (tax-engine.service.ts) e a emissão real via
// Focus NFe em `emit-fiscal-document.service.ts`. Fechado: cada item de
// serviço agora gera um FiscalDocument NFSE próprio (enfileirado no mesmo
// job BullMQ `fiscal-emission` da NFC-e), parelho ao produto.
import { Router, Request, Response } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";
import { requireAnyModule } from "../../middlewares/gatekeeper.middleware";
import { calculateTax, calculateIss } from "../fiscal/tax-engine.service";
import { resolveTaxReformPhase } from "../fiscal/tax-reform-phase.service";
import { consumeRecipeForComandaItem, MissingIngredientStockError } from "../../services/production/consume-recipe-for-comanda-item.service";
import { enqueueFiscalEmission } from "../fiscal/queues/fiscal-emission.queue";

export const comandaRouter = Router();

// GAP DE AUDITORIA FECHADO (Capítulo 2.6/11.1): "Comanda Eletrônica" é a tela
// operacional central do módulo pago IFOOD_INTEGRATION (Lanchonete/Restaurante),
// e é reaproveitada por SALON_BOOKING (Salão de Beleza) e CAR_WASH_QUEUE
// (Lava-Rápido) para atendimento por comanda de serviço. Antes desta correção,
// nenhuma rota de comanda exigia `requireModule`/`requireAnyModule` — qualquer
// tenant, mesmo sem nenhum desses 3 módulos contratados, conseguia abrir mesas e
// lançar comandas, e quem pagava pelo módulo não tinha nenhum gate garantindo a
// entrega real da funcionalidade.
comandaRouter.use(requireAuth, requireAnyModule(["IFOOD_INTEGRATION", "SALON_BOOKING", "CAR_WASH_QUEUE"]));


async function hasPermission(role: string, userId: string, permissionCode: string): Promise<boolean> {
  const [defaultGrant, override] = await Promise.all([
    prisma.roleDefaultPermission.findUnique({ where: { role_permissionCode: { role: role as any, permissionCode } } }),
    prisma.rolePermission.findUnique({ where: { userId_permission: { userId, permission: permissionCode } } }),
  ]);
  return override ? override.granted : Boolean(defaultGrant);
}

function forbid(res: Response, message: string) {
  return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message } });
}

// ───────────────────────── RestaurantTable ─────────────────────────

const tableSchema = z.object({ label: z.string().min(1), seatCount: z.number().int().positive(), active: z.boolean().optional() });

comandaRouter.get("/restaurant-tables", requireAuth, async (req: Request, res: Response) => {
  const { userId, role, tenantId } = req.session!;
  if (!(await hasPermission(role, userId, "pdv:comanda:read"))) return forbid(res, "Seu nível de acesso não permite consultar as mesas.");
  const tables = await prisma.restaurantTable.findMany({ where: { tenantId }, orderBy: { label: "asc" } });
  return res.json({ success: true, data: tables, error: null });
});

comandaRouter.post("/restaurant-tables", requireAuth, async (req: Request, res: Response) => {
  const { userId, role, tenantId } = req.session!;
  if (!(await hasPermission(role, userId, "pdv:comanda:write"))) return forbid(res, "Seu nível de acesso não permite cadastrar mesas.");
  const parsed = tableSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  const table = await prisma.restaurantTable.create({ data: { tenantId, ...parsed.data } });
  return res.status(201).json({ success: true, data: table, error: null });
});

// ───────────────────────── Comanda ─────────────────────────

comandaRouter.get("/comandas", requireAuth, async (req: Request, res: Response) => {
  const { userId, role, tenantId } = req.session!;
  if (!(await hasPermission(role, userId, "pdv:comanda:read"))) return forbid(res, "Seu nível de acesso não permite consultar comandas.");
  const status = req.query.status as string | undefined;
  const comandas = await prisma.comanda.findMany({
    where: { tenantId, ...(status ? { status: status as any } : {}) },
    include: { table: true, client: { select: { id: true, name: true } }, items: true },
    orderBy: { openedAt: "desc" },
  });
  return res.json({ success: true, data: comandas, error: null });
});

comandaRouter.get("/comandas/:id", requireAuth, async (req: Request, res: Response) => {
  const { userId, role, tenantId } = req.session!;
  if (!(await hasPermission(role, userId, "pdv:comanda:read"))) return forbid(res, "Seu nível de acesso não permite consultar comandas.");
  const comanda = await prisma.comanda.findFirst({
    where: { id: req.params.id, tenantId },
    include: { table: true, client: true, items: { include: { product: { select: { id: true, name: true } }, service: { select: { id: true, name: true } } } } },
  });
  if (!comanda) return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Comanda não encontrada." } });
  return res.json({ success: true, data: comanda, error: null });
});

const openComandaSchema = z.object({ tableId: z.string().optional(), clientId: z.string().optional() });

comandaRouter.post("/comandas", requireAuth, async (req: Request, res: Response) => {
  const { userId, role, tenantId } = req.session!;
  if (!(await hasPermission(role, userId, "pdv:comanda:write"))) return forbid(res, "Seu nível de acesso não permite abrir comandas.");
  const parsed = openComandaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  const comanda = await prisma.comanda.create({ data: { tenantId, tableId: parsed.data.tableId, clientId: parsed.data.clientId } });
  return res.status(201).json({ success: true, data: comanda, error: null });
});

const addItemSchema = z
  .object({
    productId: z.string().optional(),
    serviceId: z.string().optional(),
    // Capítulo 11.6 — profissional que executa o serviço; exigido quando serviceId
    // está presente (necessário para apurar comissão no fechamento), sempre
    // ausente/ignorado para itens de produto.
    professionalId: z.string().optional(),
    quantity: z.number().positive(),
    unitPrice: z.number().positive(),
  })
  .refine((v) => (v.productId ? 1 : 0) + (v.serviceId ? 1 : 0) === 1, { message: "Informe exatamente um entre productId e serviceId." })
  .refine((v) => !v.serviceId || Boolean(v.professionalId), { message: "professionalId é obrigatório para itens de serviço (apuração de comissão no fechamento)." });

comandaRouter.post("/comandas/:id/items", requireAuth, async (req: Request, res: Response) => {
  const { userId, role, tenantId } = req.session!;
  if (!(await hasPermission(role, userId, "pdv:comanda:write"))) return forbid(res, "Seu nível de acesso não permite lançar itens em comandas.");
  const parsed = addItemSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  const comanda = await prisma.comanda.findFirst({ where: { id: req.params.id, tenantId } });
  if (!comanda) return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Comanda não encontrada." } });
  if (comanda.status !== "OPEN") return res.status(409).json({ success: false, data: null, error: { code: "INVALID_STATUS", message: "Só é possível lançar itens em uma comanda aberta." } });
  if (parsed.data.professionalId) {
    const professional = await prisma.user.findFirst({ where: { id: parsed.data.professionalId, tenantId } });
    if (!professional) return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: "professionalId não pertence a este tenant." } });
  }
  const item = await prisma.comandaItem.create({
    data: {
      tenantId,
      comandaId: comanda.id,
      productId: parsed.data.productId,
      serviceId: parsed.data.serviceId,
      professionalId: parsed.data.professionalId,
      quantity: parsed.data.quantity,
      unitPrice: parsed.data.unitPrice,
    },
  });

  // Capítulo 11.1 — baixa de insumos da Ficha Técnica disparada no LANÇAMENTO do
  // item na comanda (não no fechamento): "o insumo é consumido na produção do
  // prato". Falha de estoque de insumo não deve impedir o lançamento do item em
  // si (o prato já está sendo preparado/entregue ao cliente) — fica registrado
  // como aviso para o operador resolver o estoque depois, nunca um rollback do
  // pedido já feito ao cliente.
  let recipeWarning: string | null = null;
  if (parsed.data.productId) {
    try {
      await consumeRecipeForComandaItem(prisma, { tenantId, comandaItemId: item.id });
    } catch (err) {
      if (err instanceof MissingIngredientStockError) {
        recipeWarning = err.message;
      } else {
        throw err;
      }
    }
  }

  return res.status(201).json({ success: true, data: item, error: null, warning: recipeWarning });
});

// Envia um item ao KDS (Kitchen Display System) via SSE (Capítulo 8.3) — este
// endpoint apenas marca `sentToKdsAt`; o broadcast real pelo canal SSE do tenant
// é disparado pelo mesmo hub central de eventos (fora do escopo deste módulo).
comandaRouter.patch("/comandas/:comandaId/items/:itemId/send-to-kds", requireAuth, async (req: Request, res: Response) => {
  const { userId, role, tenantId } = req.session!;
  if (!(await hasPermission(role, userId, "pdv:comanda:write"))) return forbid(res, "Seu nível de acesso não permite enviar itens à cozinha.");
  const item = await prisma.comandaItem.findFirst({ where: { id: req.params.itemId, comandaId: req.params.comandaId, tenantId } });
  if (!item) return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Item de comanda não encontrado." } });
  const updated = await prisma.comandaItem.update({ where: { id: item.id }, data: { sentToKdsAt: new Date() } });
  return res.json({ success: true, data: updated, error: null });
});

comandaRouter.delete("/comandas/:comandaId/items/:itemId", requireAuth, async (req: Request, res: Response) => {
  const { userId, role, tenantId } = req.session!;
  if (!(await hasPermission(role, userId, "pdv:comanda:write"))) return forbid(res, "Seu nível de acesso não permite remover itens de comandas.");
  const comanda = await prisma.comanda.findFirst({ where: { id: req.params.comandaId, tenantId } });
  if (!comanda) return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Comanda não encontrada." } });
  if (comanda.status !== "OPEN") return res.status(409).json({ success: false, data: null, error: { code: "INVALID_STATUS", message: "Só é possível remover itens de uma comanda aberta." } });
  await prisma.comandaItem.deleteMany({ where: { id: req.params.itemId, comandaId: comanda.id, tenantId } });
  return res.status(204).send();
});

comandaRouter.patch("/comandas/:id/cancel", requireAuth, async (req: Request, res: Response) => {
  const { userId, role, tenantId } = req.session!;
  if (!(await hasPermission(role, userId, "pdv:comanda:write"))) return forbid(res, "Seu nível de acesso não permite cancelar comandas.");
  const comanda = await prisma.comanda.findFirst({ where: { id: req.params.id, tenantId } });
  if (!comanda) return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Comanda não encontrada." } });
  if (comanda.status !== "OPEN") return res.status(409).json({ success: false, data: null, error: { code: "INVALID_STATUS", message: "Só é possível cancelar uma comanda aberta." } });
  const updated = await prisma.comanda.update({ where: { id: comanda.id }, data: { status: "CANCELLED", closedAt: new Date() } });
  return res.json({ success: true, data: updated, error: null });
});

const closeComandaSchema = z.object({
  cashRegisterId: z.string().min(1),
  paymentMethod: z.enum(["CASH", "DEBIT_CARD", "CREDIT_CARD", "PIX", "BOLETO", "STORE_CREDIT"]),
});

// Fecha a comanda transformando-a em uma Sale real (Capítulo 6.6), espelhando a
// transação atômica de `closeSale`, mas com suporte a itens de serviço (que
// closeSale, voltado 100% a produto/estoque, não contempla). Produtos com
// trackingType BATCH/SERIAL não são suportados neste fluxo simplificado de
// comanda — apenas baixa direta de Product.stockQuantity (adequado ao perfil
// real de restaurante/salão: insumos NONE, nunca lote/série) — limitação
// documentada explicitamente, não um mock.
comandaRouter.post("/comandas/:id/close", requireAuth, async (req: Request, res: Response) => {
  const { userId, role, tenantId } = req.session!;
  if (!(await hasPermission(role, userId, "pdv:comanda:write"))) return forbid(res, "Seu nível de acesso não permite fechar comandas.");
  const parsed = closeComandaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const comanda = await tx.comanda.findFirst({ where: { id: req.params.id, tenantId }, include: { items: true } });
        if (!comanda) throw new Error("NOT_FOUND");
        if (comanda.status !== "OPEN") throw new Error("INVALID_STATUS");
        if (comanda.items.length === 0) throw new Error("COMANDA_EMPTY");

        const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { taxRegime: true, uf: true } });
        let totalAmount = new Prisma.Decimal(0);
        let legacyIcmsTotal = new Prisma.Decimal(0);
        let legacyPisCofinsTotal = new Prisma.Decimal(0);
        let ibsTotal = new Prisma.Decimal(0);
        let cbsTotal = new Prisma.Decimal(0);
        let selectiveTaxTotal = new Prisma.Decimal(0);
        let issTotal = new Prisma.Decimal(0);
        // Conservador por design: um único FiscalDocument NFSE agrega todos os
        // itens de serviço da comanda (mesmo padrão de agregação da NFC-e acima);
        // se QUALQUER serviço envolvido exigir retenção na fonte pelo tomador,
        // marcamos o documento inteiro como retido — nunca o contrário (declarar
        // "sem retenção" quando ao menos um item realmente exige retenção seria
        // uma omissão fiscal real, não apenas uma simplificação de UI).
        let issRetidoNaFonte = false;
        let hasProductItem = false;
        let hasServiceItem = false;
        const saleItemsData: Prisma.SaleItemCreateManySaleInput[] = [];
        // Capítulo 11.6 — comissão por serviço: calculada aqui (fechamento+pagamento
        // da comanda), nunca no lançamento do item nem no agendamento. Guardamos o
        // par (item, serviço com commissionPercentage) para criar o
        // ServiceCommissionEntry somente DEPOIS que a Sale existir (precisa de saleId).
        const commissionCandidates: { comandaItemId: string; professionalId: string; serviceId: string; baseAmount: Prisma.Decimal }[] = [];
        // Capítulo 11.1 — canal da venda: DINE_IN quando a comanda está vinculada a
        // uma mesa (restaurante), COUNTER caso contrário (balcão/salão sem mesa).
        const channel: "DINE_IN" | "COUNTER" = comanda.tableId ? "DINE_IN" : "COUNTER";

        for (const item of comanda.items) {
          const lineGross = item.unitPrice.times(item.quantity);
          totalAmount = totalAmount.plus(lineGross);

          if (item.productId) {
            hasProductItem = true;
            const product = await tx.product.findFirstOrThrow({ where: { id: item.productId, tenantId } });
            // Baixa simplificada (NONE/VARIANT) — perfil real do nicho de comanda.
            await tx.product.update({ where: { id: product.id }, data: { stockQuantity: { decrement: item.quantity } } });
            await tx.stockMovement.create({
              data: { tenantId, productId: product.id, type: "SALE_OUT", quantity: item.quantity.negated(), referenceId: comanda.id },
            });
            const taxResult = await calculateTax(tx, {
              tenantId,
              ncm: product.ncm ?? "00000000",
              uf: product.originUf ?? "SP",
              nicheCode: product.nicheCode ?? "RESTAURANT",
              grossAmount: lineGross,
            });
            legacyIcmsTotal = legacyIcmsTotal.plus(taxResult.legacyIcmsAmount);
            legacyPisCofinsTotal = legacyPisCofinsTotal.plus(taxResult.legacyPisCofinsAmount);
            ibsTotal = ibsTotal.plus(taxResult.ibsAmount);
            cbsTotal = cbsTotal.plus(taxResult.cbsAmount);
            selectiveTaxTotal = selectiveTaxTotal.plus(taxResult.selectiveTaxAmount);
          }

          if (item.serviceId) {
            hasServiceItem = true;
            const service = await tx.service.findFirstOrThrow({ where: { id: item.serviceId, tenantId } });
            // `nbs: null` cai direto para a regra genérica do nicho — `Service` não
            // cadastra NBS individual (mesmo padrão de `ncm: null` acima para
            // produto sem NCM específico); o cadastro fino por NBS fica disponível
            // via TaxRule (Cadastros > Regras Fiscais) quando o lojista precisar.
            const issResult = await calculateIss(tx, {
              tenantId,
              nbs: null,
              uf: tenant.uf ?? "SP",
              nicheCode: service.nicheTag,
              grossAmount: lineGross,
            });
            issTotal = issTotal.plus(issResult.issAmount);
            issRetidoNaFonte = issRetidoNaFonte || issResult.issRetidoNaFonte;
          }

          saleItemsData.push({
            tenantId,
            productId: item.productId ?? undefined,
            serviceId: item.serviceId ?? undefined,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: lineGross,
          });

          if (item.serviceId && item.professionalId) {
            commissionCandidates.push({ comandaItemId: item.id, professionalId: item.professionalId, serviceId: item.serviceId, baseAmount: lineGross });
          }
        }

        const sale = await tx.sale.create({
          data: {
            tenantId,
            cashierId: userId,
            cashRegisterId: parsed.data.cashRegisterId,
            idempotencyKey: `comanda:${comanda.id}`,
            paymentMethod: parsed.data.paymentMethod,
            status: "PAID",
            channel,
            totalAmount,
            items: { createMany: { data: saleItemsData } },
          },
        });

        await tx.payment.create({
          data: { tenantId, saleId: sale.id, method: parsed.data.paymentMethod, status: "CONFIRMED", amount: totalAmount, changeDue: new Prisma.Decimal(0), idempotencyKey: `comanda:${comanda.id}:payment` },
        });

        // Capítulo 11.6 — a comissão só é MATERIALIZADA agora, com a Sale paga já
        // existindo: liberar antes disso permitiria comissionar atendimento não pago.
        // `commissionPercentage` é lido de Service e gravado como snapshot imutável.
        for (const candidate of commissionCandidates) {
          const service = await tx.service.findFirstOrThrow({ where: { id: candidate.serviceId, tenantId } });
          const commissionPercentage = service.commissionPercentage;
          const commissionAmount = candidate.baseAmount.times(commissionPercentage).dividedBy(100);
          await tx.serviceCommissionEntry.create({
            data: {
              tenantId,
              saleId: sale.id,
              comandaItemId: candidate.comandaItemId,
              professionalId: candidate.professionalId,
              serviceId: candidate.serviceId,
              baseAmount: candidate.baseAmount,
              commissionPercentage,
              commissionAmount,
            },
          });
        }

        // NFS-e dos itens de serviço fica pendente de emissão manual (ver
        // comentário de topo do arquivo) — só criamos FiscalDocument(NFCE)
        // quando a comanda tem ao menos um item de produto.
        let fiscalDocument = null;
        if (hasProductItem) {
          fiscalDocument = await tx.fiscalDocument.create({
            data: {
              tenantId,
              type: "NFCE",
              status: "PENDING",
              saleId: sale.id,
              legacyIcmsAmount: legacyIcmsTotal,
              legacyPisCofinsAmount: legacyPisCofinsTotal,
              ibsAmount: ibsTotal,
              cbsAmount: cbsTotal,
              selectiveTaxAmount: selectiveTaxTotal,
              totalTaxesApprox: legacyIcmsTotal.plus(legacyPisCofinsTotal).plus(ibsTotal).plus(cbsTotal).plus(selectiveTaxTotal),
              taxRegimeSnapshot: tenant.taxRegime,
              faseReformaTributaria: resolveTaxReformPhase(new Date()),
            },
          });
        }

        // CORREÇÃO DE AUDITORIA (Capítulo 21.8) — NFSE própria para os itens de
        // serviço da comanda (mão de obra de salão/lava-rápido/restaurante),
        // paralela à NFCE acima (que cobre só mercadoria). Emitida pelo mesmo
        // worker `fiscal-emission` via Focus NFe (ver emit-fiscal-document.service.ts).
        let serviceFiscalDocument = null;
        if (hasServiceItem) {
          serviceFiscalDocument = await tx.fiscalDocument.create({
            data: {
              tenantId,
              type: "NFSE",
              status: "PENDING",
              saleId: sale.id,
              issAmount: issTotal,
              issRetidoNaFonte,
              totalTaxesApprox: issTotal,
              taxRegimeSnapshot: tenant.taxRegime,
              faseReformaTributaria: resolveTaxReformPhase(new Date()),
            },
          });
        }

        const closedComanda = await tx.comanda.update({ where: { id: comanda.id }, data: { status: "CLOSED", closedAt: new Date(), saleId: sale.id } });

        return { comanda: closedComanda, sale, fiscalDocument, serviceFiscalDocument };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    // Fora da transação (commit já confirmado) — mesmo princípio de
    // close-sale.service.ts/closeSaleAndEmitFiscalDocument: nunca emitir de forma
    // síncrona dentro da transação de banco, para não segurar o lock de estoque
    // esperando resposta de rede externa (SEFAZ/Focus NFe).
    if (result.fiscalDocument) {
      await enqueueFiscalEmission({ fiscalDocumentId: result.fiscalDocument.id, tenantId });
    }
    if (result.serviceFiscalDocument) {
      await enqueueFiscalEmission({ fiscalDocumentId: result.serviceFiscalDocument.id, tenantId });
    }
    return res.json({ success: true, data: result, error: null });
  } catch (err: any) {
    const code = err?.message ?? "CLOSE_FAILED";
    const status = code === "NOT_FOUND" ? 404 : 409;
    return res.status(status).json({ success: false, data: null, error: { code, message: code } });
  }
});

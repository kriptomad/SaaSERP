// apps/api/src/modules/catalog/label-printers.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 8.5 — CRUD de impressoras de etiqueta
// (LabelPrinterConfig) + rota de impressão real de etiqueta de produto.
import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";
import { generateProductLabelZpl, sendZplToNetworkPrinter } from "./zpl-label.service";
import { createModuleLogger } from "../../lib/logger";

export const labelPrintersRouter = Router();
const log = createModuleLogger("label-printers");

labelPrintersRouter.get("/label-printers", requireAuth, async (req: Request, res: Response) => {
  const { tenantId } = req.session!;
  const printers = await prisma.labelPrinterConfig.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } });
  return res.json({ success: true, data: printers, error: null });
});

const printerSchema = z.object({
  name: z.string().min(1),
  connectionType: z.enum(["NETWORK", "USB", "BLUETOOTH"]),
  networkHost: z.string().min(1).nullable().optional(),
  networkPort: z.number().int().positive().nullable().optional(),
  labelWidthMm: z.number().int().positive().default(40),
  labelHeightMm: z.number().int().positive().default(25),
  isDefault: z.boolean().default(false),
});

labelPrintersRouter.post("/label-printers", requireAuth, async (req: Request, res: Response) => {
  const parsed = printerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  if (parsed.data.connectionType === "NETWORK" && !parsed.data.networkHost) {
    return res.status(400).json({ success: false, data: null, error: { code: "NETWORK_HOST_REQUIRED", message: "Informe o host/IP da impressora de rede." } });
  }
  const { tenantId } = req.session!;

  if (parsed.data.isDefault) {
    await prisma.labelPrinterConfig.updateMany({ where: { tenantId, isDefault: true }, data: { isDefault: false } });
  }

  const printer = await prisma.labelPrinterConfig.create({ data: { tenantId, ...parsed.data } });
  return res.status(201).json({ success: true, data: printer, error: null });
});

labelPrintersRouter.patch("/label-printers/:id", requireAuth, async (req: Request, res: Response) => {
  const parsed = printerSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const { tenantId } = req.session!;
  const existing = await prisma.labelPrinterConfig.findFirst({ where: { id: req.params.id, tenantId } });
  if (!existing) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Impressora não encontrada." } });
  }
  if (parsed.data.isDefault) {
    await prisma.labelPrinterConfig.updateMany({ where: { tenantId, isDefault: true }, data: { isDefault: false } });
  }
  const updated = await prisma.labelPrinterConfig.update({ where: { id: existing.id }, data: parsed.data });
  return res.json({ success: true, data: updated, error: null });
});

labelPrintersRouter.delete("/label-printers/:id", requireAuth, async (req: Request, res: Response) => {
  const { tenantId } = req.session!;
  const existing = await prisma.labelPrinterConfig.findFirst({ where: { id: req.params.id, tenantId } });
  if (!existing) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Impressora não encontrada." } });
  }
  await prisma.labelPrinterConfig.delete({ where: { id: existing.id } });
  return res.json({ success: true, data: { id: existing.id }, error: null });
});

const printLabelSchema = z.object({
  productId: z.string().uuid(),
  printerId: z.string().uuid().optional(),
  copies: z.number().int().positive().max(999).default(1),
});

labelPrintersRouter.post("/labels/print", requireAuth, async (req: Request, res: Response) => {
  const parsed = printLabelSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
  }
  const { tenantId } = req.session!;
  const product = await prisma.product.findFirst({ where: { id: parsed.data.productId, tenantId } });
  if (!product) {
    return res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "Produto não encontrado." } });
  }

  const printer = parsed.data.printerId
    ? await prisma.labelPrinterConfig.findFirst({ where: { id: parsed.data.printerId, tenantId } })
    : await prisma.labelPrinterConfig.findFirst({ where: { tenantId, isDefault: true } });

  const widthMm = printer?.labelWidthMm ?? 40;
  const heightMm = printer?.labelHeightMm ?? 25;
  const zpl = generateProductLabelZpl(
    { name: product.name, barcode: product.barcode, unitPrice: Number(product.unitPrice) },
    widthMm,
    heightMm,
    parsed.data.copies,
  );

  if (!printer) {
    // Sem impressora configurada (ou nenhuma default): devolve o .zpl para download
    // manual — nunca bloqueia o lojista por falta de config.
    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Content-Disposition", `attachment; filename="etiqueta-${product.sku}.zpl"`);
    return res.send(zpl);
  }

  if (printer.connectionType !== "NETWORK" || !printer.networkHost) {
    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Content-Disposition", `attachment; filename="etiqueta-${product.sku}.zpl"`);
    return res.send(zpl);
  }

  try {
    await sendZplToNetworkPrinter(printer.networkHost, printer.networkPort ?? 9100, zpl);
    return res.json({ success: true, data: { printed: true, printerName: printer.name }, error: null });
  } catch (error) {
    log.error({ tenantId, printerId: printer.id, err: error }, "falha ao imprimir etiqueta na impressora de rede");
    return res.status(502).json({
      success: false,
      data: null,
      error: { code: "PRINTER_UNREACHABLE", message: `Não foi possível conectar à impressora "${printer.name}". Verifique se está ligada e na rede.` },
    });
  }
});

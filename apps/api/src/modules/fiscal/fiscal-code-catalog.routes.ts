// apps/api/src/modules/fiscal/fiscal-code-catalog.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 21.16 — rotas do painel do dono (Capítulo 13)
// para upload manual do catálogo NCM/NBS/CEST e consulta de códigos vigentes (usada
// pela tela de cadastro de TaxRule para validar o código antes de salvar).
// Restrito a SUPER_ADMIN: o catálogo fiscal é global de plataforma e qualquer importação
// errada afeta o cálculo de imposto de TODOS os tenants simultaneamente.
import { Router, Request, Response } from "express";
import { z } from "zod";
import { prismaUnscoped as prisma } from "@filitech/db";
import { platformAdminAuthMiddleware, requirePlatformAdminAuth, requireSuperAdmin } from "../platform-admin/platform-admin-auth.middleware";
import { importFiscalCodeCatalog, parseFiscalCodeCsv } from "./fiscal-code-catalog.service";

export const fiscalCodeCatalogRouter = Router();

fiscalCodeCatalogRouter.use(platformAdminAuthMiddleware);

const uploadSchema = z.object({
  catalogType: z.enum(["NCM", "NBS", "CEST"]),
  sourceDescription: z.string().min(3),
  fileName: z.string().nullable().default(null),
  csvContent: z.string().min(1),
});

fiscalCodeCatalogRouter.post(
  "/platform-admin/fiscal-code-catalog/import",
  requirePlatformAdminAuth,
  requireSuperAdmin,
  async (req: Request, res: Response) => {
    const parsed = uploadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
    }
    const { catalogType, sourceDescription, fileName, csvContent } = parsed.data;

    const parsedCodes = parseFiscalCodeCsv(csvContent);
    if (parsedCodes.length === 0) {
      return res.status(400).json({ success: false, data: null, error: { code: "EMPTY_CATALOG", message: "Nenhum código válido encontrado no arquivo enviado." } });
    }

    const batch = await importFiscalCodeCatalog(prisma, {
      catalogType,
      sourceDescription,
      fileName,
      importedByPlatformAdminUserId: req.platformAdminSession!.platformAdminUserId,
      parsedCodes,
    });

    return res.status(201).json({
      success: true,
      data: {
        id: batch.id,
        catalogType: batch.catalogType,
        status: batch.status,
        totalCodesProcessed: batch.totalCodesProcessed,
        errorLog: batch.errorLog,
        createdAt: batch.createdAt,
      },
      error: null,
    });
  },
);

fiscalCodeCatalogRouter.get("/platform-admin/fiscal-code-catalog/imports", requirePlatformAdminAuth, async (_req: Request, res: Response) => {
  const imports = await prisma.fiscalCodeCatalogImport.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      catalogType: true,
      sourceDescription: true,
      fileName: true,
      totalCodesProcessed: true,
      status: true,
      errorLog: true,
      createdAt: true,
      importedByPlatformAdminUser: { select: { id: true, name: true, email: true } },
    },
  });
  return res.json({ success: true, data: imports, error: null });
});

const searchCodesSchema = z.object({
  type: z.enum(["NCM", "NBS", "CEST"]),
  code: z.string().min(1).optional(),
});

/**
 * Consulta de códigos vigentes — usada pela tela de cadastro de TaxRule (Capítulo
 * 21.6/21.16) para validar que o ncm/nbs/cest informado existe e está vigente antes
 * de salvar a regra, evitando uma TaxRule "fantasma" que só quebraria no momento real
 * da venda.
 */
fiscalCodeCatalogRouter.get("/platform-admin/fiscal-code-catalog/codes", requirePlatformAdminAuth, async (req: Request, res: Response) => {
  const parsed = searchCodesSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const { type, code } = parsed.data;

  const codes = await prisma.fiscalCode.findMany({
    where: { type, effectiveTo: null, ...(code ? { code: { contains: code } } : {}) },
    orderBy: { code: "asc" },
    take: 200,
  });

  return res.json({ success: true, data: codes, error: null });
});

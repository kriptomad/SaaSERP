// apps/api/src/modules/storage/storage.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 3 — Object Storage Cloudflare R2. Rota
// genérica de presign, tenant-scoped, usada por qualquer tela que precise anexar um
// arquivo real (fotos de O.S./laudo, avatar, comprovantes de client-records). O
// binário NUNCA passa pela API — o navegador faz o upload/download direto na URL
// assinada do R2 (ver apps/api/src/lib/object-storage.ts).
import { Router, Request, Response } from "express";
import { z } from "zod";
import { requireAuth } from "../../middlewares/auth.middleware";
import { presignObjectDownload, presignObjectUpload, STORAGE_CATEGORIES } from "../../lib/object-storage";

export const storageRouter = Router();

const categoryEnum = z.enum(Object.keys(STORAGE_CATEGORIES) as [keyof typeof STORAGE_CATEGORIES, ...Array<keyof typeof STORAGE_CATEGORIES>]);

const presignUploadSchema = z.object({
  category: categoryEnum,
  fileName: z.string().min(1).max(200),
  mimeType: z.string().min(1).max(120),
  fileSizeBytes: z.number().int().positive(),
});

storageRouter.post("/storage/presign-upload", requireAuth, async (req: Request, res: Response) => {
  const { tenantId } = req.session!;
  const parsed = presignUploadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: "Dados inválidos.", details: parsed.error.flatten() } });
  }

  try {
    const result = await presignObjectUpload({ tenantId, ...parsed.data });
    return res.status(201).json({ success: true, data: result, error: null });
  } catch (error) {
    return res.status(422).json({ success: false, data: null, error: { code: "PRESIGN_FAILED", message: (error as Error).message } });
  }
});

const presignDownloadSchema = z.object({ storageKey: z.string().min(1) });

storageRouter.post("/storage/presign-download", requireAuth, async (req: Request, res: Response) => {
  const { tenantId } = req.session!;
  const parsed = presignDownloadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: "Dados inválidos.", details: parsed.error.flatten() } });
  }

  try {
    const result = await presignObjectDownload(tenantId, parsed.data.storageKey);
    return res.json({ success: true, data: result, error: null });
  } catch (error) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN_STORAGE_KEY", message: (error as Error).message } });
  }
});

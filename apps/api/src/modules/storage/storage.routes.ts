// apps/api/src/modules/storage/storage.routes.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 3 — Object Storage Cloudflare R2. Rota
// genérica de presign, tenant-scoped, usada por qualquer tela que precise anexar um
// arquivo real (fotos de O.S./laudo, avatar, comprovantes de client-records). O
// binário NUNCA passa pela API — o navegador faz o upload/download direto na URL
// assinada do R2 (ver apps/api/src/lib/object-storage.ts).
import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "@filitech/db";
import { requireAuth } from "../../middlewares/auth.middleware";
import {
  presignObjectDownload,
  presignObjectUpload,
  finalizeObjectUpload,
  categoryOfStorageKey,
  STORAGE_CATEGORIES,
  StorageFinalizationError,
} from "../../lib/object-storage";
import { isTenantStorageKey } from "../../lib/storage-key";
import { enforceRateLimit, enforceByteQuota, RateLimitExceededError } from "../../lib/rate-limit";
import { hasPermission } from "../../lib/permission-cache";

export const storageRouter = Router();

const categoryEnum = z.enum(Object.keys(STORAGE_CATEGORIES) as [keyof typeof STORAGE_CATEGORIES, ...Array<keyof typeof STORAGE_CATEGORIES>]);

// fa-w6-up-no-upload-rate-limit — GAP DE AUDITORIA FECHADO: `/storage/presign-upload`
// só tinha `requireAuth` (qualquer usuário autenticado do tenant podia pedir
// presigns sem limite nenhum) — um usuário comprometido (ou um script com a sessão
// roubada) podia gerar milhares de URLs de upload por minuto e/ou subir bytes sem
// teto algum, inflando custo de armazenamento/egress do tenant ou de todo o bucket
// de plataforma. Mesmo padrão atômico de Redis (`enforceRateLimit`/`enforceByteQuota`)
// já usado em login/PIN/webhooks — chaveado por tenant E por usuário para que um
// único usuário comprometido não consuma a cota inteira do tenant silenciosamente
// nem, inversamente, qualquer usuário do tenant consiga burlar a cota geral do
// tenant abrindo sessões em contas diferentes.
const PRESIGN_UPLOAD_MAX_PER_MINUTE_PER_USER = 20;
const PRESIGN_UPLOAD_MAX_PER_MINUTE_PER_TENANT = 120;
const UPLOAD_BYTES_MAX_PER_DAY_PER_TENANT = 2 * 1024 * 1024 * 1024; // 2 GiB/dia — folgado para o uso normal (fotos de O.S., XMLs, anexos de chamado), mas finito.

const presignUploadSchema = z.object({
  category: categoryEnum,
  fileName: z.string().min(1).max(200),
  mimeType: z.string().min(1).max(120),
  fileSizeBytes: z.number().int().positive(),
});

storageRouter.post("/storage/presign-upload", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId } = req.session!;
  const parsed = presignUploadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: "Dados inválidos.", details: parsed.error.flatten() } });
  }

  try {
    await enforceRateLimit(`storage:presign:user:${tenantId}:${userId}`, PRESIGN_UPLOAD_MAX_PER_MINUTE_PER_USER, 60);
    await enforceRateLimit(`storage:presign:tenant:${tenantId}`, PRESIGN_UPLOAD_MAX_PER_MINUTE_PER_TENANT, 60);
    await enforceByteQuota(`storage:bytes:tenant:${tenantId}`, parsed.data.fileSizeBytes, UPLOAD_BYTES_MAX_PER_DAY_PER_TENANT, 24 * 60 * 60);
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      return res.status(429).json({ success: false, data: null, error: { code: "RATE_LIMITED", message: error.message } });
    }
    throw error;
  }

  try {
    const result = await presignObjectUpload({ tenantId, userId, ...parsed.data });
    return res.status(201).json({ success: true, data: result, error: null });
  } catch (error) {
    return res.status(422).json({ success: false, data: null, error: { code: "PRESIGN_FAILED", message: (error as Error).message } });
  }
});

const finalizeUploadSchema = z.object({ storageKey: z.string().min(1) });

// fa-w6-up-no-magic-byte-validation / fa-w6-up-presigned-size-not-reconciled /
// fa-w6-up-missing-object-existence-check — rota de finalização chamada pelo
// frontend (`apps/web/src/shared/storage/upload.ts`) logo depois que o PUT direto
// no R2 responde OK. Confirma via HeadObject que o objeto existe e que o tamanho
// real bate com o declarado no presign, e valida a assinatura binária dos
// primeiros bytes contra o mimetype declarado — só então o `storageKey` pode ser
// aceito por uma rota de domínio (`requireCleanStorageObject`, usado em
// `work-orders.routes.ts`). Chave recebida no BODY (não no path) porque
// `storageKey` contém barras (`tenants/<id>/<categoria>/<arquivo>`), que não
// sobrevivem de forma confiável a um segmento de rota Express sem dupla
// codificação manual.
storageRouter.post("/storage/uploads/finalize", requireAuth, async (req: Request, res: Response) => {
  const { tenantId } = req.session!;
  const parsed = finalizeUploadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: "Dados inválidos.", details: parsed.error.flatten() } });
  }

  try {
    const result = await finalizeObjectUpload(tenantId, parsed.data.storageKey);
    return res.json({ success: true, data: result, error: null });
  } catch (error) {
    if (error instanceof StorageFinalizationError) {
      return res.status(422).json({ success: false, data: null, error: { code: "FINALIZATION_FAILED", message: error.message } });
    }
    throw error;
  }
});

const presignDownloadSchema = z.object({ storageKey: z.string().min(1) });

/**
 * fa-w6-up-download-tenant-wide-not-resource-scoped — GAP DE AUDITORIA FECHADO:
 * antes, qualquer usuário autenticado do tenant conseguia gerar URL de leitura
 * para QUALQUER `storageKey` daquele tenant, bastando conhecer/adivinhar a chave —
 * a única checagem era `isTenantStorageKey` (isolamento ENTRE tenants, nunca
 * dentro do mesmo tenant). Para categorias com um modelo de domínio que já possui
 * seu próprio controle de permissão (hoje: `work-order-photos`, via `OsPhoto` +
 * permissão `work-order:read`), a rota agora resolve o registro dono da chave e
 * exige a permissão daquele recurso especificamente — nunca só a sessão válida do
 * tenant. Demais categorias (`fiscal-xml`, `client-record-photos`,
 * `support-ticket-attachments`, `data-import-source`, `report-exports`,
 * `official-tax-documents`, `data-export`, `data-import-reports`,
 * `database-backups`) ainda não têm uma rota de domínio própria que vincule o
 * `storageKey` a um registro consultável aqui — permanecem no isolamento por
 * tenant (equivalente ao estado anterior) até serem wireadas a um modelo
 * específico; documentado aqui como follow-up pendente, não espalhado
 * silenciosamente pelo código.
 */
async function assertResourceScopedDownloadPermission(
  tenantId: string,
  userId: string,
  role: string,
  storageKey: string,
): Promise<{ allowed: boolean; reason?: string }> {
  const category = categoryOfStorageKey(storageKey);
  if (category === "work-order-photos") {
    const photo = await prisma.osPhoto.findFirst({ where: { tenantId, storageKey } });
    if (!photo) {
      return { allowed: false, reason: "Nenhuma foto de ordem de serviço corresponde a esta chave de armazenamento." };
    }
    const allowed = await hasPermission(tenantId, role, userId, "work-order:read");
    return allowed ? { allowed: true } : { allowed: false, reason: "Seu nível de acesso não permite visualizar fotos de ordens de serviço." };
  }
  // Demais categorias: nenhum modelo de domínio resolvível ainda (ver nota acima) —
  // mantém o isolamento por tenant já garantido por `isTenantStorageKey`/`presignObjectDownload`.
  return { allowed: true };
}

storageRouter.post("/storage/presign-download", requireAuth, async (req: Request, res: Response) => {
  const { tenantId, userId, role } = req.session!;
  const parsed = presignDownloadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, data: null, error: { code: "VALIDATION_ERROR", message: "Dados inválidos.", details: parsed.error.flatten() } });
  }

  if (!isTenantStorageKey(parsed.data.storageKey, tenantId)) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN_STORAGE_KEY", message: "A chave de armazenamento não pertence ao tenant autenticado." } });
  }

  const resourceCheck = await assertResourceScopedDownloadPermission(tenantId, userId, role, parsed.data.storageKey);
  if (!resourceCheck.allowed) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN_RESOURCE", message: resourceCheck.reason ?? "Acesso negado a este recurso." } });
  }

  try {
    const result = await presignObjectDownload(tenantId, parsed.data.storageKey);
    return res.json({ success: true, data: result, error: null });
  } catch (error) {
    return res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN_STORAGE_KEY", message: (error as Error).message } });
  }
});

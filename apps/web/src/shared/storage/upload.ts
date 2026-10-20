// apps/web/src/shared/storage/upload.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 3 — Object Storage Cloudflare R2. Cliente
// genérico de upload direto-do-navegador: pede a URL assinada ao backend
// (POST /storage/presign-upload) e faz o PUT binário direto no R2, sem o arquivo
// passar pela API (evita duplicar tráfego/memória do processo Node).
import { api } from "../../api/client";

export type StorageCategory = "work-order-photos" | "avatars" | "fiscal-xml" | "client-record-photos" | "support-ticket-attachments";

interface PresignUploadResponse {
  uploadUrl: string;
  storageKey: string;
  expiresInSeconds: number;
}

interface FinalizeUploadResponse {
  storageKey: string;
  scanStatus: "CLEAN";
  actualSizeBytes: number;
}

interface PresignDownloadResponse {
  downloadUrl: string;
  expiresInSeconds: number;
}

/**
 * Faz upload real de um `File` do navegador: 1) pede a URL assinada de PUT ao
 * backend, 2) sobe o binário diretamente para o R2, 3) finaliza o upload no
 * backend (`POST /storage/uploads/finalize`), que confirma via HeadObject que o
 * objeto existe com o tamanho esperado e valida a assinatura binária dos
 * primeiros bytes contra o mimetype declarado — fa-w6-up-no-magic-byte-validation
 * / fa-w6-up-missing-object-existence-check. Retorna o `storageKey` persistente
 * para ser salvo no registro de domínio (ex.: `OsPhoto.storageKey`); rotas de
 * domínio (ex.: `POST /work-orders/:id/photos`) exigem que esta finalização já
 * tenha ocorrido com sucesso antes de aceitar o ponteiro.
 */
export async function uploadFileToStorage(file: File, category: StorageCategory): Promise<string> {
  const presign = await api.post<PresignUploadResponse>("/storage/presign-upload", {
    category,
    fileName: file.name,
    mimeType: file.type,
    fileSizeBytes: file.size,
  });

  const putResponse = await fetch(presign.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });

  if (!putResponse.ok) {
    throw new Error(`Falha ao enviar o arquivo para o armazenamento (HTTP ${putResponse.status}). Tente novamente.`);
  }

  await api.post<FinalizeUploadResponse>("/storage/uploads/finalize", { storageKey: presign.storageKey });

  return presign.storageKey;
}

/** Resolve uma URL de leitura (assinada ou pública/CDN) para um `storageKey` já persistido. */
export async function resolveStorageDownloadUrl(storageKey: string): Promise<string> {
  const presign = await api.post<PresignDownloadResponse>("/storage/presign-download", { storageKey });
  return presign.downloadUrl;
}

// apps/web/src/modules/settings/data-portability-api.ts
// Contratos reais de apps/api/src/modules/data-portability/{data-export,data-import}.routes.ts
// (BIBLE_ENGINEERING_V2.md, Capítulo 18.4/18.5).
import { api } from "../../api/client";

export type DataExportStatus = "QUEUED" | "GENERATING" | "COMPLETED" | "FAILED";

export interface TenantDataExportJob {
  id: string;
  tenantId: string;
  requestedByUserId: string;
  status: DataExportStatus;
  resultStorageKey: string | null;
  failureReason: string | null;
  createdAt: string;
  completedAt: string | null;
}

export const dataExportApi = {
  list: () => api.get<TenantDataExportJob[]>("/data-export"),
  create: () => api.post<TenantDataExportJob>("/data-export"),
  download: (id: string) => api.get<{ downloadUrl: string; expiresInSeconds: number }>(`/data-export/${id}/download`),
};

export type DataImportStatus = "UPLOADED" | "VALIDATING" | "VALIDATED_WITH_ERRORS" | "VALIDATED_CLEAN" | "IMPORTING" | "COMPLETED" | "FAILED";

export interface DataImportJob {
  id: string;
  tenantId: string;
  targetEntity: string;
  status: DataImportStatus;
  sourceFileKey: string;
  columnMapping: Record<string, string>;
  totalRows: number;
  processedRows: number;
  errorReportKey: string | null;
  createdByUserId: string;
  createdAt: string;
  completedAt: string | null;
}

export interface DataImportJobDetail extends DataImportJob {
  errorReportDownloadUrl: string | null;
}

export interface PresignUploadResult {
  uploadUrl: string;
  storageKey: string;
  expiresInSeconds: number;
}

export interface SuggestMappingResult {
  headers: string[];
  previewRows: string[][];
  suggestedMapping: Record<string, string>;
}

export const PRODUCT_IMPORT_TARGET_FIELDS = ["name", "barcodeEan13", "costPrice", "unitPrice", "stockQuantity", "categoryName"] as const;

export const dataImportApi = {
  list: () => api.get<DataImportJob[]>("/data-import/jobs"),
  detail: (id: string) => api.get<DataImportJobDetail>(`/data-import/jobs/${id}`),
  presignUpload: (fileName: string, mimeType: string, fileSizeBytes: number) =>
    api.post<PresignUploadResult>("/data-import/presign-upload", { fileName, mimeType, fileSizeBytes }),
  createJob: (sourceFileKey: string) => api.post<DataImportJob>("/data-import/jobs", { targetEntity: "PRODUCT", sourceFileKey }),
  suggestMapping: (id: string) => api.post<SuggestMappingResult>(`/data-import/jobs/${id}/suggest-mapping`),
  updateMapping: (id: string, columnMapping: Record<string, string>) => api.patch<DataImportJob>(`/data-import/jobs/${id}`, { columnMapping }),
  validate: (id: string) => api.post<{ jobId: string; status: string }>(`/data-import/jobs/${id}/validate`),
  confirm: (id: string) => api.post<{ jobId: string; status: string }>(`/data-import/jobs/${id}/confirm`),
};

/** Upload direto-do-navegador (mesmo padrão de shared/storage/upload.ts, mas usando o presign dedicado de `data-import-source`). */
export async function uploadImportSourceFile(file: File): Promise<string> {
  const presign = await dataImportApi.presignUpload(file.name, file.type, file.size);
  const putResponse = await fetch(presign.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!putResponse.ok) {
    throw new Error(`Falha ao enviar o arquivo (HTTP ${putResponse.status}). Tente novamente.`);
  }
  return presign.storageKey;
}

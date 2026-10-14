// apps/web/src/modules/catalog/label-printers-api.ts
// Contratos reais de apps/api/src/modules/catalog/label-printers.routes.ts.
import { api, getStoredToken, resolveApiBaseUrl } from "../../api/client";

export interface LabelPrinterConfig {
  id: string;
  name: string;
  connectionType: "NETWORK" | "USB" | "BLUETOOTH";
  networkHost: string | null;
  networkPort: number | null;
  labelWidthMm: number;
  labelHeightMm: number;
  isDefault: boolean;
  createdAt: string;
}

export interface LabelPrinterInput {
  name: string;
  connectionType: "NETWORK" | "USB" | "BLUETOOTH";
  networkHost?: string | null;
  networkPort?: number | null;
  labelWidthMm: number;
  labelHeightMm: number;
  isDefault: boolean;
}

export const labelPrintersApi = {
  list: () => api.get<LabelPrinterConfig[]>("/label-printers"),
  create: (input: LabelPrinterInput) => api.post<LabelPrinterConfig>("/label-printers", input),
  update: (id: string, input: Partial<LabelPrinterInput>) => api.patch<LabelPrinterConfig>(`/label-printers/${id}`, input),
  remove: (id: string) => api.delete(`/label-printers/${id}`),
};

/**
 * Imprime (ou baixa o .zpl) de um produto. O backend responde com JSON
 * `{success:true}` quando envia direto para uma impressora de rede, ou com o
 * arquivo .zpl para download quando não há impressora de rede configurada —
 * por isso o fetch cru aqui, não `api.post` (que sempre espera JSON).
 */
export async function printProductLabel(productId: string, printerId: string | undefined, copies: number): Promise<{ downloaded: boolean }> {
  const token = getStoredToken();
  const response = await fetch(`${resolveApiBaseUrl()}/labels/print`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ productId, printerId, copies }),
  });
  const contentType = response.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/json")) {
    const body = await response.json();
    if (!response.ok || !body.success) {
      throw new Error(body?.error?.message ?? "Falha ao imprimir etiqueta.");
    }
    return { downloaded: false };
  }
  if (!response.ok) throw new Error("Falha ao gerar etiqueta.");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `etiqueta-${productId}.zpl`;
  link.click();
  URL.revokeObjectURL(url);
  return { downloaded: true };
}

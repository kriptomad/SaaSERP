// apps/web/src/shared/offline/sync-catalog.ts
// Sincroniza o catálogo Dexie contra GET /products (Capítulo 8.3) — sync incremental
// via `updatedSince`, nunca re-baixando o catálogo inteiro a cada reconexão.
import { getStoredToken, resolveApiBaseUrl } from "../../api/client";
import { offlineDb } from "./db";

const API_BASE_URL = resolveApiBaseUrl();

interface RemoteProduct {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  unitPrice: string; // Decimal serializado como string pelo Prisma/JSON
  stockQuantity: string;
  isWeighted: boolean;
  category: string | null;
}

export async function syncProductCatalog(): Promise<{ syncedCount: number }> {
  const token = getStoredToken();
  if (!token) return { syncedCount: 0 };

  const lastSync = await offlineDb.syncState.get("lastSyncedAt");
  const url = new URL(`${API_BASE_URL}/products`);
  if (lastSync) url.searchParams.set("updatedSince", lastSync.value);

  const response = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    throw new Error(`Falha ao sincronizar catálogo (HTTP ${response.status}).`);
  }
  const body = (await response.json()) as { data: RemoteProduct[] };
  const syncedAt = new Date().toISOString();

  await offlineDb.transaction("rw", offlineDb.products, offlineDb.syncState, async () => {
    for (const product of body.data) {
      await offlineDb.products.put({
        id: product.id,
        sku: product.sku,
        barcode: product.barcode,
        name: product.name,
        unitPrice: Number(product.unitPrice),
        stockQuantitySnapshot: Number(product.stockQuantity),
        isWeighted: product.isWeighted,
        category: product.category,
      });
    }
    await offlineDb.syncState.put({ key: "lastSyncedAt", value: syncedAt });
  });

  return { syncedCount: body.data.length };
}

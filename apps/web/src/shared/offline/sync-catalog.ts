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
  requiresPrescriptionRetention: boolean;
  isControlledSubstance: boolean;
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
  const cachedAt = Date.now();

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
        requiresPrescriptionRetention: product.requiresPrescriptionRetention,
        isControlledSubstance: product.isControlledSubstance,
        cachedAt,
      });
    }
    await offlineDb.syncState.put({ key: "lastSyncedAt", value: syncedAt });
  });

  return { syncedCount: body.data.length };
}

// CORREÇÃO DE AUDITORIA (mega-audit rodada 7): acima de 2 horas sem um
// `syncProductCatalog()` bem-sucedido, o preço/estoque local não é mais confiável o
// bastante para o PDV confiar silenciosamente — o backend ainda é a fonte de
// verdade final (close-sale.service.ts valida o preço de novo), mas o caixa precisa
// ser avisado ANTES de fechar a venda, não só depois que ela falhar na sincronização.
export const CATALOG_STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000;

export async function getOldestCachedProductAge(): Promise<number | null> {
  const lastSync = await offlineDb.syncState.get("lastSyncedAt");
  if (!lastSync) return null;
  return Date.now() - new Date(lastSync.value).getTime();
}

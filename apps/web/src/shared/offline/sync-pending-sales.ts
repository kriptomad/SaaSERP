// apps/web/src/shared/offline/sync-pending-sales.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 8.3 — sincroniza a fila `pendingSales` do
// Dexie contra POST /sales assim que há rede. Chamada tanto pelo evento "online" do
// próprio app (fallback para navegadores sem Background Sync API, ex.: Safari/iOS)
// quanto pelo service worker via postMessage quando o evento "sync" dispara.
import { getStoredToken, resolveApiBaseUrl } from "../../api/client";
import { offlineDb, type PendingSale } from "./db";

const API_BASE_URL = resolveApiBaseUrl();
const MAX_SYNC_ATTEMPTS = 10;

export interface SyncResult {
  synced: string[];
  failed: string[];
  stillPending: string[];
}

export async function syncPendingSales(): Promise<SyncResult> {
  const token = getStoredToken();
  const result: SyncResult = { synced: [], failed: [], stillPending: [] };
  if (!token) return result;

  const pending = await offlineDb.pendingSales.where("syncStatus").anyOf("PENDING", "FAILED").toArray();

  for (const sale of pending) {
    await offlineDb.pendingSales.update(sale.localId, { syncStatus: "SYNCING" });
    try {
      const response = await fetch(`${API_BASE_URL}/sales`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "Idempotency-Key": sale.localId,
        },
        body: JSON.stringify(sale.payload),
      });

      if (response.ok) {
        await offlineDb.pendingSales.update(sale.localId, { syncStatus: "SYNCED" });
        result.synced.push(sale.localId);
      } else if (response.status >= 400 && response.status < 500) {
        // Erro de negócio real (ex.: estoque esgotado no servidor, idempotencyKey
        // divergente) — não deve ser retentado indefinidamente; fica para revisão
        // manual do lojista em vez de travar a fila com uma venda que nunca vai passar.
        const body = await response.json().catch(() => null);
        await offlineDb.pendingSales.update(sale.localId, {
          syncStatus: "FAILED",
          lastError: body?.error?.message ?? `HTTP ${response.status}`,
        });
        result.failed.push(sale.localId);
      } else {
        await requeueWithBackoff(sale, `HTTP ${response.status}`);
        result.stillPending.push(sale.localId);
      }
    } catch (error) {
      // Falha de rede durante a própria tentativa de sync: mantém PENDING, incrementa
      // tentativa — o Background Sync (ou o próximo evento "online") tentará de novo.
      await requeueWithBackoff(sale, (error as Error).message);
      result.stillPending.push(sale.localId);
    }
  }

  return result;
}

async function requeueWithBackoff(sale: PendingSale, errorMessage: string) {
  const nextAttempts = sale.syncAttempts + 1;
  await offlineDb.pendingSales.update(sale.localId, {
    syncStatus: nextAttempts >= MAX_SYNC_ATTEMPTS ? "FAILED" : "PENDING",
    syncAttempts: nextAttempts,
    lastError: errorMessage,
  });
}

export async function registerBackgroundSync(): Promise<void> {
  if ("serviceWorker" in navigator && "SyncManager" in window) {
    const registration = await navigator.serviceWorker.ready;
    await (registration as unknown as { sync: { register(tag: string): Promise<void> } }).sync.register("sync-pending-sales");
  } else {
    // Fallback para navegadores sem Background Sync API: sincroniza assim que o
    // próprio app detectar o evento "online", sem depender do service worker.
    window.dispatchEvent(new Event("filitech:force-sync"));
  }
}

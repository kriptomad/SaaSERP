// apps/web/src/shared/offline/sync-pending-sales.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 8.3 — sincroniza a fila `pendingSales` do
// Dexie contra POST /sales assim que há rede. Chamada tanto pelo evento "online" do
// próprio app (fallback para navegadores sem Background Sync API, ex.: Safari/iOS)
// quanto pelo service worker via postMessage quando o evento "sync" dispara.
//
// GAP DE AUDITORIA FECHADO: antes, `syncPendingSales` reprocessava toda venda em
// `FAILED` (erro de negócio definitivo, ex.: estoque esgotado, validação de split
// payment) em TODO disparo de sync subsequente ("online", background sync
// periódico) — como o payload nunca muda, a venda falhava identicamente para
// sempre, silenciosamente, sem o lojista nunca saber que uma venda já cobrada no
// cartão do cliente nunca chegou a ser registrada no backend. Agora `FAILED` só é
// reprocessada por ação EXPLÍCITA do operador via `retryFailedSale`/
// `retryAllFailedSales` (ver tela de reconciliação no PDV), nunca automaticamente.
import { getStoredToken, resolveApiBaseUrl } from "../../api/client";
import { offlineDb, type PendingSale } from "./db";

const API_BASE_URL = resolveApiBaseUrl();
const MAX_SYNC_ATTEMPTS = 10;

// 401: sessão/JWT expirado — o próprio app renova o token no próximo login e a
// venda volta a sincronizar sozinha, sem exigir revisão manual por item.
// 408/425: timeout/"too early" de proxy, não do backend de negócio em si.
// 429: rate-limit (WAF/Cloudflare na frente da API) — transitório por definição.
const TRANSIENT_HTTP_STATUSES = new Set([401, 408, 425, 429]);
function isTransientHttpStatus(status: number): boolean {
  return TRANSIENT_HTTP_STATUSES.has(status);
}

export interface SyncResult {
  synced: string[];
  failed: string[];
  stillPending: string[];
}

export async function syncPendingSales(): Promise<SyncResult> {
  const token = getStoredToken();
  const result: SyncResult = { synced: [], failed: [], stillPending: [] };
  if (!token) return result;

  const pending = (await offlineDb.pendingSales.where("syncStatus").anyOf("PENDING", "SYNCING").toArray()).filter(
    // Respeita o backoff agendado — uma venda que acabou de falhar não é
    // reprocessada de novo neste mesmo disparo de sync, mesmo que o evento
    // "online"/background sync dispare repetidamente em sequência.
    (sale) => !sale.nextAttemptAt || sale.nextAttemptAt <= Date.now(),
  );

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
      } else if (isTransientHttpStatus(response.status)) {
        // GAP DE AUDITORIA FECHADO (mega-audit rodada 10): 401 (sessão/JWT expirado
        // durante um período offline prolongado — comuníssimo em POS que fica
        // desconectado por horas), 408/425/429 (timeout/retry-too-early/rate-limit de
        // proxy/WAF na frente da API) eram classificados junto com os erros de
        // NEGÓCIO (estoque, split payment) como falha PERMANENTE — exigindo que o
        // operador revisasse manualmente cada venda travada na fila mesmo quando o
        // único problema real era reautenticar (o que o próprio app já faz sozinho no
        // próximo login). Agora ficam em backoff, reprocessados automaticamente assim
        // que a causa transitória (token renovado, rate-limit expirado) passar.
        await requeueWithBackoff(sale, `HTTP ${response.status}`);
        result.stillPending.push(sale.localId);
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
  // Backoff exponencial (2s, 4s, 8s... teto de 2min) com jitter de até 25% — evita
  // que várias vendas pendentes retentem todas no MESMO instante exato (efeito
  // manada) quando a rede volta.
  const baseDelayMs = Math.min(2_000 * 2 ** sale.syncAttempts, 120_000);
  const jitterMs = baseDelayMs * 0.25 * Math.random();
  await offlineDb.pendingSales.update(sale.localId, {
    syncStatus: nextAttempts >= MAX_SYNC_ATTEMPTS ? "FAILED" : "PENDING",
    syncAttempts: nextAttempts,
    lastError: errorMessage,
    nextAttemptAt: nextAttempts >= MAX_SYNC_ATTEMPTS ? undefined : Date.now() + baseDelayMs + jitterMs,
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

/**
 * Reconciliação manual (tela de "vendas pendentes com erro" no PDV): o operador
 * revisou o `lastError` de uma venda FAILED, decidiu que vale a pena tentar de novo
 * (ex.: já repôs o item em falta de estoque) e aciona isso explicitamente — nunca
 * automático, para nunca martelar o backend com um payload que vai falhar de novo
 * sem intervenção humana.
 */
export async function retryFailedSale(localId: string): Promise<void> {
  await offlineDb.pendingSales.update(localId, { syncStatus: "PENDING", lastError: undefined });
  await syncPendingSales();
}

export async function retryAllFailedSales(): Promise<void> {
  const failed = await offlineDb.pendingSales.where("syncStatus").equals("FAILED").toArray();
  await offlineDb.pendingSales.bulkUpdate(failed.map((f) => ({ key: f.localId, changes: { syncStatus: "PENDING" as const, lastError: undefined } })));
  await syncPendingSales();
}

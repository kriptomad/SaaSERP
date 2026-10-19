// apps/web/public/service-worker.js
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 8.3 — PDV Offline-First. Service Worker
// real com Background Sync API: quando a rede volta, o navegador dispara o evento
// "sync" com a tag registrada em registerBackgroundSync() (shared/offline/sync-pending-sales.ts).
//
// CORREÇÃO DE AUDITORIA (full-audit, sev. 98/96/95/94): a versão anterior deste
// arquivo NÃO acessava o IndexedDB — ela só repassava (via postMessage) a tarefa de
// sincronizar para uma aba aberta. Se o operador fechasse o PDV logo após uma venda
// offline, a venda ficava indefinidamente presa, pois nenhum código rodava para
// sincronizá-la. Agora o PRÓPRIO service worker lê a fila `pendingSales` e o espelho
// de autenticação `authMirror` diretamente via IndexedDB (raw API — sem bundling de
// Dexie, mas usando exatamente o mesmo banco/object stores que `shared/offline/db.ts`
// cria) e sincroniza de verdade, mesmo com todas as abas fechadas. Quando há uma aba
// aberta, ainda avisamos via postMessage para a UI atualizar na hora.
const CACHE_NAME = "filitech-pos-shell-v2";
const APP_SHELL_URLS = ["/", "/index.html"];
const DB_NAME = "filitech-pos-offline";
const MAX_SYNC_ATTEMPTS = 10;
const TRANSIENT_HTTP_STATUSES = new Set([401, 408, 425, 429]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL_URLS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// CORREÇÃO DE AUDITORIA (full-audit, sev. 82): a heurística anterior ("porta 3333 OU
// prefixo /api/") era frágil em produção — um domínio próprio com proxy reverso ou
// uma API em outro path/porta podia ser servida cache-first indevidamente (dados
// desatualizados) OU o app-shell podia ir à rede sempre (perdendo o offline-first).
// Agora: cache-first SOMENTE para GET same-origin do próprio app-shell (navegação de
// documento, ou assets estáticos conhecidos por extensão). Qualquer outra origem ou
// qualquer requisição que não seja claramente um asset estático do app vai direto à
// rede, nunca ao cache — API sempre passa direto, não importa porta/prefixo.
const STATIC_ASSET_EXTENSIONS = /\.(js|css|svg|png|jpg|jpeg|webp|ico|woff2?|ttf)$/i;

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isNavigation = request.mode === "navigate";
  const isStaticAsset = isSameOrigin && STATIC_ASSET_EXTENSIONS.test(url.pathname);
  if (!isNavigation && !isStaticAsset) return; // nunca cacheia API/dados dinâmicos

  event.respondWith(
    caches.match(request).then((cached) => cached ?? fetch(request)),
  );
});

self.addEventListener("sync", (event) => {
  if (event.tag !== "sync-pending-sales") return;
  event.waitUntil(syncPendingSalesFromServiceWorker());
});

// Garante correr no máximo uma sincronização por vez mesmo que o evento "sync"
// dispare novamente antes da anterior terminar (o navegador pode fazer isso).
let syncInFlight = null;
async function syncPendingSalesFromServiceWorker() {
  if (syncInFlight) return syncInFlight;
  syncInFlight = runSync().finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}

async function runSync() {
  const db = await openOfflineDb();
  if (!db) return;

  const auth = await dbGet(db, "authMirror", "session");
  if (!auth || !auth.token) {
    // Sem sessão espelhada ainda (ex.: primeiro uso antes de qualquer login nesta
    // aba) — não há como autenticar; deixa para o próximo "sync"/fallback de aba.
    await notifyClients();
    return;
  }

  await recoverAbandonedSyncs(db);

  const now = Date.now();
  const all = await dbGetAll(db, "pendingSales");
  const candidates = all.filter(
    (sale) =>
      (sale.syncStatus === "PENDING" || sale.syncStatus === "SYNCING") &&
      (!sale.nextAttemptAt || sale.nextAttemptAt <= now),
  );

  for (const sale of candidates) {
    await dbPut(db, "pendingSales", { ...sale, syncStatus: "SYNCING", syncStartedAt: Date.now() });
    try {
      const response = await fetch(`${auth.apiBaseUrl}/sales`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`,
          "Idempotency-Key": sale.localId,
        },
        body: JSON.stringify(sale.payload),
      });

      if (response.ok) {
        await dbPut(db, "pendingSales", { ...sale, syncStatus: "SYNCED", syncStartedAt: undefined });
      } else if (TRANSIENT_HTTP_STATUSES.has(response.status)) {
        await requeueWithBackoff(db, sale, `HTTP ${response.status}`);
      } else if (response.status >= 400 && response.status < 500) {
        let message = `HTTP ${response.status}`;
        try {
          const body = await response.json();
          message = body?.error?.message ?? message;
        } catch {
          // corpo não-JSON — mantém a mensagem genérica.
        }
        await dbPut(db, "pendingSales", { ...sale, syncStatus: "FAILED", lastError: message, syncStartedAt: undefined });
      } else {
        await requeueWithBackoff(db, sale, `HTTP ${response.status}`);
      }
    } catch (error) {
      await requeueWithBackoff(db, sale, String(error && error.message ? error.message : error));
    }
  }

  await notifyClients();
}

async function recoverAbandonedSyncs(db) {
  const SYNC_LEASE_TIMEOUT_MS = 2 * 60_000;
  const cutoff = Date.now() - SYNC_LEASE_TIMEOUT_MS;
  const all = await dbGetAll(db, "pendingSales");
  for (const sale of all) {
    if (sale.syncStatus === "SYNCING" && (sale.syncStartedAt ?? 0) <= cutoff) {
      await dbPut(db, "pendingSales", { ...sale, syncStatus: "PENDING", syncStartedAt: undefined });
    }
  }
}

async function requeueWithBackoff(db, sale, errorMessage) {
  const nextAttempts = (sale.syncAttempts ?? 0) + 1;
  const baseDelayMs = Math.min(2_000 * 2 ** (sale.syncAttempts ?? 0), 120_000);
  const jitterMs = baseDelayMs * 0.25 * Math.random();
  await dbPut(db, "pendingSales", {
    ...sale,
    syncStatus: nextAttempts >= MAX_SYNC_ATTEMPTS ? "FAILED" : "PENDING",
    syncAttempts: nextAttempts,
    lastError: errorMessage,
    syncStartedAt: undefined,
    nextAttemptAt: nextAttempts >= MAX_SYNC_ATTEMPTS ? undefined : Date.now() + baseDelayMs + jitterMs,
  });
}

// Avisa qualquer aba aberta para atualizar a UI (lista de vendas pendentes, badges
// etc.) — best-effort, a sincronização em si já rodou independente de haver aba.
async function notifyClients() {
  const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of clientsList) {
    client.postMessage({ type: "FILITECH_SYNC_PENDING_SALES" });
  }
}

// --- Helpers mínimos de IndexedDB cru (sem dependências externas no service worker) ---

function openOfflineDb() {
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    // Nunca chamamos onupgradeneeded aqui: o schema é sempre criado/migrado pelo
    // próprio app (Dexie, em shared/offline/db.ts). Se o banco ainda não existir
    // (nenhuma aba abriu o app ainda nesta máquina), apenas seguimos sem sincronizar.
  });
}

function dbGet(db, storeName, key) {
  return new Promise((resolve) => {
    if (!db.objectStoreNames.contains(storeName)) return resolve(undefined);
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(undefined);
  });
}

function dbGetAll(db, storeName) {
  return new Promise((resolve) => {
    if (!db.objectStoreNames.contains(storeName)) return resolve([]);
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => resolve([]);
  });
}

function dbPut(db, storeName, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

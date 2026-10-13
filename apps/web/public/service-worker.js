// apps/web/public/service-worker.js
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 8.3 — PDV Offline-First. Service Worker
// real com Background Sync API: quando a rede volta, o navegador dispara o evento
// "sync" com a tag registrada em registerBackgroundSync() (shared/offline/sync-pending-sales.ts).
// Este arquivo NÃO acessa Dexie/IndexedDB diretamente para evitar duplicar a lógica de
// sincronização em dois lugares: ele delega para a própria aba do app via
// postMessage, e se nenhuma aba estiver aberta, o sync será retentado automaticamente
// na próxima reconexão ou na próxima vez que o PDV for aberto.
const CACHE_NAME = "filitech-pos-shell-v1";
const APP_SHELL_URLS = ["/", "/index.html"];

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

// App-shell cache-first apenas para os assets estáticos da aplicação — nunca para
// chamadas de API (/products, /sales etc.), que devem sempre ir à rede real ou falhar
// explicitamente para a lógica de fila do Dexie assumir o controle.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const isApiCall = url.port === "3333" || url.pathname.startsWith("/api/");
  if (isApiCall || event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cached) => cached ?? fetch(event.request)),
  );
});

self.addEventListener("sync", (event) => {
  if (event.tag !== "sync-pending-sales") return;
  event.waitUntil(notifyClientsToSync());
});

async function notifyClientsToSync() {
  const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of clientsList) {
    client.postMessage({ type: "FILITECH_SYNC_PENDING_SALES" });
  }
}

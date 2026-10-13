// apps/web/src/shared/offline/register-service-worker.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 8.3 — registra o service worker real
// (public/service-worker.js) e conecta o evento "sync" (Background Sync API) +
// fallback "online" à fila de sincronização do Dexie, sem memory leaks (um único
// listener global, nunca re-registrado por componente).
import { syncPendingSales } from "./sync-pending-sales";
import { syncProductCatalog } from "./sync-catalog";

export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch((error) => {
      console.error("[filitech-pos] falha ao registrar service worker:", error);
    });
  });

  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "FILITECH_SYNC_PENDING_SALES") {
      void syncPendingSales();
    }
  });

  // Fallback para navegadores sem Background Sync API (ex.: Safari/iOS) e para o
  // caso raro de o evento "sync" do navegador não disparar imediatamente: assim que
  // o app detecta rede, tenta sincronizar vendas pendentes e o catálogo direto.
  window.addEventListener("online", () => {
    void syncPendingSales();
    void syncProductCatalog();
  });
  window.addEventListener("filitech:force-sync", () => {
    void syncPendingSales();
  });
}

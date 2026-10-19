// apps/web/src/shared/offline/register-service-worker.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 8.3 — registra o service worker real
// (public/service-worker.js) e conecta o evento "sync" (Background Sync API) +
// fallback "online" à fila de sincronização do Dexie, sem memory leaks (um único
// listener global, nunca re-registrado por componente).
import { syncPendingSales } from "./sync-pending-sales";
import { syncProductCatalog } from "./sync-catalog";

// CORREÇÃO DE AUDITORIA (full-audit, sev. 86): mensagem do service worker, evento
// "online" e o evento customizado "filitech:force-sync" podiam disparar
// `syncPendingSales()` quase simultaneamente (ex.: reconectar à rede dispara "online"
// E o Background Sync dispara quase no mesmo instante) — mesmo com o Web Lock em
// `syncPendingSales`, isso criava N chamadas enfileiradas desnecessárias. Este guard
// garante que, enquanto uma sincronização está em andamento NESTA aba, novos gatilhos
// apenas reaproveitam a mesma Promise em vez de iniciar outra.
let registered = false;
let inFlightSync: Promise<unknown> | null = null;
function triggerSync(): void {
  if (inFlightSync) return;
  inFlightSync = syncPendingSales().finally(() => {
    inFlightSync = null;
  });
}

export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  // CORREÇÃO DE AUDITORIA (full-audit, sev. 62): `registerServiceWorker()` registra
  // listeners globais permanentes (load/message/online/evento customizado). Sem este
  // guard, uma chamada duplicada (hot reload em dev, remount de microfrontend, teste)
  // registraria os MESMOS listeners de novo, fazendo cada evento disparar múltiplas
  // sincronizações em paralelo.
  if (registered) return;
  registered = true;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch((error) => {
      console.error("[filitech-pos] falha ao registrar service worker:", error);
    });
  });

  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "FILITECH_SYNC_PENDING_SALES") {
      triggerSync();
    }
  });

  // Fallback para navegadores sem Background Sync API (ex.: Safari/iOS) e para o
  // caso raro de o evento "sync" do navegador não disparar imediatamente: assim que
  // o app detecta rede, tenta sincronizar vendas pendentes e o catálogo direto.
  window.addEventListener("online", () => {
    triggerSync();
    void syncProductCatalog();
  });
  window.addEventListener("filitech:force-sync", () => {
    triggerSync();
  });
}

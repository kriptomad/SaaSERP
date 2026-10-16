// apps/web/src/shared/offline/db.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 8.3 — PDV Offline-First. Dexie.js
// (IndexedDB) é a fonte de verdade local: uma cópia materializada do catálogo de
// produtos (sincronizada via GET /products, Capítulo 8.3/gap de auditoria) e a fila
// `pendingSales` com vendas fechadas offline aguardando sincronização real.
import Dexie, { Table } from "dexie";

export interface CachedProduct {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  unitPrice: number;
  stockQuantitySnapshot: number;
  isWeighted: boolean;
  category: string | null;
  // Farmácia/Drogaria (Capítulo 4.5 — Portaria 344/1998, RDC 1.000/2025): replicados no
  // catálogo offline para que o PDV consiga exigir os dados de receita no momento da
  // montagem do carrinho, mesmo sem rede — sem isso, a venda só falharia no servidor
  // (ou, pior, na sincronização em segundo plano, quando o cliente já saiu da loja).
  requiresPrescriptionRetention: boolean;
  isControlledSubstance: boolean;
  // CORREÇÃO DE AUDITORIA (mega-audit rodada 7): sem isto não havia como o PDV saber
  // há quanto tempo este preço/estoque foi sincronizado pela última vez — um tablet
  // esquecido offline por dias continuava vendendo pelo preço antigo silenciosamente.
  // Epoch ms do último `syncProductCatalog()` bem-sucedido para ESTE produto — usado
  // pela UI do PDV para exibir um aviso visível quando o catálogo local está velho
  // demais para ser confiável (ver `CATALOG_STALE_THRESHOLD_MS` em sync-catalog.ts).
  cachedAt: number;
}

export interface PendingSale {
  localId: string; // UUID gerado no cliente — vira o idempotencyKey no servidor
  payload: Record<string, unknown>;
  createdAt: number;
  syncStatus: "PENDING" | "SYNCING" | "FAILED" | "SYNCED";
  syncAttempts: number;
  lastError?: string;
  // CORREÇÃO DE AUDITORIA (mega-audit rodada 7): sem isto, uma venda PENDING era
  // retentada em TODO disparo de sync (evento "online", postMessage do Background
  // Sync, múltiplas abas) sem nenhum espaçamento — numa reconexão instável, isso
  // martelava o backend repetidas vezes em sequência rápida. Agora guarda o
  // timestamp (epoch ms) antes do qual esta venda NÃO deve ser retentada —
  // calculado com backoff exponencial + jitter em `requeueWithBackoff`.
  nextAttemptAt?: number;
}

export interface CatalogSyncState {
  key: "lastSyncedAt";
  value: string; // ISO timestamp — usado como `updatedSince` na próxima chamada a GET /products
}

class FilitechOfflineDatabase extends Dexie {
  products!: Table<CachedProduct, string>;
  pendingSales!: Table<PendingSale, string>;
  syncState!: Table<CatalogSyncState, string>;

  constructor() {
    super("filitech-pos-offline");
    this.version(1).stores({
      products: "id, sku, barcode, category",
      pendingSales: "localId, syncStatus, createdAt",
      syncState: "key",
    });
  }
}

export const offlineDb = new FilitechOfflineDatabase();

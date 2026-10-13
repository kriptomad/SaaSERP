// apps/web/src/modules/market/pos/close-sale-offline.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 8.3 — fecha a venda localmente de forma
// otimista (nunca bloqueada por falta de rede) e enfileira a sincronização real.
import { v4 as uuid } from "uuid";
import { offlineDb } from "../../../shared/offline/db";
import { registerBackgroundSync } from "../../../shared/offline/sync-pending-sales";

export interface CloseSaleOfflineInput {
  cashRegisterId: string;
  cashierId: string;
  // Capítulo 4.1.1 — cliente identificado via CPF na nota, usado pelo backend para
  // creditar pontos de fidelidade (EARN) na mesma transação de fechamento da venda.
  clientId?: string | null;
  items: { productId: string; quantity: number; unitPrice: number }[];
  paymentMethod: "CASH" | "DEBIT_CARD" | "CREDIT_CARD" | "PIX" | "BOLETO" | "STORE_CREDIT";
  amountTendered?: number;
}

export interface CloseSaleOfflineResult {
  localId: string;
  totalAmount: number;
  changeDue: number;
}

/**
 * Fecha a venda localmente: calcula o troco, decrementa o snapshot de estoque local
 * (para que o próximo item vendido no mesmo caixa, ainda offline, já veja o estoque
 * descontado — evita a venda dupla do último item em estoque) e enfileira a
 * sincronização real — tudo isso sem jamais consultar a rede.
 */
export async function closeSaleOffline(input: CloseSaleOfflineInput): Promise<CloseSaleOfflineResult> {
  const localId = uuid();
  const totalAmount = input.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const changeDue =
    input.paymentMethod === "CASH" && input.amountTendered ? Math.max(0, input.amountTendered - totalAmount) : 0;

  await offlineDb.pendingSales.add({
    localId,
    payload: {
      idempotencyKey: localId,
      cashRegisterId: input.cashRegisterId,
      ...(input.clientId ? { clientId: input.clientId } : {}),
      items: input.items,
      paymentMethod: input.paymentMethod,
      amountTendered: input.amountTendered,
    },
    createdAt: Date.now(),
    syncStatus: "PENDING",
    syncAttempts: 0,
  });

  for (const item of input.items) {
    const cached = await offlineDb.products.get(item.productId);
    if (cached) {
      await offlineDb.products.update(item.productId, {
        stockQuantitySnapshot: cached.stockQuantitySnapshot - item.quantity,
      });
    }
  }

  await registerBackgroundSync();

  return { localId, totalAmount, changeDue };
}

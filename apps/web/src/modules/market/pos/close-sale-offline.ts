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
  items: {
    productId: string;
    quantity: number;
    unitPrice: number;
    // Farmácia/Drogaria (Capítulo 4.5): dados de receita retida, coletados no próprio
    // carrinho do PDV (ver PosPage) quando o item exige — propagados tal como estão
    // para o payload sincronizado; o backend aplica a trava final em close-sale.service.ts.
    prescriptionData?: {
      prescriptionType: "NOTIFICACAO_B_AZUL" | "RECEITA_A_AMARELA" | "RECEITA_ELETRONICA_SNCR";
      patientDocument: string;
      electronicPrescriptionNumber?: string;
    };
  }[];
  paymentMethod?: "CASH" | "DEBIT_CARD" | "CREDIT_CARD" | "PIX" | "BOLETO" | "STORE_CREDIT";
  amountTendered?: number;
  // Pagamento Dividido/Split (Capítulo 9) — alternativa a `paymentMethod` para vendas
  // pagas em 2+ métodos (ex.: parte em dinheiro, parte no cartão). Exatamente um dos
  // dois deve ser informado pelo chamador (PosPage valida isso antes de chamar aqui).
  payments?: {
    method: "CASH" | "DEBIT_CARD" | "CREDIT_CARD" | "PIX" | "BOLETO" | "STORE_CREDIT";
    amount: number;
    amountTendered?: number;
  }[];
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
  const changeDue = input.payments
    ? input.payments
        .filter((p) => p.method === "CASH" && p.amountTendered)
        .reduce((sum, p) => sum + Math.max(0, p.amountTendered! - p.amount), 0)
    : input.paymentMethod === "CASH" && input.amountTendered
      ? Math.max(0, input.amountTendered - totalAmount)
      : 0;

  // CORREÇÃO DE AUDITORIA (full-audit, sev. 79): a criação da venda pendente e o
  // decremento do snapshot de estoque local eram duas operações Dexie separadas —
  // uma falha entre elas (aba fechada, erro de IndexedDB) podia deixar a venda
  // registrada SEM o estoque local descontado (permitindo vender acima do estoque
  // real enquanto offline) ou um estado parcialmente decrementado. `transaction("rw", ...)`
  // garante que ambas as gravações só sejam efetivadas juntas (tudo ou nada).
  await offlineDb.transaction("rw", offlineDb.pendingSales, offlineDb.products, async () => {
    await offlineDb.pendingSales.add({
      localId,
      payload: {
        idempotencyKey: localId,
        cashRegisterId: input.cashRegisterId,
        ...(input.clientId ? { clientId: input.clientId } : {}),
        items: input.items,
        ...(input.payments
          ? { payments: input.payments }
          : { paymentMethod: input.paymentMethod, amountTendered: input.amountTendered }),
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
  });

  await registerBackgroundSync();

  return { localId, totalAmount, changeDue };
}

// apps/web/src/content/pendingCheckout.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 9.3 — ponte entre a calculadora pública da
// landing (sem sessão) e o checkout real (POST /api/billing/checkout, que exige
// requireAuth). O lojista escolhe o plano/módulos ANTES de criar a conta; a escolha
// é guardada aqui, sobrevive à navegação para /signup (e ao próprio cadastro), e é
// consumida uma única vez pela tela de assinatura (BillingPage) logo após o login.
const STORAGE_KEY = "filitech:pendingCheckout";

export interface PendingCheckoutSelection {
  planCode: string;
  moduleCodes: string[];
}

export function savePendingCheckout(selection: PendingCheckoutSelection): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
}

/** Lê a seleção pendente SEM apagá-la (para popular o formulário antes da confirmação). */
export function peekPendingCheckout(): PendingCheckoutSelection | null {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingCheckoutSelection;
  } catch {
    return null;
  }
}

export function clearPendingCheckout(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}

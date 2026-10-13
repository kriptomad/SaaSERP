// apps/web/src/shared/hardware/receipt-layout.ts
// Fonte: BIBLE_ENGINEERING_V2.md, novo Capítulo 23.4 — layout de cupom simplificado e
// de DANFE/NFC-e, montados em texto puro para a impressora térmica ESC/POS.
//
// LIMITAÇÃO REAL IMPORTANTE (documentar sempre): a emissão fiscal real (XML
// autorizado pela SEFAZ) ainda não existe neste monorepo — a Rodada 4 do audit
// confirmou que `transmitFiscalEvent.ts` cobre apenas CANCELAMENTO de documentos já
// emitidos externamente, e não há nenhum fluxo de EMISSÃO que gere um XML de
// NFC-e/NF-e real (isso está documentado como adiamento explícito, fora do escopo
// desta missão de hardware). `FiscalDocument.xmlStorageKey` também não tem nenhum
// leitor de storage real implementado (nenhum client S3/R2 existe no backend ainda).
// Por isso, a "impressão de DANFE/NFC-e" aqui é a IMPRESSÃO DO CUPOM FISCAL
// SIMPLIFICADO (Capítulo 21.7, já suportado pelo schema via `totalTaxesApprox`/
// `accessKey`/protocolo de autorização gravados em `FiscalDocument`), que é o que
// toda loja de fato entrega ao cliente no balcão — não o parsing de um XML de NF-e
// completo (layout DANFE "A4"), que não existe de verdade no sistema hoje. Quando o
// módulo fiscal ganhar emissão real com XML persistido, este arquivo pode ganhar um
// segundo formatter que percorre o XML; a assinatura de `ReceiptData` já foi
// desenhada para aceitar os campos que o XML forneceria (chave de acesso, protocolo)
// sem quebra de contrato.
import { EscPosBuilder } from "./escpos";

export interface ReceiptItem {
  description: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface ReceiptData {
  tenantTradeName: string;
  tenantDocument: string; // CNPJ/CPF
  saleId: string;
  closedAt: Date;
  items: ReceiptItem[];
  totalAmount: number;
  paymentMethod: string;
  totalTaxesApprox: number | null;
  /** Presentes apenas quando o documento fiscal já foi autorizado (Capítulo 21.7/21.19). */
  fiscalAccessKey: string | null;
  fiscalProtocolNumber: string | null;
  fiscalDocumentType: "NFCE" | "NFE" | null;
}

function money(value: number): string {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function padColumns(left: string, right: string, width: number): string {
  const space = Math.max(1, width - left.length - right.length);
  return `${left}${" ".repeat(space)}${right}`;
}

/**
 * Monta o cupom fiscal simplificado (Capítulo 21.7) — nunca inventa chave de acesso
 * ou protocolo: se o documento fiscal ainda não foi autorizado, imprime o aviso
 * explícito "EMISSÃO FISCAL PENDENTE" em vez de um QR Code ou chave fictícios.
 */
export function buildReceipt(data: ReceiptData, columns: 32 | 42): EscPosBuilder {
  const b = new EscPosBuilder().init().align("center").bold(true).line(data.tenantTradeName).bold(false);
  b.line(data.tenantDocument).separator(columns).align("left");

  for (const item of data.items) {
    b.line(item.description);
    b.line(padColumns(`  ${item.quantity} x ${money(item.unitPrice)}`, money(item.totalPrice), columns));
  }

  b.separator(columns);
  b.bold(true).line(padColumns("TOTAL", `R$ ${money(data.totalAmount)}`, columns)).bold(false);
  b.line(`Forma de pagamento: ${translatePaymentMethod(data.paymentMethod)}`);

  if (data.totalTaxesApprox !== null) {
    // Lei 12.741/2012 — tributos aproximados incidentes, obrigatório na notinha.
    b.line(`Trib. aprox. (Lei 12.741/2012): R$ ${money(data.totalTaxesApprox)}`);
  }

  b.separator(columns);
  if (data.fiscalAccessKey && data.fiscalProtocolNumber) {
    b.line(`${data.fiscalDocumentType === "NFCE" ? "NFC-e" : "NF-e"} autorizada`);
    b.line(`Protocolo: ${data.fiscalProtocolNumber}`);
    b.line("Chave de acesso:");
    b.line(data.fiscalAccessKey.replace(/(.{4})/g, "$1 ").trim());
  } else {
    b.bold(true).line("EMISSAO FISCAL PENDENTE").bold(false);
    b.line("Documento ainda nao autorizado pela SEFAZ.");
  }

  b.feed(1).align("center").line(`Venda ${data.saleId.slice(0, 8)}… — ${data.closedAt.toLocaleString("pt-BR")}`);
  b.feed(3).cut();
  return b;
}

function translatePaymentMethod(method: string): string {
  const map: Record<string, string> = {
    CASH: "Dinheiro",
    DEBIT_CARD: "Cartão de Débito",
    CREDIT_CARD: "Cartão de Crédito",
    PIX: "PIX",
    BOLETO: "Boleto",
    STORE_CREDIT: "Crédito da Loja",
  };
  return map[method] ?? method;
}

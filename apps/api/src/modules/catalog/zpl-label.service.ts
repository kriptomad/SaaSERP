// apps/api/src/modules/catalog/zpl-label.service.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 8.5 — impressão de etiquetas ZPL
// (Zebra/compatíveis) para produtos com código de barras.
// GAP DE AUDITORIA ENCONTRADO E CORRIGIDO: nenhuma geração de ZPL nem envio a
// impressora de etiqueta existia — apenas o conceito era citado na Bible.
import { Socket } from "node:net";

export interface LabelProductInput {
  name: string;
  barcode: string | null;
  unitPrice: number;
}

/**
 * Gera o payload ZPL (Zebra Programming Language) para uma etiqueta de produto:
 * nome (truncado para caber na largura), código de barras Code128 (aceita
 * EAN-13/EAN-8/qualquer string numérica ou alfanumérica do `barcode`) e preço
 * formatado em R$. `copies` gera o mesmo rótulo N vezes num único job de
 * impressão (padrão ZPL `^PQ`).
 */
export function generateProductLabelZpl(product: LabelProductInput, widthMm: number, heightMm: number, copies = 1): string {
  // 8 dots/mm é o padrão de impressoras Zebra 203dpi (as mais comuns no varejo BR).
  const DOTS_PER_MM = 8;
  const widthDots = Math.round(widthMm * DOTS_PER_MM);
  const heightDots = Math.round(heightMm * DOTS_PER_MM);
  const safeName = product.name.length > 28 ? `${product.name.slice(0, 27)}…` : product.name;
  const price = product.unitPrice.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const barcode = product.barcode ?? "";

  const lines = [
    "^XA",
    `^PW${widthDots}`,
    `^LL${heightDots}`,
    "^CI28", // codepage UTF-8 para acentos do nome do produto
    "^FO10,10^A0N,24,24^FD" + escapeZplField(safeName) + "^FS",
    "^FO10,40^A0N,28,28^FD" + escapeZplField(price) + "^FS",
  ];
  if (barcode) {
    lines.push("^FO10,75^BY2", "^BCN,50,Y,N,N", `^FD${escapeZplField(barcode)}^FS`);
  }
  lines.push(`^PQ${Math.max(1, Math.min(copies, 999))}`, "^XZ");
  return lines.join("\n");
}

function escapeZplField(value: string): string {
  // ZPL usa `^` e `~` como caracteres de controle — nunca deixa um nome/preço de
  // produto quebrar o payload se contiver esses caracteres literais.
  return value.replace(/\^/g, "").replace(/~/g, "");
}

/**
 * Envia o payload ZPL cru via socket TCP para a porta da impressora de rede
 * (9100 é o padrão "raw printing" suportado por praticamente toda impressora
 * Zebra/compatível de rede). Timeout de 5s evita pendurar a requisição HTTP
 * caso a impressora esteja offline/inacessível.
 */
export function sendZplToNetworkPrinter(host: string, port: number, zpl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Timeout ao conectar na impressora ${host}:${port}.`));
    }, 5_000);

    socket.connect(port, host, () => {
      socket.write(zpl, (error) => {
        clearTimeout(timeout);
        if (error) {
          socket.destroy();
          return reject(error);
        }
        socket.end();
        resolve();
      });
    });

    socket.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

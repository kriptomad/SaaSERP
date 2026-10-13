// apps/web/src/shared/hardware/thermal-printer.service.ts
// Fonte: BIBLE_ENGINEERING_V2.md, novo Capítulo 23.4 — serviço real de impressão
// térmica ESC/POS via Web Serial API, item 4 da missão de hardware.
//
// PESQUISA REALIZADA NESTA SESSÃO: comparamos Web Serial API x Web USB API para
// impressoras ESC/POS (Epson TM-T20, Elgin, Bematech). Essas impressoras, quando
// ligadas por USB, tipicamente se apresentam ao sistema operacional como uma porta
// serial virtual CDC/ACM (ou já são conectadas por serial/RS232 "de verdade" em
// modelos mais antigos) — o próprio SO já faz a ponte USB→serial, então a Web Serial
// API é o caminho documentado como mais robusto e simples (MDN/Chrome DevRel):
// basta abrir a "porta" exposta e escrever os bytes ESC/POS. A Web USB API exigiria
// reimplementar à mão os endpoints/descritores USB da impressora e FALHA caso o
// driver CDC do SO já tenha "reivindicado" a interface (comportamento documentado da
// própria API) — por isso não é usada aqui; ficou fora de escopo, anotado como
// limitação.
//
// LIMITAÇÃO REAL (documentar sempre que este arquivo for citado): `navigator.serial`
// só existe em Chrome/Edge/Opera (Chromium) via HTTPS/localhost. Em Firefox/Safari
// `isWebSerialSupported()` retorna false e todo chamador deste serviço deve cair
// para o fallback gracioso (reimpressão manual pelo navegador / exportar texto do
// cupom) — nunca finge que a impressão ocorreu.
import { EscPosBuilder } from "./escpos";

export class WebSerialUnsupportedError extends Error {}
export class PrinterNotConnectedError extends Error {}

export function isWebSerialSupported(): boolean {
  return typeof navigator !== "undefined" && "serial" in navigator && Boolean(navigator.serial);
}

export interface ThermalPrinterProfile {
  /** Baud rate documentado de fábrica — Epson TM-T20/Elgin/Bematech usam 9600 por padrão (config. de fábrica mais comum). */
  baudRate: number;
  /** Largura do cupom em colunas de texto monoespaçado — 42 para bobina 80mm, 32 para 58mm (padrões de mercado). */
  columns: 32 | 42;
}

export const PRINTER_PROFILES: Record<string, ThermalPrinterProfile> = {
  EPSON_TM_T20: { baudRate: 9600, columns: 42 },
  ELGIN_I9: { baudRate: 9600, columns: 42 },
  BEMATECH_MP4200: { baudRate: 9600, columns: 42 },
  GENERIC_58MM: { baudRate: 9600, columns: 32 },
};

export class ThermalPrinterService {
  private port: SerialPort | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;

  constructor(private readonly profile: ThermalPrinterProfile) {}

  get isConnected(): boolean {
    return this.port !== null && this.writer !== null;
  }

  /** Deve ser chamado a partir de um gesto do usuário (clique) — exigência da própria Web Serial API. */
  async connect(): Promise<void> {
    if (!isWebSerialSupported()) {
      throw new WebSerialUnsupportedError(
        "Este navegador não suporta Web Serial API (disponível apenas em Chrome/Edge/Opera). Use a entrada manual/impressão pelo diálogo do navegador como alternativa.",
      );
    }
    const port = await navigator.serial!.requestPort();
    await port.open({ baudRate: this.profile.baudRate, dataBits: 8, stopBits: 1, parity: "none" });
    if (!port.writable) {
      throw new PrinterNotConnectedError("Porta serial aberta, mas sem stream de escrita disponível.");
    }
    this.port = port;
    this.writer = port.writable.getWriter();
  }

  async disconnect(): Promise<void> {
    this.writer?.releaseLock();
    await this.port?.close().catch(() => undefined);
    this.writer = null;
    this.port = null;
  }

  private async writeRaw(bytes: Uint8Array): Promise<void> {
    if (!this.writer) {
      throw new PrinterNotConnectedError("Impressora térmica não conectada. Clique em 'Conectar impressora' antes de imprimir.");
    }
    await this.writer.write(bytes);
  }

  /** Comando ESC p — abre a gaveta de dinheiro conectada à mesma impressora (Capítulo 23.4). */
  async openCashDrawer(): Promise<void> {
    await this.writeRaw(new EscPosBuilder().openCashDrawer().build());
  }

  async printReceipt(builder: EscPosBuilder): Promise<void> {
    await this.writeRaw(builder.build());
  }
}

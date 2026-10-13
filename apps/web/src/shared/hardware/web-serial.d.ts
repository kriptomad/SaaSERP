// apps/web/src/shared/hardware/web-serial.d.ts
// Fonte: BIBLE_ENGINEERING_V2.md, novo Capítulo 23 (Hardware/Periféricos do PDV).
//
// TypeScript/lib.dom.d.ts (a versão usada neste monorepo) ainda não inclui os tipos
// da Web Serial API (especificação WICG, implementada hoje apenas em Chrome/Edge/Opera
// — Chromium ≥89). Em vez de instalar um pacote de tipos de terceiros inteiro para uma
// API ainda em "Working Draft", declaramos aqui apenas a superfície mínima realmente
// usada pelos serviços de hardware (balança/impressora), espelhando fielmente a
// especificação pública (https://wicg.github.io/serial/) e a documentação do Chrome
// DevRel (https://developer.chrome.com/docs/capabilities/serial).
//
// LIMITAÇÃO REAL: `navigator.serial` só existe em navegadores Chromium (Chrome/Edge/
// Opera) servidos via HTTPS (ou localhost). Firefox e Safari NUNCA implementaram essa
// API (posição pública da Mozilla/Apple é não adotar por razões de superfície de
// fingerprinting) — todo código que a usa precisa checar `"serial" in navigator` e
// cair graciosamente para entrada manual, o que os serviços neste diretório sempre
// fazem.
interface SerialPortInfo {
  usbVendorId?: number;
  usbProductId?: number;
}

interface SerialOptions {
  baudRate: number;
  dataBits?: number;
  stopBits?: number;
  parity?: "none" | "even" | "odd";
  bufferSize?: number;
  flowControl?: "none" | "hardware";
}

interface SerialPort extends EventTarget {
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  open(options: SerialOptions): Promise<void>;
  close(): Promise<void>;
  getInfo(): SerialPortInfo;
}

interface SerialPortRequestOptions {
  filters?: Array<{ usbVendorId?: number; usbProductId?: number }>;
}

interface Serial extends EventTarget {
  requestPort(options?: SerialPortRequestOptions): Promise<SerialPort>;
  getPorts(): Promise<SerialPort[]>;
}

interface Navigator {
  readonly serial?: Serial;
}

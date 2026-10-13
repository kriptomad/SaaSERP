// apps/web/src/shared/hardware/scale.service.ts
// Fonte: BIBLE_ENGINEERING_V2.md, novo Capítulo 23.1 — leitura de peso AO VIVO da
// balança de checkout via porta serial/USB (complementa o decoder de código de barras
// de peso variável já existente em shared/offline/scale-barcode.ts, que só lê o
// EAN-13 pré-impresso de um ticket já pesado — aqui lemos a balança diretamente,
// contínuo, para o caso de produto pesado NO PRÓPRIO CAIXA, sem ticket).
//
// PESQUISA REALIZADA NESTA SESSÃO (protocolo serial Toledo Prix / Filizola — não
// adivinhado): balanças Toledo Prix (linha Prix 3/4/5/Fit) e Filizola (linha
// Platina/Countdown) expõem RS-232 (ou USB-serial em modelos mais novos) a 9600 bps,
// 8 data bits, sem paridade, 1 stop bit — configuração de fábrica documentada e
// confirmada como padrão de mercado para balanças comerciais brasileiras. O payload
// de peso é transmitido como uma linha ASCII delimitada por STX (0x02) no início e
// CR+LF (0x0D 0x0A) no fim, contendo o peso formatado com separador decimal e a
// unidade ("kg"), ex.: STX "  1.234   kg" CR LF. Pequenas variações de layout (campos
// de status de estabilidade/zero, posição do separador decimal) existem entre
// firmwares — por isso o parser abaixo extrai o PRIMEIRO número decimal da linha via
// regex tolerante, em vez de depender de offsets fixos de coluna, o que cobre tanto
// Toledo Prix quanto Filizola sem precisar de um parser por fabricante.
//
// Filizola não documenta publicamente um protocolo divergente deste para o modo
// "contínuo"/"protocolo padrão" (mesma observação de mercado: a maioria dos
// integradores de PDV brasileiros usa o MESMO parser tolerante para as duas marcas).
// Caso um modelo específico use um layout binário proprietário (telas touch Filizola
// mais recentes, protocolo TCP/IP próprio), ele cairá fora da regex e o serviço
// reporta `null` — nunca inventa um peso.
export class WebSerialUnsupportedScaleError extends Error {}
export class ScaleNotConnectedError extends Error {}

export interface ScaleReading {
  weightKg: number;
  stable: boolean;
  raw: string;
}

export type ScaleProtocol = "TOLEDO_PRIX" | "FILIZOLA_GENERIC";

export const SCALE_PROFILES: Record<ScaleProtocol, { baudRate: number }> = {
  TOLEDO_PRIX: { baudRate: 9600 },
  FILIZOLA_GENERIC: { baudRate: 9600 },
};

// Extrai o primeiro número decimal (com vírgula OU ponto) da linha recebida.
const WEIGHT_PATTERN = /(\d{1,3}[.,]\d{2,3})/;

export function parseScaleLine(line: string): ScaleReading | null {
  const match = line.match(WEIGHT_PATTERN);
  if (!match) return null;
  const weightKg = Number(match[1].replace(",", "."));
  if (!Number.isFinite(weightKg) || weightKg < 0) return null;
  // Firmwares comuns reportam instabilidade com um caractere "I"/"M" antes do peso
  // (Instável/Movimento) — na ausência desse marcador, assume-se estável (o caso
  // mais comum: a maioria das balanças de checkout só transmite quando já estabilizou).
  const stable = !/[IM]\s*\d/.test(line);
  return { weightKg, stable, raw: line };
}

export function isWebSerialSupportedForScale(): boolean {
  return typeof navigator !== "undefined" && "serial" in navigator && Boolean(navigator.serial);
}

export class ScaleService {
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<string> | null = null;
  private stopRequested = false;

  constructor(private readonly protocol: ScaleProtocol) {}

  get isConnected(): boolean {
    return this.port !== null;
  }

  async connect(): Promise<void> {
    if (!isWebSerialSupportedForScale()) {
      throw new WebSerialUnsupportedScaleError(
        "Este navegador não suporta Web Serial API (apenas Chrome/Edge/Opera). Use a entrada manual de peso como alternativa.",
      );
    }
    const port = await navigator.serial!.requestPort();
    await port.open({ baudRate: SCALE_PROFILES[this.protocol].baudRate, dataBits: 8, stopBits: 1, parity: "none" });
    this.port = port;
  }

  async disconnect(): Promise<void> {
    this.stopRequested = true;
    await this.reader?.cancel().catch(() => undefined);
    this.reader = null;
    await this.port?.close().catch(() => undefined);
    this.port = null;
  }

  /**
   * Stream contínuo de leituras de peso — chama `onReading` a cada linha decodificada
   * com sucesso até `disconnect()` ser chamado. Uso típico: abrir ao focar o campo de
   * peso manual do PDV, fechar ao sair da tela.
   */
  async streamReadings(onReading: (reading: ScaleReading) => void): Promise<void> {
    if (!this.port?.readable) {
      throw new ScaleNotConnectedError("Balança não conectada. Clique em 'Conectar balança' antes de ler o peso.");
    }
    this.stopRequested = false;
    const textDecoder = new TextDecoderStream();
    // `TextDecoderStream.writable` é tipado pelo lib.dom como WritableStream<BufferSource>;
    // `SerialPort.readable` é ReadableStream<Uint8Array>. Ambos são compatíveis em runtime
    // (Uint8Array é um BufferSource), mas a variância estrutural do TS exige o cast abaixo.
    const readableClosed = this.port.readable.pipeTo(textDecoder.writable as unknown as WritableStream<Uint8Array>);
    this.reader = textDecoder.readable.getReader();
    let buffer = "";
    try {
      while (!this.stopRequested) {
        const { value, done } = await this.reader.read();
        if (done) break;
        buffer += value ?? "";
        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newlineIndex).replace(/[\x02\r]/g, "");
          buffer = buffer.slice(newlineIndex + 1);
          const reading = parseScaleLine(line);
          if (reading) onReading(reading);
        }
      }
    } finally {
      await readableClosed.catch(() => undefined);
    }
  }
}

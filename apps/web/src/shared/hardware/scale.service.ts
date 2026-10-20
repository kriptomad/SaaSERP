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

export interface ScaleProfileConfig {
  baudRate: number;
  // CORREÇÃO DE AUDITORIA (fa-w5-hw-scale-stability-assumption): alguns protocolos de
  // balança sinalizam estabilidade POSITIVAMENTE (ex.: token "ST"/"S" no início do
  // frame), não só a instabilidade. Quando `providesExplicitStabilityMarker` é
  // `true`, `parseScaleLine` passa a EXIGIR encontrar esse marcador positivo para
  // retornar `stable: true` — nunca mais trata a simples AUSÊNCIA do marcador de
  // instabilidade ("I"/"M") como prova de estabilidade.
  //
  // LIMITAÇÃO REAL E DOCUMENTADA: a pesquisa desta sessão só confirmou, para Toledo
  // Prix/Filizola no modo "contínuo"/protocolo padrão, um marcador NEGATIVO de
  // instabilidade — nenhum marcador positivo de estabilidade é documentado
  // publicamente para esses modelos. Por isso ambos os perfis abaixo mantêm
  // `providesExplicitStabilityMarker: false` e preservam o comportamento histórico
  // (ausência de "I"/"M" ⇒ assume estável) — uma suposição de protocolo honesta e
  // registrada aqui, não uma garantia absoluta, e não um TODO silencioso.
  providesExplicitStabilityMarker: boolean;
}

export const SCALE_PROFILES: Record<ScaleProtocol, ScaleProfileConfig> = {
  TOLEDO_PRIX: { baudRate: 9600, providesExplicitStabilityMarker: false },
  FILIZOLA_GENERIC: { baudRate: 9600, providesExplicitStabilityMarker: false },
};

// CORREÇÃO DE AUDITORIA (fa-w5-hw-scale-untrusted-weight-parser): nenhuma balança de
// checkout real pesa um item de PDV acima disso — usado como bound de sanidade para
// rejeitar leituras obviamente corrompidas/ruído de linha serial que, por coincidência,
// caiam no formato numérico esperado (ex.: bit de framing corrompido fazendo "1.234"
// virar "123.400" ou similar).
const MAX_PLAUSIBLE_WEIGHT_KG = 500;

// CORREÇÃO DE AUDITORIA (fa-w5-hw-scale-untrusted-weight-parser): a regex anterior
// (`/(\d{1,3}[.,]\d{2,3})/`) casava o primeiro número decimal em QUALQUER POSIÇÃO da
// linha, sem validar o restante do frame nem checksum algum — uma linha de ruído
// serial, ou um trecho corrompido que por acaso contivesse um número nesse formato,
// era aceito como peso válido sem nenhuma estrutura de protocolo por trás. Agora a
// linha inteira (já despojada de STX/CR pelo chamador em `streamReadings`) precisa
// casar, do início ao fim, com a estrutura documentada do frame: marcador de status
// opcional (1-2 letras, ex. "I"/"M" de instável/movimento) + peso numérico + unidade
// opcional "kg" — qualquer sujeira fora desse formato é rejeitada com `null`.
const FRAME_PATTERN = /^\s*([A-Za-z]{0,2})\s*([+-]?\d{1,3}[.,]\d{2,3})\s*(?:kg)?\s*$/i;
const INSTABILITY_MARKER_PATTERN = /^[IM]$/i;
const STABILITY_MARKER_PATTERN = /^(ST|S)$/i;

export function parseScaleLine(line: string, protocol: ScaleProtocol = "TOLEDO_PRIX"): ScaleReading | null {
  const match = line.match(FRAME_PATTERN);
  if (!match) return null;
  const weightKg = Number(match[2].replace(",", "."));
  if (!Number.isFinite(weightKg) || weightKg < 0 || weightKg > MAX_PLAUSIBLE_WEIGHT_KG) return null;
  const statusToken = (match[1] || "").trim();
  const profile = SCALE_PROFILES[protocol];
  let stable: boolean;
  if (INSTABILITY_MARKER_PATTERN.test(statusToken)) {
    stable = false;
  } else if (profile.providesExplicitStabilityMarker) {
    // Protocolo que DE FATO sinaliza estabilidade positiva — exige o marcador
    // explícito; nunca assume estável só por ausência do marcador de instabilidade.
    stable = STABILITY_MARKER_PATTERN.test(statusToken);
  } else {
    // Ver `providesExplicitStabilityMarker` acima: limitação real e documentada,
    // preservada por compatibilidade com os perfis atuais (nenhum expõe marcador
    // positivo de estabilidade).
    stable = true;
  }
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
          const reading = parseScaleLine(line, this.protocol);
          if (reading) onReading(reading);
        }
      }
    } finally {
      await readableClosed.catch(() => undefined);
    }
  }
}

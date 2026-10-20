// apps/web/src/shared/hardware/escpos.ts
// Fonte: BIBLE_ENGINEERING_V2.md, novo Capítulo 23.2/23.4 (Hardware/Periféricos —
// Impressora térmica ESC/POS e Gaveta de dinheiro). Protocolo ESC/POS confirmado via
// pesquisa web nesta sessão (documentação pública Epson "ESC/POS Command Reference" +
// referências de mercado para clones Elgin/Bematech, que seguem o mesmo conjunto de
// comandos por serem "ESC/POS compatíveis", o padrão de fato da indústria):
//
//   - ESC @ (0x1B 0x40)        — inicializa a impressora (reset de estado de formatação).
//   - ESC a n (0x1B 0x61 n)    — alinhamento: 0=esquerda, 1=centro, 2=direita.
//   - ESC E n (0x1B 0x45 n)    — negrito on/off (n=1/0).
//   - GS V m (0x1D 0x56 m)     — corte de papel (m=0 corte total, m=1 corte parcial).
//   - ESC p m t1 t2 (0x1B 0x70 m t1 t2) — pulso de abertura da GAVETA DE DINHEIRO
//     (Capítulo 23.4, item 2 da missão): m=0 (conector padrão), t1/t2 em unidades de
//     2ms controlam a duração do pulso. `ESC p 0 25 250` (0x1B 0x70 0x00 0x19 0xFA) é
//     o valor documentado como padrão de fábrica para a maioria das gavetas compatíveis
//     Epson/Elgin/Bematech conectadas à própria impressora térmica (RJ11/RJ12) — a
//     gaveta não tem lógica própria, é só um solenoide acionado pelo pulso que a
//     impressora repassa.
//
// Texto é sempre codificado em CP860 (Português/ABNT) quando a impressora suporta,
// mas aqui usamos ASCII+acentos via Latin-1 (ISO-8859-1), que cobre a maioria das
// impressoras térmicas brasileiras configuradas de fábrica (page code 2/CP850/860
// compatível o suficiente para acentuação comercial básica) sem exigir seleção de
// code page adicional — simplificação documentada, não um TODO silencioso.
const ESC = 0x1b;
const GS = 0x1d;

export class EscPosBuilder {
  private chunks: number[] = [];

  init(): this {
    this.chunks.push(ESC, 0x40);
    return this;
  }

  align(mode: "left" | "center" | "right"): this {
    const n = mode === "left" ? 0 : mode === "center" ? 1 : 2;
    this.chunks.push(ESC, 0x61, n);
    return this;
  }

  bold(enabled: boolean): this {
    this.chunks.push(ESC, 0x45, enabled ? 1 : 0);
    return this;
  }

  text(value: string): this {
    for (const byte of textToLatin1Bytes(value)) {
      this.chunks.push(byte);
    }
    return this;
  }

  line(value = ""): this {
    this.text(value);
    this.chunks.push(0x0a);
    return this;
  }

  separator(width = 42, char = "-"): this {
    return this.line(char.repeat(width));
  }

  feed(lines = 1): this {
    for (let i = 0; i < lines; i++) this.chunks.push(0x0a);
    return this;
  }

  cut(): this {
    this.chunks.push(GS, 0x56, 0x00);
    return this;
  }

  /** Comando ESC p — abre a gaveta de dinheiro conectada à impressora (Capítulo 23.4). */
  openCashDrawer(pin: 0 | 1 = 0, onMs = 50, offMs = 500): this {
    const t1 = Math.min(255, Math.round(onMs / 2));
    const t2 = Math.min(255, Math.round(offMs / 2));
    this.chunks.push(ESC, 0x70, pin, t1, t2);
    return this;
  }

  build(): Uint8Array {
    return new Uint8Array(this.chunks);
  }
}

function textToLatin1Bytes(value: string): number[] {
  const bytes: number[] = [];
  for (const char of sanitizeTextForEscPos(value)) {
    const code = char.codePointAt(0) ?? 63;
    // Fora do range Latin-1 (acentuação e símbolos comerciais básicos cobertos),
    // cai para "?" em vez de corromper a trama enviada à impressora.
    bytes.push(code <= 0xff ? code : 0x3f);
  }
  return bytes;
}

// CORREÇÃO DE AUDITORIA (fa-w5-hw-escpos-injection): `textToLatin1Bytes` convertia
// TODO code point <= 0xff diretamente para byte, incluindo bytes de controle ASCII
// (0x00-0x1F e 0x7F) — como ESC (0x1B) e GS (0x1D) são exatamente os prefixos reais
// dos próprios comandos ESC/POS que este arquivo emite, um nome de produto/cliente/
// tenant contendo esses bytes (digitado ou importado via CSV/integração) conseguia
// INJETAR comandos ESC/POS arbitrários no meio do cupom — de reconfigurar a página
// de código até acionar repetidamente o pulso da gaveta de dinheiro. Esta função
// sanitiza apenas o TEXTO de dados (nomes, descrições, valores) interpolado pelos
// chamadores — nunca os bytes de comando que o próprio `EscPosBuilder` já monta
// separadamente (align/bold/cut/openCashDrawer etc. nunca passam por aqui).
function sanitizeTextForEscPos(value: string): string {
  // Remove C0 controls (0x00-0x1F) e DEL (0x7F), preservando apenas texto imprimível;
  // quebras de linha intencionais já são tratadas por `EscPosBuilder.line()` via um
  // 0x0A próprio adicionado FORA do texto sanitizado, então \n no meio do dado nunca
  // precisa ser preservado aqui.
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\x00-\x1f\x7f]/g, "");
}

/** Comando isolado de abertura de gaveta, para reuso direto sem montar um cupom inteiro. */
export function buildOpenCashDrawerCommand(): Uint8Array {
  return new EscPosBuilder().openCashDrawer().build();
}

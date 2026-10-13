// apps/web/src/shared/hardware/hardware-config.ts
// Fonte: BIBLE_ENGINEERING_V2.md, novo Capítulo 23 — preferências de hardware do PDV
// (modelo de balança/impressora escolhidos pelo lojista para ESTE terminal físico).
//
// Decisão de design: guardado em `localStorage`, por TERMINAL, não no banco do
// tenant. Cada caixa físico de uma loja pode ter uma impressora/balança diferente
// ligada ao mesmo PC/navegador — não existe "o modelo de impressora do tenant", só
// "o modelo de impressora ligado a ESTE computador". `localStorage` é o único estado
// que naturalmente já é por-dispositivo neste app (mesmo padrão implícito do token de
// sessão, Capítulo 8.3).
const STORAGE_KEY = "filitech.hardware.config.v1";

export interface HardwareConfig {
  printerModel: "EPSON_TM_T20" | "ELGIN_I9" | "BEMATECH_MP4200" | "GENERIC_58MM" | null;
  scaleProtocol: "TOLEDO_PRIX" | "FILIZOLA_GENERIC" | null;
  openCashDrawerOnCashSale: boolean;
}

const DEFAULT_CONFIG: HardwareConfig = {
  printerModel: null,
  scaleProtocol: null,
  openCashDrawerOnCashSale: true,
};

export function loadHardwareConfig(): HardwareConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    return { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<HardwareConfig>) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveHardwareConfig(config: HardwareConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

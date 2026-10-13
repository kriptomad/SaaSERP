// apps/web/src/content/catalog.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 2.3/2.5/2.6 + packages/db/prisma/seed.ts.
// Único lugar que descreve nichos/módulos/planos no site institucional — deve
// ficar em sincronia manual com seed.ts sempre que o catálogo mudar (mesmos
// codes/preços), para que a Vitrine nunca prometa algo que o backend não cobra
// exatamente igual.

export interface ModuleCatalogItem {
  code: string;
  label: string;
  monthlyPrice: number;
  description: string;
}

export const MODULE_CATALOG: ModuleCatalogItem[] = [
  {
    code: "FISCAL_NFCE",
    label: "Emissão Fiscal (NFC-e/NFe)",
    monthlyPrice: 49.9,
    description: "Emissão de NFC-e/NFe integrada à SEFAZ, com toggle de Reforma Tributária (IBS/CBS) por nicho.",
  },
  {
    code: "WHATSAPP_INTEGRATION",
    label: "Integração WhatsApp",
    monthlyPrice: 39.9,
    description: "Notificações transacionais e campanhas via WhatsApp Business API.",
  },
  {
    code: "MULTI_FILIAL",
    label: "Multi-Filial",
    monthlyPrice: 59.9,
    description: "Gestão consolidada de múltiplas filiais sob o mesmo tenant raiz.",
  },
  {
    code: "WORK_ORDER",
    label: "Assistência Técnica (O.S.)",
    monthlyPrice: 69.9,
    description: "Ordens de serviço completas: IMEI/Serial, checklist, laudo com fotos, motor de DRM.",
  },
  {
    code: "LIQUOR_LEDGER",
    label: "Adega — Conta-Corrente de Cascos",
    monthlyPrice: 29.9,
    description: "Conta-corrente de cascos/vasilhames retornáveis e precificação em cascata.",
  },
  {
    code: "RECIPE_BOM",
    label: "Ficha Técnica (Padaria/Confeitaria)",
    monthlyPrice: 44.9,
    description: "BOM de receitas com baixa transacional automática de matéria-prima.",
  },
  {
    code: "PHARMACY_SNGPC",
    label: "Farmácia — SNGPC/Controlados",
    monthlyPrice: 79.9,
    description: "FIFO rigoroso, controle de lote/validade e compliance ANVISA/SNGPC.",
  },
];

export interface NicheDefinition {
  id: string;
  label: string;
  tagline: string;
  painPoints: string[];
  moduleCodes: string[];
  comboPlanCode: string;
}

export const NICHES: NicheDefinition[] = [
  {
    id: "mercado",
    label: "Mercado / Conveniência",
    tagline: "PDV de alta velocidade com leitura EAN-13 e balanças de checkout.",
    painPoints: [
      "Fila travando no caixa por PDV lento ou sem internet",
      "Integração frágil com balanças Toledo/Filizola",
      "Falta de controle fino de promoções e atacarejo",
    ],
    moduleCodes: ["FISCAL_NFCE", "WHATSAPP_INTEGRATION"],
    comboPlanCode: "COMBO_MERCADO_PRO",
  },
  {
    id: "assistencia-tecnica",
    label: "Assistência Técnica / Informática",
    tagline: "Ordens de serviço completas com IMEI, checklist e laudo fotográfico.",
    painPoints: [
      "Perda de histórico de aparelhos e peças trocadas",
      "Zero rastreabilidade de IMEI/número de série",
      "Orçamento aprovado por telefone sem registro",
    ],
    moduleCodes: ["WORK_ORDER", "WHATSAPP_INTEGRATION", "FISCAL_NFCE"],
    comboPlanCode: "COMBO_ASSISTENCIA_PRO",
  },
  {
    id: "adega",
    label: "Adega / Bebidas",
    tagline: "Conta-corrente de cascos retornáveis e precificação em cascata.",
    painPoints: [
      "Controle manual de vasilhames em caderno",
      "Preço de unidade vs. atacado calculado na mão",
      "Sem rastreio de quem está devendo casco",
    ],
    moduleCodes: ["LIQUOR_LEDGER", "FISCAL_NFCE"],
    comboPlanCode: "COMBO_ADEGA_PRO",
  },
  {
    id: "padaria",
    label: "Padaria / Confeitaria",
    tagline: "Ficha técnica (BOM) com baixa automática de insumos a cada venda.",
    painPoints: [
      "Estoque de insumos sempre errado",
      "Custo de receita calculado fora do sistema",
      "Sem alerta de ruptura de matéria-prima",
    ],
    moduleCodes: ["RECIPE_BOM", "FISCAL_NFCE"],
    comboPlanCode: "COMBO_PADARIA_PRO",
  },
  {
    id: "farmacia",
    label: "Farmácia / Drogaria",
    tagline: "FIFO rigoroso, lote/validade e bloqueio automático de item vencido.",
    painPoints: [
      "Risco de vender item vencido (compliance ANVISA)",
      "SNGPC de controlados feito manualmente",
      "Sem rastreabilidade de lote em caso de recall",
    ],
    moduleCodes: ["PHARMACY_SNGPC", "FISCAL_NFCE", "WHATSAPP_INTEGRATION"],
    comboPlanCode: "COMBO_FARMACIA_PRO",
  },
  {
    id: "varejo",
    label: "Varejo Geral",
    tagline: "Matrizes de variação completas: cor, tamanho, voltagem.",
    painPoints: [
      "Grade de produto cadastrada manualmente item a item",
      "Sem visão consolidada de estoque por variação",
      "PDV genérico que não reflete a operação real da loja",
    ],
    moduleCodes: ["FISCAL_NFCE", "MULTI_FILIAL"],
    comboPlanCode: "PRO",
  },
];

export interface PlanCatalogItem {
  code: string;
  label: string;
  basePrice: number;
  includedModules: string[];
  includedUserSeats: number | null;
  extraUserSeatPrice: number | null;
}

export const PLAN_CATALOG: PlanCatalogItem[] = [
  { code: "FREE", label: "Filitech Free", basePrice: 0, includedModules: [], includedUserSeats: 10, extraUserSeatPrice: 35 },
  { code: "BASIC", label: "Filitech Essencial", basePrice: 99.9, includedModules: [], includedUserSeats: 10, extraUserSeatPrice: 35 },
  { code: "PRO", label: "Filitech Profissional", basePrice: 199.9, includedModules: ["WHATSAPP_INTEGRATION"], includedUserSeats: 10, extraUserSeatPrice: 35 },
  { code: "COMBO_MERCADO_PRO", label: "Combo Mercado Pro", basePrice: 263.91, includedModules: ["FISCAL_NFCE", "WHATSAPP_INTEGRATION"], includedUserSeats: 10, extraUserSeatPrice: 35 },
  { code: "COMBO_ASSISTENCIA_PRO", label: "Combo Assistência Técnica Pro", basePrice: 220.49, includedModules: ["WORK_ORDER", "WHATSAPP_INTEGRATION", "FISCAL_NFCE"], includedUserSeats: 10, extraUserSeatPrice: 35 },
  { code: "COMBO_ADEGA_PRO", label: "Combo Adega Pro", basePrice: 161.19, includedModules: ["LIQUOR_LEDGER", "FISCAL_NFCE"], includedUserSeats: 10, extraUserSeatPrice: 35 },
  { code: "COMBO_PADARIA_PRO", label: "Combo Padaria Pro", basePrice: 250.24, includedModules: ["RECIPE_BOM", "FISCAL_NFCE"], includedUserSeats: 10, extraUserSeatPrice: 35 },
  { code: "COMBO_FARMACIA_PRO", label: "Combo Farmácia Pro", basePrice: 289.33, includedModules: ["PHARMACY_SNGPC", "FISCAL_NFCE", "WHATSAPP_INTEGRATION"], includedUserSeats: 10, extraUserSeatPrice: 35 },
];

export function findPlan(code: string): PlanCatalogItem | undefined {
  return PLAN_CATALOG.find((p) => p.code === code);
}

export function findModule(code: string): ModuleCatalogItem | undefined {
  return MODULE_CATALOG.find((m) => m.code === code);
}

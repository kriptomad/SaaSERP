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
  {
    code: "IFOOD_INTEGRATION",
    label: "Lanchonete/Restaurante — Delivery e iFood",
    monthlyPrice: 49.9,
    description: "Webhook de marketplace (iFood), canal de venda delivery/dine-in e baixa de Ficha Técnica na comanda.",
  },
  {
    code: "OPTICAL_LAB",
    label: "Ótica — Laboratório e Convênios",
    monthlyPrice: 59.9,
    description: "Pedido de laboratório óptico, livro de receitas e faturamento por convênio/plano de saúde.",
  },
  {
    code: "PETSHOP_VET",
    label: "Petshop/Veterinária — Prontuário e Vacinas",
    monthlyPrice: 39.9,
    description: "Prontuário consolidado do pet, carteira de vacinação e lembretes de retorno.",
  },
  {
    code: "FASHION_VARIANTS",
    label: "Moda/Calçados — Grades e Trocas",
    monthlyPrice: 34.9,
    description: "Matriz de variação (cor/tamanho/voltagem), curva ABC por variante, giro por coleção e trocas com crédito de loja.",
  },
  {
    code: "GIFT_PERSONALIZATION",
    label: "Papelaria/Presentes — Personalização e Sazonalidade",
    monthlyPrice: 29.9,
    description: "Janelas de sazonalidade com liquidação pós-data, kit escolar e O.S. de personalização (bordado/sublimação).",
  },
  {
    code: "SALON_BOOKING",
    label: "Salão/Barbearia — Agenda e Comissão",
    monthlyPrice: 44.9,
    description: "Agenda online pública, expediente por profissional e comissão por serviço.",
  },
  {
    code: "CONSTRUCTION_BULK_UNITS",
    label: "Material de Construção — Unidades Fracionadas e Conta Empresarial",
    monthlyPrice: 34.9,
    description: "Unidade de compra fechada vs. venda fracionada e extrato mensal consolidado de cliente profissional.",
  },
  {
    code: "AUTO_REPAIR_SHOP",
    label: "Oficina Mecânica/Autoelétrica — Placa e Veículo",
    monthlyPrice: 39.9,
    description: "Consulta automática de veículo pela placa (API Fipe) vinculada ao prontuário do cliente.",
  },
  {
    code: "TIRE_WARRANTY",
    label: "Loja de Pneus — Garantia por Lote",
    monthlyPrice: 24.9,
    description: "Garantia de fabricante rastreada por lote do pneu e controle de rodízio/inspeção periódica.",
  },
  {
    code: "CAR_WASH_QUEUE",
    label: "Estética Automotiva/Lava-Rápido — Fila de Atendimento",
    monthlyPrice: 24.9,
    description: "Fila de atendimento walk-in com tempo médio de atendimento.",
  },
  {
    code: "VEHICLE_DEALERSHIP",
    label: "Loja de Veículos — Consignação e Anúncios",
    monthlyPrice: 59.9,
    description: "Consignação de seminovos, publicação em portais de anúncio e repasse ao consignante.",
  },
  {
    code: "ACCOUNTING_OFFICE",
    label: "Escritório de Contabilidade Virtual",
    monthlyPrice: 39.9,
    description:
      "Vínculo digital com escritório de contabilidade (procuração eletrônica interna), tarefas recorrentes e geração de ECD/DEFIS/EFD-Reinf/DCTFWeb.",
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
  {
    id: "lanchonete-restaurante",
    label: "Lanchonete/Restaurante (Delivery e iFood)",
    tagline: "Comanda integrada ao delivery, sem planilha paralela para conciliar pedido de marketplace.",
    painPoints: [
      "Comissão do iFood descontada sem lançamento financeiro correspondente",
      "Comanda de salão e pedido de delivery em sistemas separados",
      "Ficha técnica não baixa insumo automaticamente no lançamento do pedido",
    ],
    moduleCodes: ["IFOOD_INTEGRATION", "FISCAL_NFCE", "WHATSAPP_INTEGRATION"],
    comboPlanCode: "COMBO_LANCHONETE_PRO",
  },
  {
    id: "otica",
    label: "Ótica",
    tagline: "Pedido de laboratório óptico e faturamento de convênio sem planilha paralela.",
    painPoints: [
      "Prazo de entrega de lente controlado em caderno/WhatsApp",
      "Livro de receitas (Decreto 24.492/1934) fora do sistema",
      "Venda por convênio sem rastreabilidade de faturamento",
    ],
    moduleCodes: ["OPTICAL_LAB", "FISCAL_NFCE", "WHATSAPP_INTEGRATION"],
    comboPlanCode: "COMBO_OTICA_PRO",
  },
  {
    id: "petshop-veterinaria",
    label: "Petshop/Veterinária",
    tagline: "Prontuário único do pet com vacinas, peso e histórico — nunca mais perder o histórico do animal.",
    painPoints: [
      "Carteira de vacinação em papel que o tutor perde",
      "Sem lembrete automático de retorno/reforço de vacina",
      "Histórico do pet espalhado entre caderno e memória do atendente",
    ],
    moduleCodes: ["PETSHOP_VET", "FISCAL_NFCE", "WHATSAPP_INTEGRATION"],
    comboPlanCode: "COMBO_PETSHOP_PRO",
  },
  {
    id: "moda",
    label: "Loja de Roupas/Moda",
    tagline: "Grade de cor/tamanho, curva ABC por variante e troca com crédito de loja.",
    painPoints: [
      "Sem saldo por variante, só por produto-pai",
      "Troca sem controle de crédito de loja gerado",
      "Coleção parada no estoque sem relatório de giro/liquidação",
    ],
    moduleCodes: ["FASHION_VARIANTS", "FISCAL_NFCE", "WHATSAPP_INTEGRATION"],
    comboPlanCode: "COMBO_MODA_PRO",
  },
  {
    id: "papelaria-presentes",
    label: "Papelaria/Presentes",
    tagline: "Sazonalidade (volta às aulas, Natal) com liquidação automática e O.S. de personalização.",
    painPoints: [
      "Encalhe sazonal sem relatório de liquidação",
      "Kit escolar montado manualmente sem baixar os itens do kit",
      "Pedido de bordado/sublimação sem acompanhamento de prazo",
    ],
    moduleCodes: ["GIFT_PERSONALIZATION", "FISCAL_NFCE", "WHATSAPP_INTEGRATION"],
    comboPlanCode: "COMBO_PAPELARIA_PRO",
  },
  {
    id: "salao-beleza",
    label: "Salão de Beleza/Barbearia",
    tagline: "Agenda online pública e comissão por serviço calculada automaticamente no pagamento.",
    painPoints: [
      "Agendamento feito por WhatsApp sem página pública",
      "Comissão do profissional calculada na calculadora/caderno",
      "Sem controle de expediente por profissional",
    ],
    moduleCodes: ["SALON_BOOKING", "FISCAL_NFCE", "WHATSAPP_INTEGRATION"],
    comboPlanCode: "COMBO_SALAO_PRO",
  },
  {
    id: "loja-calcados",
    label: "Loja de Calçados",
    tagline: "Grade de numeração com sugestão de reposição priorizando os tamanhos mais vendidos.",
    painPoints: [
      "Sugestão de compra não prioriza tamanho de maior giro",
      "Saldo por numeração sem consulta rápida no balcão",
      "Troca de calçado sem controle de crédito de loja",
    ],
    moduleCodes: ["FASHION_VARIANTS", "FISCAL_NFCE", "WHATSAPP_INTEGRATION"],
    comboPlanCode: "COMBO_CALCADOS_PRO",
  },
  {
    id: "material-construcao",
    label: "Material de Construção/Ferragens",
    tagline: "Unidade de compra fechada vs. venda fracionada e conta corrente de cliente profissional (pedreiro/construtora).",
    painPoints: [
      "Venda fracionada (metro, quilo) sem conversão automática da unidade de compra",
      "Cliente profissional sem extrato mensal consolidado",
      "Conta-corrente de obra controlada em caderno",
    ],
    moduleCodes: ["CONSTRUCTION_BULK_UNITS", "FISCAL_NFCE", "WHATSAPP_INTEGRATION"],
    comboPlanCode: "COMBO_CONSTRUCAO_PRO",
  },
  {
    id: "oficina-mecanica",
    label: "Oficina Mecânica/Autoelétrica",
    tagline: "O.S. completa com consulta automática do veículo pela placa (API Fipe).",
    painPoints: [
      "Dados do veículo (modelo/ano) digitados manualmente a cada O.S.",
      "Orçamento aprovado por telefone sem registro",
      "Sem histórico consolidado de serviços por veículo",
    ],
    moduleCodes: ["WORK_ORDER", "AUTO_REPAIR_SHOP", "FISCAL_NFCE", "WHATSAPP_INTEGRATION"],
    comboPlanCode: "COMBO_OFICINA_PRO",
  },
  {
    id: "loja-pneus",
    label: "Loja de Pneus",
    tagline: "Garantia de fabricante rastreada por lote e controle de rodízio/inspeção periódica.",
    painPoints: [
      "Garantia de pneu controlada em nota fiscal avulsa",
      "Sem lembrete de rodízio/inspeção periódica",
      "Reclamação de garantia sem rastreio de lote do fabricante",
    ],
    moduleCodes: ["TIRE_WARRANTY", "FISCAL_NFCE", "WHATSAPP_INTEGRATION"],
    comboPlanCode: "COMBO_PNEUS_PRO",
  },
  {
    id: "estetica-automotiva",
    label: "Estética Automotiva/Lava-Rápido",
    tagline: "Fila de atendimento walk-in com tempo médio de atendimento visível para o cliente.",
    painPoints: [
      "Fila de carros controlada no olho/caderno na entrada",
      "Sem estimativa de tempo médio de atendimento para o cliente",
      "Agenda e fila walk-in em sistemas diferentes",
    ],
    moduleCodes: ["CAR_WASH_QUEUE", "FISCAL_NFCE", "WHATSAPP_INTEGRATION"],
    comboPlanCode: "COMBO_LAVA_RAPIDO_PRO",
  },
  {
    id: "loja-veiculos",
    label: "Loja de Veículos (Seminovos)",
    tagline: "Consignação de seminovos com repasse automático ao consignante e publicação nos portais de anúncio.",
    painPoints: [
      "Repasse ao consignante calculado fora do sistema",
      "Anúncio publicado manualmente em cada portal (OLX/Webmotors/iCarros)",
      "Sem rastreabilidade de documentação do veículo consignado",
    ],
    moduleCodes: ["VEHICLE_DEALERSHIP", "FISCAL_NFCE", "WHATSAPP_INTEGRATION"],
    comboPlanCode: "COMBO_VEICULOS_PRO",
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
  { code: "COMBO_LANCHONETE_PRO", label: "Combo Lanchonete/Restaurante Pro", basePrice: 210.85, includedModules: ["IFOOD_INTEGRATION", "FISCAL_NFCE", "WHATSAPP_INTEGRATION"], includedUserSeats: 10, extraUserSeatPrice: 35 },
  { code: "COMBO_OTICA_PRO", label: "Combo Ótica Pro", basePrice: 219.65, includedModules: ["OPTICAL_LAB", "FISCAL_NFCE", "WHATSAPP_INTEGRATION"], includedUserSeats: 10, extraUserSeatPrice: 35 },
  { code: "COMBO_PETSHOP_PRO", label: "Combo Petshop/Veterinária Pro", basePrice: 202.05, includedModules: ["PETSHOP_VET", "FISCAL_NFCE", "WHATSAPP_INTEGRATION"], includedUserSeats: 10, extraUserSeatPrice: 35 },
  { code: "COMBO_MODA_PRO", label: "Combo Loja de Roupas/Moda Pro", basePrice: 197.65, includedModules: ["FASHION_VARIANTS", "FISCAL_NFCE", "WHATSAPP_INTEGRATION"], includedUserSeats: 10, extraUserSeatPrice: 35 },
  { code: "COMBO_PAPELARIA_PRO", label: "Combo Papelaria/Presentes Pro", basePrice: 193.25, includedModules: ["GIFT_PERSONALIZATION", "FISCAL_NFCE", "WHATSAPP_INTEGRATION"], includedUserSeats: 10, extraUserSeatPrice: 35 },
  { code: "COMBO_SALAO_PRO", label: "Combo Salão de Beleza/Barbearia Pro", basePrice: 206.45, includedModules: ["SALON_BOOKING", "FISCAL_NFCE", "WHATSAPP_INTEGRATION"], includedUserSeats: 10, extraUserSeatPrice: 35 },
  { code: "COMBO_CALCADOS_PRO", label: "Combo Loja de Calçados Pro", basePrice: 197.65, includedModules: ["FASHION_VARIANTS", "FISCAL_NFCE", "WHATSAPP_INTEGRATION"], includedUserSeats: 10, extraUserSeatPrice: 35 },
  { code: "COMBO_CONSTRUCAO_PRO", label: "Combo Material de Construção/Ferragens Pro", basePrice: 197.65, includedModules: ["CONSTRUCTION_BULK_UNITS", "FISCAL_NFCE", "WHATSAPP_INTEGRATION"], includedUserSeats: 10, extraUserSeatPrice: 35 },
  { code: "COMBO_OFICINA_PRO", label: "Combo Oficina Mecânica/Autoelétrica Pro", basePrice: 254.58, includedModules: ["WORK_ORDER", "AUTO_REPAIR_SHOP", "FISCAL_NFCE", "WHATSAPP_INTEGRATION"], includedUserSeats: 10, extraUserSeatPrice: 35 },
  { code: "COMBO_PNEUS_PRO", label: "Combo Loja de Pneus Pro", basePrice: 188.85, includedModules: ["TIRE_WARRANTY", "FISCAL_NFCE", "WHATSAPP_INTEGRATION"], includedUserSeats: 10, extraUserSeatPrice: 35 },
  { code: "COMBO_LAVA_RAPIDO_PRO", label: "Combo Estética Automotiva/Lava-Rápido Pro", basePrice: 188.85, includedModules: ["CAR_WASH_QUEUE", "FISCAL_NFCE", "WHATSAPP_INTEGRATION"], includedUserSeats: 10, extraUserSeatPrice: 35 },
  { code: "COMBO_VEICULOS_PRO", label: "Combo Loja de Veículos (Seminovos) Pro", basePrice: 219.65, includedModules: ["VEHICLE_DEALERSHIP", "FISCAL_NFCE", "WHATSAPP_INTEGRATION"], includedUserSeats: 10, extraUserSeatPrice: 35 },
];

export function findPlan(code: string): PlanCatalogItem | undefined {
  return PLAN_CATALOG.find((p) => p.code === code);
}

export function findModule(code: string): ModuleCatalogItem | undefined {
  return MODULE_CATALOG.find((m) => m.code === code);
}

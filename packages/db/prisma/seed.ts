// packages/db/prisma/seed.ts
// Autor: Bruno Costa
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 2.4/2.5/2.6 (planos, combos, catálogo de
// módulos à la carte) e Capítulo 6.1/7 (matriz global de permissões por papel,
// consultada pelo gatekeeper antes de qualquer override por usuário).
//
// Popula os catálogos GLOBAIS (não tenant-scoped): Plan, Module e
// RoleDefaultPermission. Sem esses dados, o gatekeeper (Capítulo 6.1) nunca
// libera nenhuma rota protegida e o billing de módulos à la carte não tem
// preço/label para montar o payload de upsell (Capítulo 2.6).
//
// Execução: npm run seed --workspace=packages/db  (ver script abaixo)
import { PrismaClient, PlanAudience, UserRole } from "@prisma/client";

const prisma = new PrismaClient();

// Capítulo 2.6 — MODULE_CATALOG exato do middleware de upsell.
const MODULE_CATALOG = [
  {
    code: "FISCAL_NFCE",
    label: "Emissão Fiscal (NFC-e/NFe)",
    monthlyPrice: "49.90",
    description:
      "Emissão de NFC-e/NFe integrada à SEFAZ, com toggle de Reforma Tributária (IBS/CBS) por nicho (Capítulo 17).",
  },
  {
    code: "WHATSAPP_INTEGRATION",
    label: "Integração WhatsApp",
    monthlyPrice: "39.90",
    description: "Notificações transacionais e campanhas via WhatsApp Business API (Capítulo 20.2).",
  },
  {
    code: "MULTI_FILIAL",
    label: "Multi-Filial",
    monthlyPrice: "59.90",
    description: "Gestão consolidada de múltiplas filiais sob o mesmo tenant raiz.",
  },
  {
    code: "WORK_ORDER",
    label: "Assistência Técnica (O.S.)",
    monthlyPrice: "69.90",
    description: "Ordens de serviço completas: IMEI/Serial, checklist, laudo com fotos, Motor DRM (Capítulo 4.2).",
  },
  {
    code: "LIQUOR_LEDGER",
    label: "Adega — Conta-Corrente de Cascos",
    monthlyPrice: "29.90",
    description: "Conta-corrente de cascos/vasilhames retornáveis e precificação em cascata (Capítulo 4.3).",
  },
  {
    code: "RECIPE_BOM",
    label: "Ficha Técnica (Padaria/Confeitaria)",
    monthlyPrice: "44.90",
    description: "BOM de receitas com baixa transacional de matéria-prima (Capítulo 4.4/6.3).",
  },
  {
    code: "PHARMACY_SNGPC",
    label: "Farmácia — SNGPC/Controlados",
    monthlyPrice: "79.90",
    description: "FIFO rigoroso, controle de lote/validade e compliance ANVISA/SNGPC (Capítulo 4.5/6.2).",
  },
  // GAP DE AUDITORIA FECHADO — os 12 nichos do Capítulo 11 (11.1 a 11.12) tinham
  // schema/rotas implementados mas nenhum Module/Plan correspondente, ou seja, não
  // podiam ser vendidos/ativados via billing. Módulos abaixo fecham essa lacuna.
  {
    code: "IFOOD_INTEGRATION",
    label: "Lanchonete/Restaurante — Delivery e iFood",
    monthlyPrice: "49.90",
    description: "Webhook de marketplace (iFood), canal de venda DINE_IN/delivery e baixa de Ficha Técnica no lançamento da comanda (Capítulo 11.1).",
  },
  {
    code: "OPTICAL_LAB",
    label: "Ótica — Laboratório e Convênios",
    monthlyPrice: "59.90",
    description: "Pedido de laboratório óptico, livro de receitas (Decreto 24.492/1934) e faturamento por convênio/plano de saúde (Capítulo 11.2).",
  },
  {
    code: "PETSHOP_VET",
    label: "Petshop/Veterinária — Prontuário e Vacinas",
    monthlyPrice: "39.90",
    description: "Prontuário consolidado do pet, carteira de vacinação e lembretes de retorno (Capítulo 11.3).",
  },
  {
    code: "FASHION_VARIANTS",
    label: "Moda/Calçados — Grades e Trocas",
    monthlyPrice: "34.90",
    description: "Matriz de variação (cor/tamanho/voltagem), curva ABC por variante, giro por coleção/estação e trocas com crédito de loja (Capítulo 11.4/11.7).",
  },
  {
    code: "GIFT_PERSONALIZATION",
    label: "Papelaria/Presentes — Personalização e Sazonalidade",
    monthlyPrice: "29.90",
    description: "Janelas de sazonalidade com liquidação pós-data, kit escolar (composição) e O.S. de personalização (bordado/sublimação) (Capítulo 11.5).",
  },
  {
    code: "SALON_BOOKING",
    label: "Salão/Barbearia — Agenda e Comissão",
    monthlyPrice: "44.90",
    description: "Agenda online pública, expediente por profissional e comissão por serviço materializada no pagamento (Capítulo 11.6).",
  },
  {
    code: "CONSTRUCTION_BULK_UNITS",
    label: "Material de Construção — Unidades Fracionadas e Conta Empresarial",
    monthlyPrice: "34.90",
    description: "Unidade de compra fechada vs. venda fracionada e extrato mensal consolidado de cliente profissional (Capítulo 11.8).",
  },
  {
    code: "AUTO_REPAIR_SHOP",
    label: "Oficina Mecânica/Autoelétrica — Placa e Veículo",
    monthlyPrice: "39.90",
    description: "Consulta automática de veículo pela placa (API Fipe) vinculada ao prontuário do cliente (Capítulo 11.9).",
  },
  {
    code: "TIRE_WARRANTY",
    label: "Loja de Pneus — Garantia por Lote",
    monthlyPrice: "24.90",
    description: "Garantia de fabricante rastreada por lote do pneu e controle de rodízio/inspeção periódica (Capítulo 11.10).",
  },
  {
    code: "CAR_WASH_QUEUE",
    label: "Estética Automotiva/Lava-Rápido — Fila de Atendimento",
    monthlyPrice: "24.90",
    description: "Fila de atendimento walk-in com tempo médio de atendimento, reaproveitando a Agenda (Capítulo 11.11).",
  },
  {
    code: "VEHICLE_DEALERSHIP",
    label: "Loja de Veículos — Consignação e Anúncios",
    monthlyPrice: "59.90",
    description: "Consignação de seminovos, publicação em portais de anúncio (OLX/Webmotors/iCarros) e repasse ao consignante (Capítulo 11.12).",
  },
  {
    code: "ONLINE_STORE",
    label: "Vitrine Virtual — Loja Online",
    monthlyPrice: "29.90",
    description: "Catálogo público com pedidos online (retirada/entrega), sem risco de overselling — o lojista confirma cada pedido antes de virar venda real no PDV (Capítulo 8.5).",
  },
] as const;

// Capítulo 2.3/2.4/2.5 — planos base + Filitech Pessoal (B2C).
const PLAN_CATALOG = [
  {
    code: "FREE",
    label: "Filitech Free",
    basePrice: "0.00",
    includedModules: [] as string[],
    audience: PlanAudience.BUSINESS,
    maxConnectedAccounts: null,
    includedUserSeats: 10,
    extraUserSeatPrice: "35.00",
  },
  {
    code: "BASIC",
    label: "Filitech Essencial",
    basePrice: "99.90",
    includedModules: [] as string[],
    audience: PlanAudience.BUSINESS,
    maxConnectedAccounts: null,
    includedUserSeats: 10,
    extraUserSeatPrice: "35.00",
  },
  {
    code: "PRO",
    label: "Filitech Profissional",
    basePrice: "199.90",
    includedModules: ["WHATSAPP_INTEGRATION"],
    audience: PlanAudience.BUSINESS,
    maxConnectedAccounts: null,
    includedUserSeats: 10,
    extraUserSeatPrice: "35.00",
  },
  {
    code: "COMBO_MERCADO_PRO",
    label: "Combo Mercado Pro",
    basePrice: "263.91", // (99.90 + 49.90 + 39.90) * 0.88 — 12% off, Capítulo 2.5
    includedModules: ["FISCAL_NFCE", "WHATSAPP_INTEGRATION"],
    audience: PlanAudience.BUSINESS,
    maxConnectedAccounts: null,
    includedUserSeats: 10,
    extraUserSeatPrice: "35.00",
  },
  {
    code: "COMBO_ASSISTENCIA_PRO",
    label: "Combo Assistência Técnica Pro",
    basePrice: "220.49", // (99.90 + 69.90 + 39.90 + 49.90) * 0.85 — 15% off
    includedModules: ["WORK_ORDER", "WHATSAPP_INTEGRATION", "FISCAL_NFCE"],
    audience: PlanAudience.BUSINESS,
    maxConnectedAccounts: null,
    includedUserSeats: 10,
    extraUserSeatPrice: "35.00",
  },
  {
    code: "COMBO_ADEGA_PRO",
    label: "Combo Adega Pro",
    basePrice: "161.19", // (99.90 + 29.90 + 49.90) * 0.90 — 10% off
    includedModules: ["LIQUOR_LEDGER", "FISCAL_NFCE"],
    audience: PlanAudience.BUSINESS,
    maxConnectedAccounts: null,
    includedUserSeats: 10,
    extraUserSeatPrice: "35.00",
  },
  {
    code: "COMBO_PADARIA_PRO",
    label: "Combo Padaria Pro",
    basePrice: "250.24", // (199.90 + 44.90 + 49.90) * 0.85 — 15% off
    includedModules: ["RECIPE_BOM", "FISCAL_NFCE"],
    audience: PlanAudience.BUSINESS,
    maxConnectedAccounts: null,
    includedUserSeats: 10,
    extraUserSeatPrice: "35.00",
  },
  {
    code: "COMBO_FARMACIA_PRO",
    label: "Combo Farmácia Pro",
    basePrice: "289.33", // (199.90 + 79.90 + 49.90 + 39.90) * 0.82 — 18% off
    includedModules: ["PHARMACY_SNGPC", "FISCAL_NFCE", "WHATSAPP_INTEGRATION"],
    audience: PlanAudience.BUSINESS,
    maxConnectedAccounts: null,
    includedUserSeats: 10,
    extraUserSeatPrice: "35.00",
  },
  // GAP DE AUDITORIA FECHADO — combos dos 12 nichos do Capítulo 11, mesmo padrão de
  // desconto dos combos acima: base BASIC (99.90) + FISCAL_NFCE + WHATSAPP_INTEGRATION
  // + módulo(s) do nicho, com 12% de desconto (0.88), exceto Oficina Mecânica, que
  // soma também WORK_ORDER (O.S. é o núcleo da operação) com 15% de desconto (0.85).
  {
    code: "COMBO_LANCHONETE_PRO",
    label: "Combo Lanchonete/Restaurante Pro",
    basePrice: "210.85", // (99.90 + 49.90 + 39.90 + 49.90) * 0.88 — 12% off
    includedModules: ["IFOOD_INTEGRATION", "FISCAL_NFCE", "WHATSAPP_INTEGRATION"],
    audience: PlanAudience.BUSINESS,
    maxConnectedAccounts: null,
    includedUserSeats: 10,
    extraUserSeatPrice: "35.00",
  },
  {
    code: "COMBO_OTICA_PRO",
    label: "Combo Ótica Pro",
    basePrice: "219.65", // (99.90 + 49.90 + 39.90 + 59.90) * 0.88 — 12% off
    includedModules: ["OPTICAL_LAB", "FISCAL_NFCE", "WHATSAPP_INTEGRATION"],
    audience: PlanAudience.BUSINESS,
    maxConnectedAccounts: null,
    includedUserSeats: 10,
    extraUserSeatPrice: "35.00",
  },
  {
    code: "COMBO_PETSHOP_PRO",
    label: "Combo Petshop/Veterinária Pro",
    basePrice: "202.05", // (99.90 + 49.90 + 39.90 + 39.90) * 0.88 — 12% off
    includedModules: ["PETSHOP_VET", "FISCAL_NFCE", "WHATSAPP_INTEGRATION"],
    audience: PlanAudience.BUSINESS,
    maxConnectedAccounts: null,
    includedUserSeats: 10,
    extraUserSeatPrice: "35.00",
  },
  {
    code: "COMBO_MODA_PRO",
    label: "Combo Loja de Roupas/Moda Pro",
    basePrice: "197.65", // (99.90 + 49.90 + 39.90 + 34.90) * 0.88 — 12% off
    includedModules: ["FASHION_VARIANTS", "FISCAL_NFCE", "WHATSAPP_INTEGRATION"],
    audience: PlanAudience.BUSINESS,
    maxConnectedAccounts: null,
    includedUserSeats: 10,
    extraUserSeatPrice: "35.00",
  },
  {
    code: "COMBO_PAPELARIA_PRO",
    label: "Combo Papelaria/Presentes Pro",
    basePrice: "193.25", // (99.90 + 49.90 + 39.90 + 29.90) * 0.88 — 12% off
    includedModules: ["GIFT_PERSONALIZATION", "FISCAL_NFCE", "WHATSAPP_INTEGRATION"],
    audience: PlanAudience.BUSINESS,
    maxConnectedAccounts: null,
    includedUserSeats: 10,
    extraUserSeatPrice: "35.00",
  },
  {
    code: "COMBO_SALAO_PRO",
    label: "Combo Salão de Beleza/Barbearia Pro",
    basePrice: "206.45", // (99.90 + 49.90 + 39.90 + 44.90) * 0.88 — 12% off
    includedModules: ["SALON_BOOKING", "FISCAL_NFCE", "WHATSAPP_INTEGRATION"],
    audience: PlanAudience.BUSINESS,
    maxConnectedAccounts: null,
    includedUserSeats: 10,
    extraUserSeatPrice: "35.00",
  },
  {
    code: "COMBO_CALCADOS_PRO",
    label: "Combo Loja de Calçados Pro",
    basePrice: "197.65", // (99.90 + 49.90 + 39.90 + 34.90) * 0.88 — 12% off — mesmo módulo de grade da Moda (Capítulo 11.7)
    includedModules: ["FASHION_VARIANTS", "FISCAL_NFCE", "WHATSAPP_INTEGRATION"],
    audience: PlanAudience.BUSINESS,
    maxConnectedAccounts: null,
    includedUserSeats: 10,
    extraUserSeatPrice: "35.00",
  },
  {
    code: "COMBO_CONSTRUCAO_PRO",
    label: "Combo Material de Construção/Ferragens Pro",
    basePrice: "197.65", // (99.90 + 49.90 + 39.90 + 34.90) * 0.88 — 12% off
    includedModules: ["CONSTRUCTION_BULK_UNITS", "FISCAL_NFCE", "WHATSAPP_INTEGRATION"],
    audience: PlanAudience.BUSINESS,
    maxConnectedAccounts: null,
    includedUserSeats: 10,
    extraUserSeatPrice: "35.00",
  },
  {
    code: "COMBO_OFICINA_PRO",
    label: "Combo Oficina Mecânica/Autoelétrica Pro",
    basePrice: "254.58", // (99.90 + 69.90 + 49.90 + 39.90 + 39.90) * 0.85 — 15% off (inclui WORK_ORDER)
    includedModules: ["WORK_ORDER", "AUTO_REPAIR_SHOP", "FISCAL_NFCE", "WHATSAPP_INTEGRATION"],
    audience: PlanAudience.BUSINESS,
    maxConnectedAccounts: null,
    includedUserSeats: 10,
    extraUserSeatPrice: "35.00",
  },
  {
    code: "COMBO_PNEUS_PRO",
    label: "Combo Loja de Pneus Pro",
    basePrice: "188.85", // (99.90 + 49.90 + 39.90 + 24.90) * 0.88 — 12% off
    includedModules: ["TIRE_WARRANTY", "FISCAL_NFCE", "WHATSAPP_INTEGRATION"],
    audience: PlanAudience.BUSINESS,
    maxConnectedAccounts: null,
    includedUserSeats: 10,
    extraUserSeatPrice: "35.00",
  },
  {
    code: "COMBO_LAVA_RAPIDO_PRO",
    label: "Combo Estética Automotiva/Lava-Rápido Pro",
    basePrice: "188.85", // (99.90 + 49.90 + 39.90 + 24.90) * 0.88 — 12% off
    includedModules: ["CAR_WASH_QUEUE", "FISCAL_NFCE", "WHATSAPP_INTEGRATION"],
    audience: PlanAudience.BUSINESS,
    maxConnectedAccounts: null,
    includedUserSeats: 10,
    extraUserSeatPrice: "35.00",
  },
  {
    code: "COMBO_VEICULOS_PRO",
    label: "Combo Loja de Veículos (Seminovos) Pro",
    basePrice: "219.65", // (99.90 + 49.90 + 39.90 + 59.90) * 0.88 — 12% off
    includedModules: ["VEHICLE_DEALERSHIP", "FISCAL_NFCE", "WHATSAPP_INTEGRATION"],
    audience: PlanAudience.BUSINESS,
    maxConnectedAccounts: null,
    includedUserSeats: 10,
    extraUserSeatPrice: "35.00",
  },
  {
    code: "PERSONAL_FREE",
    label: "Filitech Pessoal Free",
    basePrice: "0.00",
    includedModules: [] as string[],
    audience: PlanAudience.PERSONAL,
    maxConnectedAccounts: 2, // Capítulo 22.10 — teto de contas Open Finance conectadas no free B2C
    includedUserSeats: null, // Capítulo 2.9 — assentos pagos não se aplicam ao Filitech Pessoal (é "membros da casa", não headcount de empresa)
    extraUserSeatPrice: null,
  },
  {
    code: "PERSONAL_PLUS",
    label: "Filitech Pessoal Plus",
    basePrice: "19.90",
    includedModules: [] as string[],
    audience: PlanAudience.PERSONAL,
    maxConnectedAccounts: null,
    includedUserSeats: null,
    extraUserSeatPrice: null,
  },
] as const;

// Capítulo 6.1/7 — matriz GLOBAL de permissões padrão por papel. Convenção
// "dominio:recurso:acao" (mesma usada nos exemplos de RolePermission do
// Capítulo 20.9 e 22.1: "financial:*:read", "fiscal:document:read",
// "household:workspace:delete", "household:members:remove-owner").
//
// Hierarquia de negócio (Capítulo 2.2): OWNER > MANAGER > TECHNICIAN/CASHIER,
// com ACCOUNTANT e HOUSEHOLD_MEMBER como papéis paralelos de escopo restrito.
const OWNER_PERMISSIONS = [
  "pdv:sale:create",
  "pdv:sale:cancel",
  "pdv:cash-register:open",
  "pdv:cash-register:close",
  "stock:product:read",
  "stock:product:write",
  "stock:movement:read",
  "stock:movement:write",
  "crm:client:read",
  "crm:client:write",
  "crm:supplier:read",
  "crm:supplier:write",
  "work-order:read",
  "work-order:write",
  "work-order:approve-budget",
  "scheduling:service:read",
  "scheduling:service:write",
  "scheduling:appointment:read",
  "scheduling:appointment:write",
  "pdv:comanda:read",
  "pdv:comanda:write",
  "financial:*:read",
  "financial:*:write",
  "fiscal:document:read",
  "fiscal:document:issue",
  "fiscal:document:cancel",
  "fiscal:ibs-cbs-regime:manage",
  "billing:subscription:read",
  "billing:subscription:manage",
  "settings:tenant:read",
  "settings:tenant:write",
  "settings:tenant:delete",
  "settings:users:manage",
  "settings:role-permissions:manage",
  "settings:integrations:manage",
  "reports:*:read",
  "reports:*:write",
  "loyalty:program:read",
  "loyalty:program:write",
  "loyalty:account:read",
  "loyalty:account:write",
  "accounting-office:engagement:manage",
  "accounting-office:task:read",
  "accounting-office:task:write",
  "accounting-office:document:read",
  "accounting-office:document:write",
  "accounting-office:partner:read",
  "accounting-office:partner:manage",
  // Licença Mestra (Capítulo 2.10) — exclusivamente Owner: ativação/renovação/trial da
  // licença mestra é decisão de dono do negócio, nunca do Manager/operação do dia a dia
  // (mesmo tratamento dado a "billing:subscription:manage" acima).
  "licensing:license:read",
  "licensing:license:manage",
  // Capítulo 4.2 — Assistência Técnica: regra de comissão por técnico é decisão
  // gerencial (% sobre mão de obra), nunca do próprio técnico.
  "work-order:commission:manage",
  // Capítulo 4.3 — Adega/Bebidas: conta-corrente de cascos/vasilhames retornáveis.
  "liquor-ledger:ledger:read",
  "liquor-ledger:ledger:write",
  // Capítulo 4.5 — Farmácia/Drogaria: retenção de receita (SNGPC/SNCR) e validade a vencer.
  "pharmacy:prescription-record:read",
  "pharmacy:prescription-record:write",
  "pharmacy:expiring-batches:read",
  // Capítulo 4.5 — SNGPC: livro de escrituração de substâncias controladas é dado
  // sensível de compliance regulatório (ANVISA); restrito a OWNER/MANAGER, nunca ao
  // balcão (CASHIER só registra a retenção pontual, nunca extrai o livro completo).
  "pharmacy:sngpc-ledger:read",
  // Capítulo 11.4 — Loja de Roupas/Moda: trocas por tamanho/defeito e crédito de loja.
  "catalog:exchange:read",
  "catalog:exchange:write",
  // Capítulo 11.2 — Ótica: pedidos de laboratório óptico e faturamento de convênio
  // (billing é decisão financeira, nunca do balcão — ver CASHIER abaixo, que só lê).
  "optical:lab:read",
  "optical:lab:write",
  "optical:health-insurance:read",
  "optical:health-insurance:write",
  // Capítulo 11.9 — Oficina Mecânica: garantia de fabricante por lote de pneus.
  "tires:warranty:read",
  // Capítulo 11.11 — Estética Automotiva/Lava-Rápido: fila de atendimento walk-in.
  "car-wash:queue:read",
  "car-wash:queue:write",
  // Capítulo 11.5 — Papelaria/Presentes: O.S. de personalização (bordado/sublimação).
  "personalization:order:read",
  "personalization:order:write",
];
  "pdv:sale:create",
  "pdv:sale:cancel",
  "pdv:cash-register:open",
  "pdv:cash-register:close",
  "stock:product:read",
  "stock:product:write",
  "stock:movement:read",
  "stock:movement:write",
  "crm:client:read",
  "crm:client:write",
  "crm:supplier:read",
  "crm:supplier:write",
  "work-order:read",
  "work-order:write",
  "work-order:approve-budget",
  "scheduling:service:read",
  "scheduling:service:write",
  "scheduling:appointment:read",
  "scheduling:appointment:write",
  "pdv:comanda:read",
  "pdv:comanda:write",
  "financial:*:read",
  "financial:*:write",
  "fiscal:document:read",
  "fiscal:document:issue",
  "fiscal:ibs-cbs-regime:manage",
  "settings:tenant:read",
  "settings:users:manage",
  "settings:integrations:manage",
  "reports:*:read",
  "reports:*:write",
  "loyalty:program:read",
  "loyalty:program:write",
  "loyalty:account:read",
  "loyalty:account:write",
  "accounting-office:engagement:manage",
  "accounting-office:task:read",
  "accounting-office:task:write",
  "accounting-office:document:read",
  "accounting-office:document:write",
  "accounting-office:partner:read",
  "accounting-office:partner:manage",
  // Capítulo 4.2/4.3/4.5 — MANAGER administra comissão, cascos e receita/validade no
  // dia a dia da loja (OWNER também tem via matriz acima; CASHIER só o necessário no balcão).
  "work-order:commission:manage",
  "liquor-ledger:ledger:read",
  "liquor-ledger:ledger:write",
  "pharmacy:prescription-record:read",
  "pharmacy:prescription-record:write",
  "pharmacy:expiring-batches:read",
  "pharmacy:sngpc-ledger:read",
  "catalog:exchange:read",
  "catalog:exchange:write",
  "optical:lab:read",
  "optical:lab:write",
  "optical:health-insurance:read",
  "optical:health-insurance:write",
  "tires:warranty:read",
  "car-wash:queue:read",
  "car-wash:queue:write",
  "personalization:order:read",
  "personalization:order:write",
];

const TECHNICIAN_PERMISSIONS = [
  "work-order:read",
  "work-order:write",
  "stock:product:read",
  "stock:movement:read",
  "crm:client:read",
  "scheduling:appointment:read",
  "scheduling:appointment:write",
  // Capítulo 11.2 — Ótica: técnico de laboratório atualiza o status do pedido de
  // lente (IN_REPAIR→READY→DELIVERED) — mesmo domínio que já tem para work-order.
  "optical:lab:read",
  "optical:lab:write",
];

// Capítulo 4.3 — Adega/Bebidas: CASHIER consulta o saldo de cascos do cliente no
// balcão (ex.: confirmar quantos vasilhames o cliente ainda deve) mas não lança
// ajustes manuais (isso é MANAGER/OWNER).
const CASHIER_PERMISSIONS = [
  "loyalty:account:read",
  "pdv:sale:create",
  "pdv:cash-register:open",
  "pdv:cash-register:close",
  "stock:product:read",
  "crm:client:read",
  "pdv:comanda:read",
  "pdv:comanda:write",
  "scheduling:appointment:read",
  "scheduling:appointment:write",
  "liquor-ledger:ledger:read",
  "pharmacy:prescription-record:write",
  "pharmacy:prescription-record:read",
  // Capítulo 11.4 — troca no balcão: caixa registra a troca e consulta/emite crédito
  // de loja do cliente sem precisar de um MANAGER/OWNER aprovando cada uma.
  "catalog:exchange:read",
  "catalog:exchange:write",
  // Capítulo 11.2 — Ótica: caixa consulta prazo/status do pedido de laboratório ao
  // atender o cliente no balcão (ex.: "sua lente já ficou pronta?"), mas não altera
  // status (isso é do laboratório/TECHNICIAN) nem fatura convênio (MANAGER/OWNER).
  "optical:lab:read",
  // Capítulo 11.11 — Estética Automotiva/Lava-Rápido: caixa/atendente opera a fila
  // de atendimento walk-in do dia a dia (mesmo nível que pdv:comanda acima).
  "car-wash:queue:read",
  "car-wash:queue:write",
];

// Capítulo 20.9 — Portal do Contador: somente leitura financeiro/fiscal, sem
// acesso a PDV/estoque/CRM operacional.
const ACCOUNTANT_PERMISSIONS = [
  "financial:*:read",
  "fiscal:document:read",
  "reports:*:read",
  "accounting-office:task:read",
  "accounting-office:task:write",
  "accounting-office:document:read",
  // Contador precisa consultar sócios/pró-labore já lançados para gerar
  // EFD-Reinf/DCTFWeb/Informe de Rendimentos do Sócio (Capítulo 21.18.12), mas o
  // lançamento do pró-labore em si é decisão do lojista/RH, nunca do contador.
  "accounting-office:partner:read",
];

// Capítulo 22.1 — cônjuge/parceiro(a) convidado em tenant PERSONAL: lê e lança
// normalmente, mas nunca exclui o workspace nem remove o OWNER original.
const HOUSEHOLD_MEMBER_PERMISSIONS = [
  "financial:*:read",
  "financial:*:write",
  "household:workspace:read",
  "household:members:read",
];

const ROLE_PERMISSION_MATRIX: Record<UserRole, string[]> = {
  OWNER: OWNER_PERMISSIONS,
  MANAGER: MANAGER_PERMISSIONS,
  TECHNICIAN: TECHNICIAN_PERMISSIONS,
  CASHIER: CASHIER_PERMISSIONS,
  ACCOUNTANT: ACCOUNTANT_PERMISSIONS,
  HOUSEHOLD_MEMBER: HOUSEHOLD_MEMBER_PERMISSIONS,
};

async function seedModules() {
  for (const mod of MODULE_CATALOG) {
    await prisma.module.upsert({
      where: { code: mod.code },
      update: { label: mod.label, monthlyPrice: mod.monthlyPrice, description: mod.description },
      create: mod,
    });
  }
  console.log(`[seed] ${MODULE_CATALOG.length} módulos sincronizados.`);
}

async function seedPlans() {
  for (const plan of PLAN_CATALOG) {
    await prisma.plan.upsert({
      where: { code: plan.code },
      update: {
        label: plan.label,
        basePrice: plan.basePrice,
        includedModules: [...plan.includedModules],
        audience: plan.audience,
        maxConnectedAccounts: plan.maxConnectedAccounts,
        includedUserSeats: plan.includedUserSeats,
        extraUserSeatPrice: plan.extraUserSeatPrice,
      },
      create: { ...plan, includedModules: [...plan.includedModules] },
    });
  }
  console.log(`[seed] ${PLAN_CATALOG.length} planos sincronizados.`);
}

async function seedRoleDefaultPermissions() {
  let total = 0;
  for (const role of Object.keys(ROLE_PERMISSION_MATRIX) as UserRole[]) {
    for (const permissionCode of ROLE_PERMISSION_MATRIX[role]) {
      await prisma.roleDefaultPermission.upsert({
        where: { role_permissionCode: { role, permissionCode } },
        update: {},
        create: { role, permissionCode },
      });
      total += 1;
    }
  }
  console.log(`[seed] ${total} permissões padrão (RoleDefaultPermission) sincronizadas.`);
}

async function main() {
  await seedModules();
  await seedPlans();
  await seedRoleDefaultPermissions();
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error("[seed] Falha ao popular catálogos globais:", error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });

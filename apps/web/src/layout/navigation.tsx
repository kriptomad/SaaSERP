// apps/web/src/layout/navigation.tsx
// Estrutura extensível de navegação por módulo/nicho (Bible Capítulo 4).
// Para adicionar uma tela: inclua um NavItem em `items` do grupo correspondente.
// Grupos de nicho sem itens não são renderizados até existir ao menos uma rota real.
import type { ReactNode } from "react";
import DashboardIcon from "@mui/icons-material/Dashboard";
import PointOfSaleIcon from "@mui/icons-material/PointOfSale";
import PeopleIcon from "@mui/icons-material/People";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import CategoryIcon from "@mui/icons-material/Category";
import InventoryIcon from "@mui/icons-material/Inventory2";
import SwapVertIcon from "@mui/icons-material/SwapVert";
import TuneIcon from "@mui/icons-material/Tune";
import FactCheckIcon from "@mui/icons-material/FactCheck";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCart";
import PointOfSaleOutlinedIcon from "@mui/icons-material/Payments";
import InsightsIcon from "@mui/icons-material/Insights";
import ArrowCircleUpIcon from "@mui/icons-material/ArrowCircleUp";
import ArrowCircleDownIcon from "@mui/icons-material/ArrowCircleDown";
import BuildIcon from "@mui/icons-material/Build";
import EventIcon from "@mui/icons-material/Event";
import MiscellaneousServicesIcon from "@mui/icons-material/MiscellaneousServices";
import LoyaltyIcon from "@mui/icons-material/Loyalty";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import PetsIcon from "@mui/icons-material/Pets";
import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
import VerifiedUserIcon from "@mui/icons-material/VerifiedUser";
import SettingsInputComponentIcon from "@mui/icons-material/SettingsInputComponent";
import NotificationsIcon from "@mui/icons-material/Notifications";
import AssessmentIcon from "@mui/icons-material/Assessment";
import PaymentsIcon from "@mui/icons-material/Payments";
import WineBarIcon from "@mui/icons-material/WineBar";
import BakeryDiningIcon from "@mui/icons-material/BakeryDining";
import LocalPharmacyIcon from "@mui/icons-material/LocalPharmacy";
import EventBusyIcon from "@mui/icons-material/EventBusy";
import CreditScoreIcon from "@mui/icons-material/CreditScore";
import DonutLargeIcon from "@mui/icons-material/DonutLarge";
import VisibilityIcon from "@mui/icons-material/Visibility";
import LocalHospitalIcon from "@mui/icons-material/LocalHospital";
import CardGiftcardIcon from "@mui/icons-material/CardGiftcard";
import ConstructionIcon from "@mui/icons-material/Construction";
import TireRepairIcon from "@mui/icons-material/TireRepair";
import LocalCarWashIcon from "@mui/icons-material/LocalCarWash";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import SavingsIcon from "@mui/icons-material/Savings";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import CreditCardIcon from "@mui/icons-material/CreditCard";
import FlagIcon from "@mui/icons-material/Flag";
import PieChartIcon from "@mui/icons-material/PieChart";
import RepeatIcon from "@mui/icons-material/Repeat";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import CalculateIcon from "@mui/icons-material/Calculate";
import CloudDownloadIcon from "@mui/icons-material/CloudDownload";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";

export interface NavItem {
  id: string;
  label: string;
  path: string;
  icon: ReactNode;
  // Código do módulo no catálogo (feature gating) exigido para ver este item.
  moduleCode?: string;
  // Variante de `moduleCode` para itens que servem a mais de um nicho (ex.: O.S. de
  // Oficina Mecânica reaproveita o mesmo módulo de Assistência Técnica) — basta o
  // tenant ter QUALQUER UM dos módulos listados para o item aparecer.
  moduleCodes?: string[];
  // Papéis (UserRole) autorizados a ver este item no menu — omitido = visível para todos
  // os papéis autenticados. Usado pela Licença Mestra (Capítulo 2.10), restrita ao Owner.
  roles?: string[];
  // Tipos de tenant (Tenant.tenantType) autorizados a ver este item — omitido = visível
  // para qualquer tipo de tenant. GAP DE AUDITORIA FECHADO (Capítulo 21.18.6/22.1): antes
  // desta correção, nenhum item de nav era filtrado por tenantType, então um escritório
  // de contabilidade (ACCOUNTING_OFFICE) via o menu inteiro de varejo (PDV/Estoque/
  // Compras/Comanda etc.), e um tenant pessoal (PERSONAL) via o mesmo menu de uma loja.
  tenantTypes?: Array<"BUSINESS" | "PERSONAL" | "ACCOUNTING_OFFICE">;
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
  // Mesma semântica de `NavItem.tenantTypes`, aplicada ao grupo inteiro — usado para
  // esconder grupos inteiros de varejo/nicho de tenants não-BUSINESS.
  tenantTypes?: Array<"BUSINESS" | "PERSONAL" | "ACCOUNTING_OFFICE">;
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "core",
    label: "Geral",
    tenantTypes: ["BUSINESS"],
    items: [
      { id: "dashboard", label: "Dashboard", path: "/dashboard", icon: <DashboardIcon /> },
      { id: "pdv", label: "PDV", path: "/pdv", icon: <PointOfSaleIcon /> },
      { id: "pdv-vendas", label: "Histórico de vendas", path: "/pdv/vendas", icon: <ReceiptLongIcon /> },
      { id: "caixa", label: "Caixa", path: "/caixa", icon: <PointOfSaleOutlinedIcon /> },
      { id: "comanda", label: "Comanda", path: "/comanda", icon: <ReceiptLongIcon /> },
    ],
  },
  {
    id: "cadastros",
    label: "Cadastros",
    tenantTypes: ["BUSINESS"],
    items: [
      { id: "clientes", label: "Clientes", path: "/cadastros/clientes", icon: <PeopleIcon /> },
      { id: "fornecedores", label: "Fornecedores", path: "/cadastros/fornecedores", icon: <LocalShippingIcon /> },
      { id: "produtos", label: "Produtos", path: "/cadastros/produtos", icon: <CategoryIcon /> },
      { id: "prontuarios", label: "Prontuários (pet/veículo/ótica)", path: "/cadastros/prontuarios", icon: <PetsIcon />, moduleCodes: ["PETSHOP_VET", "OPTICAL_LAB", "AUTO_REPAIR_SHOP", "VEHICLE_DEALERSHIP"] },
    ],
  },
  {
    id: "estoque",
    label: "Estoque e Compras",
    tenantTypes: ["BUSINESS"],
    items: [
      { id: "estoque", label: "Estoque", path: "/estoque", icon: <InventoryIcon /> },
      { id: "movimentacoes", label: "Movimentações", path: "/estoque/movimentacoes", icon: <SwapVertIcon /> },
      { id: "ajuste", label: "Ajuste de estoque", path: "/estoque/ajuste", icon: <TuneIcon /> },
      { id: "contagens", label: "Contagens", path: "/estoque/contagens", icon: <FactCheckIcon /> },
      { id: "compras", label: "Compras", path: "/compras", icon: <ShoppingCartIcon /> },
    ],
  },
  {
    id: "financeiro",
    label: "Financeiro",
    tenantTypes: ["BUSINESS", "ACCOUNTING_OFFICE"],
    items: [
      { id: "fluxo", label: "Fluxo de caixa / DRE", path: "/financeiro", icon: <InsightsIcon /> },
      { id: "pagar", label: "Contas a pagar", path: "/financeiro/pagar", icon: <ArrowCircleUpIcon /> },
      { id: "receber", label: "Contas a receber", path: "/financeiro/receber", icon: <ArrowCircleDownIcon /> },
    ],
  },
  {
    id: "servicos",
    label: "Serviços",
    tenantTypes: ["BUSINESS"],
    items: [
      { id: "os", label: "Ordens de Serviço", path: "/os", icon: <BuildIcon />, moduleCodes: ["WORK_ORDER", "TIRE_WARRANTY"] },
      { id: "agenda", label: "Agenda", path: "/agenda", icon: <EventIcon />, moduleCodes: ["SALON_BOOKING", "CAR_WASH_QUEUE", "PETSHOP_VET"] },
      { id: "servicos-cad", label: "Serviços oferecidos", path: "/agenda/servicos", icon: <MiscellaneousServicesIcon />, moduleCodes: ["SALON_BOOKING", "CAR_WASH_QUEUE", "PETSHOP_VET"] },
      { id: "agenda-config", label: "Expediente e comissões", path: "/agenda/configuracoes", icon: <EventIcon />, moduleCodes: ["SALON_BOOKING", "CAR_WASH_QUEUE", "PETSHOP_VET"] },
    ],
  },
  {
    id: "fidelidade",
    label: "Fidelidade",
    tenantTypes: ["BUSINESS"],
    items: [{ id: "fidelidade", label: "Fidelidade e indicação", path: "/fidelidade", icon: <LoyaltyIcon /> }],
  },
  {
    id: "contabilidade",
    label: "Contabilidade",
    items: [{ id: "contabilidade", label: "Escritório contábil", path: "/contabilidade", icon: <AccountBalanceIcon /> }],
  },
  {
    id: "contabilidade-escritorio",
    label: "Minha Carteira",
    tenantTypes: ["ACCOUNTING_OFFICE"],
    items: [
      { id: "carteira-clientes", label: "Carteira de Clientes", path: "/contabilidade/carteira", icon: <AccountBalanceIcon /> },
    ],
  },
  {
    id: "pessoal",
    label: "Filitech Pessoal",
    tenantTypes: ["PERSONAL"],
    items: [
      { id: "pessoal-dashboard", label: "Painel", path: "/pessoal", icon: <DashboardIcon /> },
      { id: "pessoal-carteiras", label: "Contas e carteiras", path: "/pessoal/carteiras", icon: <AccountBalanceWalletIcon /> },
      { id: "pessoal-transacoes", label: "Transações", path: "/pessoal/transacoes", icon: <SwapVertIcon /> },
      { id: "pessoal-recorrencias", label: "Lançamentos recorrentes", path: "/pessoal/recorrencias", icon: <RepeatIcon /> },
      { id: "pessoal-orcamento", label: "Orçamento", path: "/pessoal/orcamento", icon: <PieChartIcon /> },
      { id: "pessoal-metas", label: "Metas", path: "/pessoal/metas", icon: <FlagIcon /> },
      { id: "pessoal-dividas", label: "Dívidas", path: "/pessoal/dividas", icon: <CreditCardIcon /> },
      { id: "pessoal-contas-pagar", label: "Contas a pagar", path: "/pessoal/contas", icon: <ReceiptLongIcon /> },
    ],
  },
  {
    id: "pessoal-patrimonio",
    label: "Patrimônio e Investimentos",
    tenantTypes: ["PERSONAL"],
    items: [
      { id: "pessoal-investimentos", label: "Investimentos", path: "/pessoal/investimentos", icon: <TrendingUpIcon /> },
      { id: "pessoal-patrimonio", label: "Patrimônio líquido", path: "/pessoal/patrimonio", icon: <SavingsIcon /> },
      { id: "pessoal-open-finance", label: "Open Finance", path: "/pessoal/open-finance", icon: <AccountTreeIcon /> },
      { id: "pessoal-carne-leao", label: "Carnê-Leão", path: "/pessoal/carne-leao", icon: <CalculateIcon /> },
    ],
  },
  {
    id: "administracao",
    label: "Administração",
    items: [
      { id: "licenciamento", label: "Licença Mestra", path: "/admin/licenciamento", icon: <VerifiedUserIcon />, roles: ["OWNER"] },
      { id: "hardware", label: "Hardware do PDV", path: "/configuracoes/hardware", icon: <SettingsInputComponentIcon /> },
      { id: "cobranca", label: "Assinatura e Cobrança", path: "/configuracoes/cobranca", icon: <CreditScoreIcon />, roles: ["OWNER", "MANAGER"] },
      { id: "notificacoes", label: "Notificações", path: "/configuracoes/notificacoes", icon: <NotificationsIcon /> },
      // Importação de produtos (Product) só faz sentido para tenants BUSINESS — o
      // grupo "administracao" em si fica sem restrição (outros itens, como
      // Hardware/Notificações, são genéricos a qualquer tipo de tenant), mas estes
      // dois itens específicos recebem `tenantTypes` no próprio NavItem.
      { id: "exportar-dados", label: "Exportar dados", path: "/configuracoes/dados", icon: <CloudDownloadIcon /> },
      { id: "importar-dados", label: "Importar dados", path: "/configuracoes/importar-dados", icon: <CloudUploadIcon />, tenantTypes: ["BUSINESS"] },
    ],
  },
  { id: "mercado", label: "Mercado / Conveniência", tenantTypes: ["BUSINESS"], items: [{ id: "curva-abc", label: "Curva ABC de produtos", path: "/relatorios/curva-abc", icon: <AssessmentIcon /> }] },
  {
    id: "assistencia-tecnica",
    label: "Assistência Técnica",
    tenantTypes: ["BUSINESS"],
    items: [
      { id: "os-relatorios", label: "Relatórios de O.S. (comissão/garantia)", path: "/os/relatorios", icon: <AssessmentIcon />, moduleCode: "WORK_ORDER" },
    ],
  },
  {
    id: "adega",
    label: "Adega / Bebidas",
    tenantTypes: ["BUSINESS"],
    items: [{ id: "cascos", label: "Conta-corrente de cascos", path: "/adega/cascos", icon: <WineBarIcon />, moduleCode: "LIQUOR_LEDGER" }],
  },
  {
    id: "padaria",
    label: "Padaria / Confeitaria",
    tenantTypes: ["BUSINESS"],
    items: [
      { id: "fichas-tecnicas", label: "Fichas Técnicas (BOM)", path: "/fichas-tecnicas", icon: <BakeryDiningIcon />, moduleCode: "RECIPE_BOM" },
      { id: "producao", label: "Produção / perdas", path: "/producao", icon: <DonutLargeIcon />, moduleCode: "RECIPE_BOM" },
    ],
  },
  {
    id: "farmacia",
    label: "Farmácia / Drogaria",
    tenantTypes: ["BUSINESS"],
    items: [
      { id: "receitas", label: "Retenção de receitas", path: "/farmacia/receitas", icon: <LocalPharmacyIcon />, moduleCode: "PHARMACY_SNGPC" },
      { id: "validades", label: "Lotes a vencer", path: "/farmacia/validades", icon: <EventBusyIcon />, moduleCode: "PHARMACY_SNGPC" },
    ],
  },
  {
    id: "varejo",
    label: "Varejo Geral",
    tenantTypes: ["BUSINESS"],
    items: [
      { id: "credito", label: "Conta-corrente (crediário)", path: "/cadastros/clientes/credito", icon: <CreditScoreIcon /> },
      { id: "giro-variantes", label: "Giro de estoque por grade", path: "/varejo/giro-variantes", icon: <PaymentsIcon /> },
    ],
  },
  {
    id: "moda",
    label: "Moda / Calçados",
    tenantTypes: ["BUSINESS"],
    items: [
      { id: "consulta-variantes", label: "Consulta rápida de saldo (grade)", path: "/varejo/consulta-variantes", icon: <InventoryIcon />, moduleCode: "FASHION_VARIANTS" },
      { id: "giro-colecao", label: "Giro por coleção/estação", path: "/relatorios/giro-colecao", icon: <InsightsIcon />, moduleCode: "FASHION_VARIANTS" },
      { id: "trocas", label: "Trocas e crédito de loja", path: "/varejo/trocas", icon: <SwapVertIcon />, moduleCode: "FASHION_VARIANTS" },
    ],
  },
  {
    id: "otica",
    label: "Ótica",
    tenantTypes: ["BUSINESS"],
    items: [
      { id: "optica-laboratorio", label: "Laboratório óptico", path: "/optica/laboratorio", icon: <VisibilityIcon />, moduleCode: "OPTICAL_LAB" },
      { id: "optica-convenios", label: "Convênios", path: "/optica/convenios", icon: <LocalHospitalIcon />, moduleCode: "OPTICAL_LAB" },
    ],
  },
  {
    id: "papelaria",
    label: "Papelaria / Presentes",
    tenantTypes: ["BUSINESS"],
    items: [
      { id: "sazonalidade", label: "Janelas de sazonalidade", path: "/sazonalidade", icon: <CardGiftcardIcon />, moduleCode: "GIFT_PERSONALIZATION" },
      { id: "sazonalidade-liquidacao", label: "Liquidação pós-sazonalidade", path: "/sazonalidade/liquidacao", icon: <CardGiftcardIcon />, moduleCode: "GIFT_PERSONALIZATION" },
      { id: "personalizacao", label: "Personalização (bordado/sublimação)", path: "/personalizacao", icon: <CardGiftcardIcon />, moduleCode: "GIFT_PERSONALIZATION" },
    ],
  },
  {
    id: "material-construcao",
    label: "Material de Construção / Ferragens",
    tenantTypes: ["BUSINESS"],
    items: [
      { id: "ferragens-faturamento", label: "Faturamento mensal (profissionais)", path: "/ferragens/faturamento", icon: <ConstructionIcon />, moduleCode: "CONSTRUCTION_BULK_UNITS" },
    ],
  },
  {
    id: "setor-automotivo",
    label: "Setor Automotivo",
    tenantTypes: ["BUSINESS"],
    items: [
      { id: "pneus-garantia", label: "Garantia de pneus por lote", path: "/pneus/garantia", icon: <TireRepairIcon />, moduleCode: "TIRE_WARRANTY" },
      { id: "estetica-fila", label: "Fila de atendimento (lava-rápido)", path: "/estetica-automotiva/fila", icon: <LocalCarWashIcon />, moduleCode: "CAR_WASH_QUEUE" },
      { id: "oficina-os", label: "Ordens de Serviço (Oficina)", path: "/os", icon: <BuildIcon />, moduleCode: "AUTO_REPAIR_SHOP" },
      { id: "veiculos-estoque", label: "Estoque de veículos (consignação)", path: "/cadastros/prontuarios", icon: <PetsIcon />, moduleCode: "VEHICLE_DEALERSHIP" },
    ],
  },
];

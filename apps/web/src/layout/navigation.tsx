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

export interface NavItem {
  id: string;
  label: string;
  path: string;
  icon: ReactNode;
  // Código do módulo no catálogo (feature gating) — reservado para filtro por módulos ativos do tenant
  moduleCode?: string;
  // Papéis (UserRole) autorizados a ver este item no menu — omitido = visível para todos
  // os papéis autenticados. Usado pela Licença Mestra (Capítulo 2.10), restrita ao Owner.
  roles?: string[];
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "core",
    label: "Geral",
    items: [
      { id: "dashboard", label: "Dashboard", path: "/dashboard", icon: <DashboardIcon /> },
      { id: "pdv", label: "PDV", path: "/pdv", icon: <PointOfSaleIcon /> },
      { id: "caixa", label: "Caixa", path: "/caixa", icon: <PointOfSaleOutlinedIcon /> },
      { id: "comanda", label: "Comanda", path: "/comanda", icon: <ReceiptLongIcon /> },
    ],
  },
  {
    id: "cadastros",
    label: "Cadastros",
    items: [
      { id: "clientes", label: "Clientes", path: "/cadastros/clientes", icon: <PeopleIcon /> },
      { id: "fornecedores", label: "Fornecedores", path: "/cadastros/fornecedores", icon: <LocalShippingIcon /> },
      { id: "produtos", label: "Produtos", path: "/cadastros/produtos", icon: <CategoryIcon /> },
      { id: "prontuarios", label: "Prontuários (pet/veículo/ótica)", path: "/cadastros/prontuarios", icon: <PetsIcon /> },
    ],
  },
  {
    id: "estoque",
    label: "Estoque e Compras",
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
    items: [
      { id: "fluxo", label: "Fluxo de caixa / DRE", path: "/financeiro", icon: <InsightsIcon /> },
      { id: "pagar", label: "Contas a pagar", path: "/financeiro/pagar", icon: <ArrowCircleUpIcon /> },
      { id: "receber", label: "Contas a receber", path: "/financeiro/receber", icon: <ArrowCircleDownIcon /> },
    ],
  },
  {
    id: "servicos",
    label: "Serviços",
    items: [
      { id: "os", label: "Ordens de Serviço", path: "/os", icon: <BuildIcon /> },
      { id: "agenda", label: "Agenda", path: "/agenda", icon: <EventIcon /> },
      { id: "servicos-cad", label: "Serviços oferecidos", path: "/agenda/servicos", icon: <MiscellaneousServicesIcon /> },
      { id: "agenda-config", label: "Expediente e comissões", path: "/agenda/configuracoes", icon: <EventIcon /> },
    ],
  },
  {
    id: "fidelidade",
    label: "Fidelidade",
    items: [{ id: "fidelidade", label: "Fidelidade e indicação", path: "/fidelidade", icon: <LoyaltyIcon /> }],
  },
  {
    id: "contabilidade",
    label: "Contabilidade",
    items: [{ id: "contabilidade", label: "Escritório contábil", path: "/contabilidade", icon: <AccountBalanceIcon /> }],
  },
  {
    id: "administracao",
    label: "Administração",
    items: [
      { id: "licenciamento", label: "Licença Mestra", path: "/admin/licenciamento", icon: <VerifiedUserIcon />, roles: ["OWNER"] },
      { id: "hardware", label: "Hardware do PDV", path: "/configuracoes/hardware", icon: <SettingsInputComponentIcon /> },
    ],
  },
  { id: "mercado", label: "Mercado / Conveniência", items: [{ id: "curva-abc", label: "Curva ABC de produtos", path: "/relatorios/curva-abc", icon: <AssessmentIcon /> }] },
  {
    id: "assistencia-tecnica",
    label: "Assistência Técnica",
    items: [
      { id: "os-relatorios", label: "Relatórios de O.S. (comissão/garantia)", path: "/os/relatorios", icon: <AssessmentIcon />, moduleCode: "WORK_ORDER" },
    ],
  },
  {
    id: "adega",
    label: "Adega / Bebidas",
    items: [{ id: "cascos", label: "Conta-corrente de cascos", path: "/adega/cascos", icon: <WineBarIcon />, moduleCode: "LIQUOR_LEDGER" }],
  },
  {
    id: "padaria",
    label: "Padaria / Confeitaria",
    items: [
      { id: "fichas-tecnicas", label: "Fichas Técnicas (BOM)", path: "/fichas-tecnicas", icon: <BakeryDiningIcon />, moduleCode: "RECIPE_BOM" },
      { id: "producao", label: "Produção / perdas", path: "/producao", icon: <DonutLargeIcon />, moduleCode: "RECIPE_BOM" },
    ],
  },
  {
    id: "farmacia",
    label: "Farmácia / Drogaria",
    items: [
      { id: "receitas", label: "Retenção de receitas", path: "/farmacia/receitas", icon: <LocalPharmacyIcon />, moduleCode: "PHARMACY_SNGPC" },
      { id: "validades", label: "Lotes a vencer", path: "/farmacia/validades", icon: <EventBusyIcon />, moduleCode: "PHARMACY_SNGPC" },
    ],
  },
  {
    id: "varejo",
    label: "Varejo Geral",
    items: [
      { id: "credito", label: "Conta-corrente (crediário)", path: "/cadastros/clientes/credito", icon: <CreditScoreIcon /> },
      { id: "giro-variantes", label: "Giro de estoque por grade", path: "/varejo/giro-variantes", icon: <PaymentsIcon /> },
    ],
  },
  {
    id: "moda",
    label: "Moda / Calçados",
    items: [
      { id: "consulta-variantes", label: "Consulta rápida de saldo (grade)", path: "/varejo/consulta-variantes", icon: <InventoryIcon /> },
      { id: "giro-colecao", label: "Giro por coleção/estação", path: "/relatorios/giro-colecao", icon: <InsightsIcon /> },
      { id: "trocas", label: "Trocas e crédito de loja", path: "/varejo/trocas", icon: <SwapVertIcon /> },
    ],
  },
  {
    id: "otica",
    label: "Ótica",
    items: [
      { id: "optica-laboratorio", label: "Laboratório óptico", path: "/optica/laboratorio", icon: <VisibilityIcon /> },
      { id: "optica-convenios", label: "Convênios", path: "/optica/convenios", icon: <LocalHospitalIcon /> },
    ],
  },
  {
    id: "papelaria",
    label: "Papelaria / Presentes",
    items: [
      { id: "sazonalidade", label: "Janelas de sazonalidade", path: "/sazonalidade", icon: <CardGiftcardIcon /> },
      { id: "sazonalidade-liquidacao", label: "Liquidação pós-sazonalidade", path: "/sazonalidade/liquidacao", icon: <CardGiftcardIcon /> },
      { id: "personalizacao", label: "Personalização (bordado/sublimação)", path: "/personalizacao", icon: <CardGiftcardIcon /> },
    ],
  },
  {
    id: "material-construcao",
    label: "Material de Construção / Ferragens",
    items: [
      { id: "ferragens-faturamento", label: "Faturamento mensal (profissionais)", path: "/ferragens/faturamento", icon: <ConstructionIcon /> },
    ],
  },
  {
    id: "setor-automotivo",
    label: "Setor Automotivo",
    items: [
      { id: "pneus-garantia", label: "Garantia de pneus por lote", path: "/pneus/garantia", icon: <TireRepairIcon /> },
      { id: "estetica-fila", label: "Fila de atendimento (lava-rápido)", path: "/estetica-automotiva/fila", icon: <LocalCarWashIcon /> },
    ],
  },
];

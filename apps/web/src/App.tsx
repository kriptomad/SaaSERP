// apps/web/src/App.tsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { LandingPage } from "./landing/LandingPage";
import { LoginPage } from "./pages/LoginPage";
import { SignupPage } from "./pages/SignupPage";
import { DashboardPage } from "./pages/DashboardPage";
import { PosPage } from "./modules/market/pos/PosPage";
import { SalesHistoryPage } from "./modules/market/sales/SalesHistoryPage";
import { AppShell } from "./layout/AppShell";
import { ClientsPage, SuppliersPage } from "./modules/registrations/PartiesPage";
import { ProductsPage } from "./modules/registrations/ProductsPage";
import { StockPage } from "./modules/stock/StockPage";
import { StockMovementsPage } from "./modules/stock/StockMovementsPage";
import { StockAdjustmentPage } from "./modules/stock/StockAdjustmentPage";
import { InventoryCountsPage } from "./modules/stock/InventoryCountsPage";
import { InventoryCountDetailPage } from "./modules/stock/InventoryCountDetailPage";
import { PurchaseOrdersPage } from "./modules/purchasing/PurchaseOrdersPage";
import { PurchaseOrderFormPage } from "./modules/purchasing/PurchaseOrderFormPage";
import { PurchaseOrderDetailPage } from "./modules/purchasing/PurchaseOrderDetailPage";
import { NfeXmlImportPage } from "./modules/purchasing/NfeXmlImportPage";
import { CashRegisterPage } from "./modules/cash-register/CashRegisterPage";
import { PayablesPage, ReceivablesPage } from "./modules/financial/AccountsPage";
import { FinancialDashboardPage } from "./modules/financial/FinancialDashboardPage";
import { WorkOrdersPage } from "./modules/work-orders/WorkOrdersPage";
import { WorkOrderDetailPage } from "./modules/work-orders/WorkOrderDetailPage";
import { AppointmentsPage } from "./modules/scheduling/AppointmentsPage";
import { ServicesPage } from "./modules/scheduling/ServicesPage";
import { ProfessionalScheduleSettingsPage } from "./modules/scheduling/ProfessionalScheduleSettingsPage";
import { LoyaltyPage } from "./modules/loyalty/LoyaltyPage";
import { ComandaPage } from "./modules/comanda/ComandaPage";
import { ClientRecordsPage } from "./modules/client-records/ClientRecordsPage";
import { OpticalLabPage } from "./modules/optical/OpticalLabPage";
import { HealthInsurancePage } from "./modules/optical/HealthInsurancePage";
import { AccountingOfficePage } from "./modules/accounting-office/AccountingOfficePage";
import { FirmPortfolioPage } from "./modules/accounting-office/FirmPortfolioPage";
import { LicensingPage } from "./modules/licensing/LicensingPage";
import { HardwarePage } from "./modules/settings/HardwarePage";
import { BillingPage } from "./modules/settings/BillingPage";
import { NotificationSettingsPage } from "./modules/notifications/NotificationSettingsPage";
import { DataExportPage } from "./modules/settings/DataExportPage";
import { DataImportWizardPage } from "./modules/settings/DataImportWizardPage";
import { AbcCurveReportPage } from "./modules/reports/AbcCurveReportPage";
import { WorkOrderReportsPage } from "./modules/work-orders/WorkOrderReportsPage";
import { LiquorLedgerPage } from "./modules/liquor-ledger/LiquorLedgerPage";
import { RecipesPage } from "./modules/recipes/RecipesPage";
import { ProductionBatchPage } from "./modules/recipes/ProductionBatchPage";
import { PrescriptionRecordsPage } from "./modules/pharmacy/PrescriptionRecordsPage";
import { ExpiringBatchesPage } from "./modules/pharmacy/ExpiringBatchesPage";
import { ClientCreditStatementPage } from "./modules/registrations/ClientCreditStatementPage";
import { VariantTurnoverReportPage } from "./modules/product-variants/VariantTurnoverReportPage";
import { VariantQuickLookupPage } from "./modules/product-variants/VariantQuickLookupPage";
import { CollectionTurnoverReportPage } from "./modules/reports/CollectionTurnoverReportPage";
import { ExchangesPage } from "./modules/exchanges/ExchangesPage";
import { PublicBookingPage } from "./modules/public-booking/PublicBookingPage";
import { SeasonalityWindowsPage } from "./modules/seasonality/SeasonalityWindowsPage";
import { SeasonalClearanceReportPage } from "./modules/seasonality/SeasonalClearanceReportPage";
import { PersonalizationOrdersPage } from "./modules/personalization/PersonalizationOrdersPage";
import { BusinessAccountInvoicePage } from "./modules/construction/BusinessAccountInvoicePage";
import { TireWarrantyPage } from "./modules/tires/TireWarrantyPage";
import { CarWashQueuePage } from "./modules/car-wash/CarWashQueuePage";
import { PlatformAdminAuthProvider, usePlatformAdminAuth } from "./modules/platform-admin/PlatformAdminAuthContext";
import { PlatformAdminLoginPage } from "./modules/platform-admin/PlatformAdminLoginPage";
import { PlatformAdminShell } from "./modules/platform-admin/PlatformAdminShell";
import { InfrastructureSettingsPage } from "./modules/platform-admin/InfrastructureSettingsPage";
import { MarketingAdminPage } from "./modules/platform-admin/MarketingAdminPage";
import { TenantListPage } from "./modules/platform-admin/TenantListPage";
import { TenantDetailPage } from "./modules/platform-admin/TenantDetailPage";
import { RevenueDashboardPage } from "./modules/platform-admin/RevenueDashboardPage";
import { ModuleCatalogPage } from "./modules/platform-admin/ModuleCatalogPage";
import { AuditLogViewerPage } from "./modules/platform-admin/AuditLogViewerPage";
import { SystemParametersPage } from "./modules/platform-admin/SystemParametersPage";
import { DatabaseBackupsPage } from "./modules/platform-admin/DatabaseBackupsPage";
import { PersonalDashboardPage } from "./modules/personal-finance/PersonalDashboardPage";
import { PersonalAccountsPage } from "./modules/personal-finance/PersonalAccountsPage";
import { PersonalTransactionsPage } from "./modules/personal-finance/PersonalTransactionsPage";
import { PersonalRecurrenceRulesPage } from "./modules/personal-finance/PersonalRecurrenceRulesPage";
import { PersonalBudgetPage } from "./modules/personal-finance/PersonalBudgetPage";
import { PersonalGoalsPage } from "./modules/personal-finance/PersonalGoalsPage";
import { PersonalDebtsPage } from "./modules/personal-finance/PersonalDebtsPage";
import { PersonalInvestmentsPage } from "./modules/personal-finance/PersonalInvestmentsPage";
import { PersonalBillsPage } from "./modules/personal-finance/PersonalBillsPage";
import { PersonalNetWorthPage } from "./modules/personal-finance/PersonalNetWorthPage";
import { PersonalOpenFinanceConsentsPage } from "./modules/personal-finance/PersonalOpenFinanceConsentsPage";
import { PersonalTaxToolsPage } from "./modules/personal-finance/PersonalTaxToolsPage";

function RequireAuth({ children }: { children: JSX.Element }) {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? children : <Navigate to="/login" replace />;
}

function RequireOwner({ children }: { children: JSX.Element }) {
  const { user } = useAuth();
  return user?.role === "OWNER" ? children : <Navigate to="/dashboard" replace />;
}

function RequirePlatformAdminAuth({ children }: { children: JSX.Element }) {
  const { isAuthenticated } = usePlatformAdminAuth();
  return isAuthenticated ? children : <Navigate to="/platform-admin/login" replace />;
}

export function App() {
  return (
    <AuthProvider>
      <PlatformAdminAuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            {/* Pública, sem auth: Cap. 11.6 — agendamento online self-service */}
            <Route path="/agendar/:tenantSlug" element={<PublicBookingPage />} />
            <Route path="/platform-admin/login" element={<PlatformAdminLoginPage />} />
            <Route
              element={
                <RequirePlatformAdminAuth>
                  <PlatformAdminShell />
                </RequirePlatformAdminAuth>
              }
            >
              <Route path="/platform-admin/infraestrutura" element={<InfrastructureSettingsPage />} />
              <Route path="/platform-admin/marketing" element={<MarketingAdminPage />} />
              <Route path="/platform-admin/tenants" element={<TenantListPage />} />
              <Route path="/platform-admin/tenants/:id" element={<TenantDetailPage />} />
              <Route path="/platform-admin/receita" element={<RevenueDashboardPage />} />
              <Route path="/platform-admin/modulos" element={<ModuleCatalogPage />} />
              <Route path="/platform-admin/audit-log" element={<AuditLogViewerPage />} />
              <Route path="/platform-admin/parametros" element={<SystemParametersPage />} />
              <Route path="/platform-admin/backups" element={<DatabaseBackupsPage />} />
            </Route>
            <Route
            element={
              <RequireAuth>
                <AppShell />
              </RequireAuth>
            }
          >
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/pdv" element={<PosPage />} />
            <Route path="/pdv/vendas" element={<SalesHistoryPage />} />
            <Route path="/cadastros/clientes" element={<ClientsPage />} />
            <Route path="/cadastros/fornecedores" element={<SuppliersPage />} />
            <Route path="/cadastros/produtos" element={<ProductsPage />} />
            <Route path="/estoque" element={<StockPage />} />
            <Route path="/estoque/movimentacoes" element={<StockMovementsPage />} />
            <Route path="/estoque/ajuste" element={<StockAdjustmentPage />} />
            <Route path="/estoque/contagens" element={<InventoryCountsPage />} />
            <Route path="/estoque/contagens/:id" element={<InventoryCountDetailPage />} />
            <Route path="/compras" element={<PurchaseOrdersPage />} />
            <Route path="/compras/nova" element={<PurchaseOrderFormPage />} />
            <Route path="/compras/importar-xml" element={<NfeXmlImportPage />} />
            <Route path="/compras/:id" element={<PurchaseOrderDetailPage />} />
            <Route path="/caixa" element={<CashRegisterPage />} />
            <Route path="/financeiro" element={<FinancialDashboardPage />} />
            <Route path="/financeiro/pagar" element={<PayablesPage />} />
            <Route path="/financeiro/receber" element={<ReceivablesPage />} />
            <Route path="/os" element={<WorkOrdersPage />} />
            <Route path="/os/:id" element={<WorkOrderDetailPage />} />
            <Route path="/agenda" element={<AppointmentsPage />} />
            <Route path="/agenda/servicos" element={<ServicesPage />} />
            <Route path="/agenda/configuracoes" element={<ProfessionalScheduleSettingsPage />} />
            <Route path="/fidelidade" element={<LoyaltyPage />} />
            <Route path="/comanda" element={<ComandaPage />} />
            <Route path="/cadastros/prontuarios" element={<ClientRecordsPage />} />
            <Route path="/contabilidade" element={<AccountingOfficePage />} />
            <Route path="/contabilidade/carteira" element={<FirmPortfolioPage />} />
            <Route path="/configuracoes/hardware" element={<HardwarePage />} />
            <Route path="/configuracoes/cobranca" element={<BillingPage />} />
            <Route path="/configuracoes/notificacoes" element={<NotificationSettingsPage />} />
            <Route path="/configuracoes/dados" element={<DataExportPage />} />
            <Route path="/configuracoes/importar-dados" element={<DataImportWizardPage />} />
            <Route path="/relatorios/curva-abc" element={<AbcCurveReportPage />} />
            <Route path="/os/relatorios" element={<WorkOrderReportsPage />} />
            <Route path="/adega/cascos" element={<LiquorLedgerPage />} />
            <Route path="/fichas-tecnicas" element={<RecipesPage />} />
            <Route path="/producao" element={<ProductionBatchPage />} />
            <Route path="/farmacia/receitas" element={<PrescriptionRecordsPage />} />
            <Route path="/farmacia/validades" element={<ExpiringBatchesPage />} />
            <Route path="/cadastros/clientes/credito" element={<ClientCreditStatementPage />} />
            <Route path="/varejo/giro-variantes" element={<VariantTurnoverReportPage />} />
            <Route path="/varejo/consulta-variantes" element={<VariantQuickLookupPage />} />
            <Route path="/relatorios/giro-colecao" element={<CollectionTurnoverReportPage />} />
            <Route path="/varejo/trocas" element={<ExchangesPage />} />
            <Route path="/optica/laboratorio" element={<OpticalLabPage />} />
            <Route path="/optica/convenios" element={<HealthInsurancePage />} />
            <Route path="/sazonalidade" element={<SeasonalityWindowsPage />} />
            <Route path="/sazonalidade/liquidacao" element={<SeasonalClearanceReportPage />} />
            <Route path="/personalizacao" element={<PersonalizationOrdersPage />} />
            <Route path="/ferragens/faturamento" element={<BusinessAccountInvoicePage />} />
            <Route path="/pneus/garantia" element={<TireWarrantyPage />} />
            <Route path="/estetica-automotiva/fila" element={<CarWashQueuePage />} />
            <Route path="/pessoal" element={<PersonalDashboardPage />} />
            <Route path="/pessoal/carteiras" element={<PersonalAccountsPage />} />
            <Route path="/pessoal/transacoes" element={<PersonalTransactionsPage />} />
            <Route path="/pessoal/recorrencias" element={<PersonalRecurrenceRulesPage />} />
            <Route path="/pessoal/orcamento" element={<PersonalBudgetPage />} />
            <Route path="/pessoal/metas" element={<PersonalGoalsPage />} />
            <Route path="/pessoal/dividas" element={<PersonalDebtsPage />} />
            <Route path="/pessoal/investimentos" element={<PersonalInvestmentsPage />} />
            <Route path="/pessoal/contas" element={<PersonalBillsPage />} />
            <Route path="/pessoal/patrimonio" element={<PersonalNetWorthPage />} />
            <Route path="/pessoal/open-finance" element={<PersonalOpenFinanceConsentsPage />} />
            <Route path="/pessoal/carne-leao" element={<PersonalTaxToolsPage />} />
            <Route
              path="/admin/licenciamento"
              element={
                <RequireOwner>
                  <LicensingPage />
                </RequireOwner>
              }
            />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      </PlatformAdminAuthProvider>
    </AuthProvider>
  );
}

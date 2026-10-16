// apps/api/src/server.ts
// Entrada real da API — monta Express, middlewares de segurança (Capítulo 3), auth
// (Capítulo 3.5), contexto de tenant (Capítulo 7.1) e tenant lockout (Capítulo 2).
import "dotenv/config";
import express from "express";
import "express-async-errors";
import cors from "cors";
import helmet from "helmet";
import { logger } from "./lib/logger";
import { authMiddleware, requireAuth } from "./middlewares/auth.middleware";
import { tenantContextMiddleware } from "./middlewares/tenant-context.middleware";
import { tenantLockoutMiddleware } from "./middlewares/tenant-lockout.middleware";
import { authRouter } from "./modules/auth/auth.routes";
import { stripeWebhookRouter, asaasWebhookRouter } from "./modules/billing/webhooks.routes";
import { ifoodWebhookRouter } from "./modules/integrations/ifood-webhook.routes";
import { modulesRouter } from "./modules/billing/modules.routes";
import { subscriptionRouter } from "./modules/billing/subscription.routes";
import { checkoutRouter } from "./modules/billing/checkout.routes";
import { salesRouter } from "./modules/sales/sales.routes";
import { usersRouter } from "./modules/users/users.routes";
import { productsRouter } from "./modules/products/products.routes";
import { integrationCredentialsRouter } from "./modules/integrations/integration-credentials.routes";
import { tenantIntegrationsRouter } from "./modules/integrations/tenant-integrations.routes";
import { personalAccountsRouter } from "./modules/personal-finance/personal-accounts.routes";
import { personalPlanningRouter } from "./modules/personal-finance/personal-planning.routes";
import { personalInvestmentsRouter } from "./modules/personal-finance/personal-investments.routes";
import { personalTaxToolsRouter } from "./modules/personal-finance/personal-tax-tools.routes";
import { purchaseOrdersRouter } from "./modules/purchasing/purchase-orders.routes";
import { nfeXmlImportRouter } from "./modules/purchasing/nfe-xml-import.routes";
import { labelPrintersRouter } from "./modules/catalog/label-printers.routes";
import { globalSearchRouter } from "./modules/search/global-search.routes";
import { inventoryCountRouter } from "./modules/purchasing/inventory-count.routes";
import { schedulingRouter } from "./modules/scheduling/scheduling.routes";
import { comandaRouter } from "./modules/comanda/comanda.routes";
import { publicBookingRouter } from "./modules/public-booking/public-booking.routes";
import { publicOnlineStoreRouter } from "./modules/online-store/public-online-store.routes";
import { publicApiRouter } from "./modules/integrations/public-api.routes";
import { onlineStoreRouter } from "./modules/online-store/online-store.routes";
import { clientRecordsRouter } from "./modules/client-records/client-records.routes";
import { platformAdminAuthRouter } from "./modules/platform-admin/platform-admin-auth.routes";
import { platformAdminAuthMiddleware } from "./modules/platform-admin/platform-admin-auth.middleware";
import { platformAdminRouter } from "./modules/platform-admin/platform-admin.routes";
import { platformSecretsRouter } from "./modules/platform-admin/platform-secrets.routes";
import { databaseBackupsRouter } from "./modules/platform-admin/database-backups.routes";
import { multiFilialRouter } from "./modules/multi-filial/multi-filial.routes";
import { supportTicketsRouter } from "./modules/support-tickets/support-tickets.routes";
import { fiscalCodeCatalogRouter } from "./modules/fiscal/fiscal-code-catalog.routes";
import { ibsCbsRegimeElectionRouter } from "./modules/fiscal/ibs-cbs-regime-election.routes";
import { fiscalDocumentsRouter } from "./modules/fiscal/fiscal-documents.routes";
import { cashRegisterRouter } from "./modules/cash-register/cash-register.routes";
import { notificationsRouter } from "./modules/notifications/notifications.routes";
import { clientsRouter } from "./modules/clients/clients.routes";
import { suppliersRouter } from "./modules/suppliers/suppliers.routes";
import { workOrdersRouter } from "./modules/work-orders/work-orders.routes";
import { storageRouter } from "./modules/storage/storage.routes";
import { recipesRouter } from "./modules/recipes/recipes.routes";
import { stockRouter } from "./modules/stock/stock.routes";
import { financialRouter } from "./modules/financial/financial.routes";
import { bankReconciliationRouter } from "./modules/financial/bank-reconciliation.routes";
import { pluggyWebhookRouter } from "./modules/financial/pluggy-webhook.routes";
import { reportsRouter } from "./modules/reports/reports.routes";
import { accountingOfficeRouter } from "./modules/accounting-office/accounting-office.routes";
import { loyaltyRouter } from "./modules/loyalty/loyalty.routes";
import { productVariantsRouter } from "./modules/catalog/product-variants.routes";
import { productExchangesRouter } from "./modules/catalog/product-exchanges.routes";
import { notificationSettingsRouter } from "./modules/notifications/notification-settings.routes";
import { marketingAdminRouter } from "./modules/platform-admin/marketing.routes";
import { tefRouter } from "./modules/hardware/tef/tef.routes";
import { licensingRouter } from "./modules/licensing/licensing.routes";
import { workOrderReportsRouter } from "./modules/work-orders/work-order-reports.routes";
import { liquorLedgerRouter } from "./modules/liquor-ledger/liquor-ledger.routes";
import { seasonalityRouter } from "./modules/catalog/seasonality.routes";
import { personalizationRouter } from "./modules/personalization/personalization.routes";
import { businessAccountsRouter } from "./modules/construction/business-accounts.routes";
import { constructionQuotesRouter } from "./modules/construction/construction-quotes.routes";
import { materialDeliveriesRouter } from "./modules/construction/material-deliveries.routes";
import { tireWarrantyRouter } from "./modules/tires/tire-warranty.routes";
import { tireServiceOrdersRouter } from "./modules/tires/tire-service-orders.routes";
import { carWashQueueRouter } from "./modules/car-wash/car-wash-queue.routes";
import { carWashServiceRouter } from "./modules/car-wash/car-wash-service.routes";
import { dataExportRouter } from "./modules/data-portability/data-export.routes";
import { dataImportRouter } from "./modules/data-portability/data-import.routes";
import { productPricingRouter } from "./modules/catalog/product-pricing.routes";
import { variantTurnoverRouter } from "./modules/catalog/variant-turnover.routes";
import { prescriptionRecordsRouter } from "./modules/pharmacy/prescription-records.routes";
import { clientCreditPaymentsRouter } from "./modules/clients/credit-payments.routes";
import { opticalLabWorkOrdersRouter } from "./modules/optical/optical-lab-work-orders.routes";
import { healthInsurancePlansRouter } from "./modules/optical/health-insurance-plans.routes";
import { healthInsuranceBillingRouter } from "./modules/optical/health-insurance-billing.routes";
import { lookupRouter } from "./modules/lookup/lookup.routes";
import { systemStatusRouter } from "./modules/platform-admin/system-status.routes";
import { prismaUnscoped } from "@filitech/db";
import { redis } from "./lib/redis";
import { getPlatformSecret } from "./lib/platform-secrets";

const app = express();

// Railway e Vercel terminam TLS/proxy antes da aplicação — sem isso, `req.ip`
// retornaria o IP interno do proxy reverso, nunca o IP real do cliente, quebrando
// silenciosamente qualquer lógica dependente de IP (allowlist de admin, Capítulo
// 14.5; rate limit e AuditLog por IP, Capítulo 14.4).
app.set("trust proxy", true);

app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      getPlatformSecret("CORS_ORIGIN")
        .then((raw) => {
          const allowedOrigins = raw?.split(",").map((o) => o.trim()).filter(Boolean) ?? null;
          if (!origin) {
            // Sem header Origin (requisição server-to-server, curl, apps mobile/
            // desktop) — não é uma requisição de navegador cross-origin, libera.
            return callback(null, true);
          }
          if (allowedOrigins && allowedOrigins.includes(origin)) {
            return callback(null, true);
          }
          // CORREÇÃO (mega-audit rodada 5 — crítico de segurança): antes, quando
          // CORS_ORIGIN não estava configurado (nem painel, nem env), o código
          // liberava QUALQUER origem com `credentials: true`. Como o pacote `cors`
          // reflete o header `Origin` da requisição (nunca usa `*` com
          // credentials), isso permitia que qualquer site arbitrário fizesse
          // requisições autenticadas (com cookies/sessão) ao backend — uma falha
          // clássica de CORS mal configurado equivalente a CSRF amplo. Agora,
          // falha FECHADO: sem allowlist configurada, nenhuma origem de navegador
          // é aceita (apenas requisições sem header Origin continuam liberadas).
          return callback(new Error("Origem não permitida pela política de CORS."));
        })
        .catch((err) => callback(err as Error));
    },
    credentials: true,
  }),
);

// Webhooks de billing — montados ANTES do express.json() global porque o Stripe
// exige o corpo bruto (Buffer) para validar a assinatura HMAC (Capítulo 2.7/20.1).
// Escopados por path exato para não "sequestrar" o parsing de corpo de outras rotas.
app.use("/webhooks/stripe", express.raw({ type: "application/json" }));
app.use("/webhooks/asaas", express.json({ limit: "2mb" }));
app.use("/webhooks/ifood", express.raw({ type: "application/json" }));
app.use("/webhooks/pluggy", express.json({ limit: "2mb" }));
app.use(stripeWebhookRouter);
app.use(asaasWebhookRouter);
app.use(ifoodWebhookRouter);
app.use(pluggyWebhookRouter);

app.use(express.json({ limit: "2mb" }));

// Health check — usado pelo Railway/Docker/Vercel para liveness/readiness probes, e
// também pelo dashboard do Filitech ERP Desktop (apps/desktop) em modo HOST para medir
// saúde do backend local. Inclui Redis (fila BullMQ) para o dashboard não precisar de
// um endpoint dedicado só para isso.
app.get("/health", async (_req, res) => {
  const result: { status: string; database: string; redis: string; timestamp: string; error?: string } = {
    status: "ok",
    database: "unknown",
    redis: "unknown",
    timestamp: new Date().toISOString(),
  };
  try {
    await prismaUnscoped.$queryRaw`SELECT 1`;
    result.database = "up";
  } catch (error) {
    result.status = "degraded";
    result.database = "down";
    result.error = (error as Error).message;
  }
  result.redis = redis.status === "ready" ? "up" : "down";
  res.status(result.database === "up" ? 200 : 503).json(result);
});

// Rotas públicas (signup/login) — não passam por auth/tenant middlewares.
app.use("/auth", authRouter);

// Consulta pública de CEP/CNPJ (ViaCEP/BrasilAPI) — usada no onboarding, antes do
// usuário ter qualquer sessão. Rate-limitada por IP dentro do próprio router.
app.use(lookupRouter);

// Capítulo 11.6 — Agenda Online pública (sem autenticação, tenant resolvido por
// slug na própria URL): precisa vir antes de authMiddleware/tenantContextMiddleware,
// nunca exigir sessão de tenant para o cliente final agendar sozinho.
app.use(publicBookingRouter);
app.use(publicOnlineStoreRouter);

// Capítulo 15.4 — API REST pública self-service dos tenants (integrações
// externas: e-commerce, ERP contábil parceiro), autenticada por TenantApiKey
// via requireApiKey (não por cookie/JWT de sessão). Aplica sua própria cadeia
// de tenantContextMiddleware/tenantLockoutMiddleware por rota (ver header do
// arquivo) — por isso também vem antes do authMiddleware global de sessão.
app.use(publicApiRouter);

// Autenticação do painel de plataforma (SUPER_ADMIN) — sistema de sessão totalmente
// separado do tenant (Capítulo 14.2), com seu próprio esquema JWT de 3 audiences.
// authMiddleware/tenantContextMiddleware/tenantLockoutMiddleware abaixo são no-ops
// quando não há req.session de tenant, então esta rota segue sem qualquer tenant.
//
// CORREÇÃO (mega-audit rodada 5): `platformAdminAuthMiddleware` DEVE ser montado
// ANTES de `platformAdminAuthRouter` — este último contém tanto rotas públicas
// (login, 2FA, reset de senha) quanto rotas protegidas por sessão (listar/revogar
// sessões ativas, CRUD da allowlist de IP, via `requireSession`). Com a ordem
// antiga invertida, `req.platformAdminSession` NUNCA era preenchido para essas
// rotas protegidas (sempre 401 "sessão ausente", mesmo com token válido) — a
// allowlist de IP ficava, na prática, inacessível/não administrável pela própria
// UI. O middleware é seguro para rodar incondicionalmente antes das rotas
// públicas: ele nunca bloqueia a requisição (sempre chama `next()`), apenas
// popula `req.platformAdminSession` quando há um Bearer token válido e não
// revogado — rotas de login/2FA/reset seguem funcionando normalmente sem sessão.
app.use(platformAdminAuthMiddleware);
app.use(platformAdminAuthRouter);
app.use(platformAdminRouter);
app.use(platformSecretsRouter);
app.use(systemStatusRouter);
app.use(databaseBackupsRouter);

// A partir daqui, toda rota é tenant-aware: auth -> contexto de tenant -> lockout -> requireAuth.
app.use(authMiddleware);
app.use(tenantContextMiddleware);
app.use(tenantLockoutMiddleware);

// multiFilialRouter e supportTicketsRouter usam apenas requireAuth (sessão de
// tenant), então precisam vir DEPOIS da cadeia acima — caso contrário chegam sem
// req.session (401 incorreto) e não recebem o lockout 402 global (gap achado em
// mega-audit rodada 3).
app.use(multiFilialRouter);
app.use(supportTicketsRouter);

app.get("/me", requireAuth, (req, res) => {
  res.json({ session: req.session });
});

app.use(modulesRouter);
app.use(subscriptionRouter);
app.use(checkoutRouter);
app.use(salesRouter);
app.use(usersRouter);
app.use(productsRouter);
app.use(integrationCredentialsRouter);
app.use(tenantIntegrationsRouter);
app.use(personalAccountsRouter);
app.use(personalPlanningRouter);
app.use(personalInvestmentsRouter);
app.use(personalTaxToolsRouter);
app.use(purchaseOrdersRouter);
app.use(nfeXmlImportRouter);
app.use(labelPrintersRouter);
app.use(globalSearchRouter);
app.use(inventoryCountRouter);
app.use(schedulingRouter);
app.use(comandaRouter);
app.use(clientRecordsRouter);
app.use(fiscalCodeCatalogRouter);
app.use(ibsCbsRegimeElectionRouter);
app.use(fiscalDocumentsRouter);
app.use(cashRegisterRouter);
app.use(notificationsRouter);
app.use(clientsRouter);
app.use(suppliersRouter);
app.use(workOrdersRouter);
app.use(storageRouter);
app.use(recipesRouter);
app.use(stockRouter);
app.use(financialRouter);
app.use(bankReconciliationRouter);
app.use(reportsRouter);
app.use(accountingOfficeRouter);
app.use(loyaltyRouter);
app.use(productVariantsRouter);
app.use(productExchangesRouter);
app.use(notificationSettingsRouter);
app.use(marketingAdminRouter);
app.use(tefRouter);
app.use(licensingRouter);
app.use(workOrderReportsRouter);
app.use(liquorLedgerRouter);
app.use(productPricingRouter);
app.use(variantTurnoverRouter);
app.use(prescriptionRecordsRouter);
app.use(clientCreditPaymentsRouter);
app.use(opticalLabWorkOrdersRouter);
app.use(healthInsurancePlansRouter);
app.use(healthInsuranceBillingRouter);
app.use(seasonalityRouter);
app.use(personalizationRouter);
app.use(businessAccountsRouter);
app.use(constructionQuotesRouter);
app.use(materialDeliveriesRouter);
app.use(tireWarrantyRouter);
app.use(tireServiceOrdersRouter);
app.use(carWashQueueRouter);
app.use(carWashServiceRouter);
app.use(dataExportRouter);
app.use(dataImportRouter);
app.use(onlineStoreRouter);

app.use((_req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Rota não encontrada." } });
});

// Error-handling middleware global — GAP DE AUDITORIA ENCONTRADO E CORRIGIDO:
// o Express 4 NÃO captura rejeições de Promise lançadas dentro de handlers
// `async` automaticamente; sem `express-async-errors` (importado acima, que
// faz o patch necessário encaminhando o erro para `next(err)`) e sem este
// middleware de 4 argumentos, qualquer exceção não prevista por um `try/catch`
// específico de rota (ex.: banco de dados indisponível, erro de rede) virava
// uma "unhandledRejection" e DERRUBAVA O PROCESSO INTEIRO — tirando do ar
// TODOS os tenants, não só a requisição que falhou. Descoberto ao testar
// `POST /work-orders/budget-approval/:token` (rota pública, sem `requireAuth`,
// chamada pelo link do WhatsApp) sem banco de dados disponível: o processo
// Node morria em vez de responder 500/503. Agora toda exceção não tratada
// retorna um envelope JSON consistente, e o processo continua no ar.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, "unhandled-error");
  if (res.headersSent) {
    return;
  }
  res.status(500).json({
    success: false,
    data: null,
    error: { code: "INTERNAL_ERROR", message: "Erro interno inesperado. Nossa equipe já foi notificada." },
  });
});

// PORT/HOST configuráveis — HOST permite ao Filitech ERP Desktop (modo HOST) fazer bind
// num IP específico da LAN em vez de todas as interfaces, conforme a tela de config de
// rede (apps/desktop/src/screens/HostNetworkConfig.tsx).
const PORT = Number(process.env.PORT ?? 3333);
const HOST = process.env.HOST ?? "0.0.0.0";
// Em NODE_ENV=test (suíte de integração via supertest, ex.: tests/tenant-isolation.test.ts)
// o app é importado sem subir um listener de verdade — evita porta ocupada/EADDRINUSE
// quando vários arquivos de teste importam o módulo em paralelo.
if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, HOST, () => {
    logger.info({ port: PORT, host: HOST }, "filitech-api ouvindo");
  });
}

export { app };

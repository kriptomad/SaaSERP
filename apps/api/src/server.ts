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
import { inventoryCountRouter } from "./modules/purchasing/inventory-count.routes";
import { schedulingRouter } from "./modules/scheduling/scheduling.routes";
import { comandaRouter } from "./modules/comanda/comanda.routes";
import { publicBookingRouter } from "./modules/public-booking/public-booking.routes";
import { clientRecordsRouter } from "./modules/client-records/client-records.routes";
import { platformAdminAuthRouter } from "./modules/platform-admin/platform-admin-auth.routes";
import { platformAdminAuthMiddleware } from "./modules/platform-admin/platform-admin-auth.middleware";
import { platformAdminRouter } from "./modules/platform-admin/platform-admin.routes";
import { platformSecretsRouter } from "./modules/platform-admin/platform-secrets.routes";
import { fiscalCodeCatalogRouter } from "./modules/fiscal/fiscal-code-catalog.routes";
import { ibsCbsRegimeElectionRouter } from "./modules/fiscal/ibs-cbs-regime-election.routes";
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
import { tireWarrantyRouter } from "./modules/tires/tire-warranty.routes";
import { carWashQueueRouter } from "./modules/car-wash/car-wash-queue.routes";
import { productPricingRouter } from "./modules/catalog/product-pricing.routes";
import { variantTurnoverRouter } from "./modules/catalog/variant-turnover.routes";
import { prescriptionRecordsRouter } from "./modules/pharmacy/prescription-records.routes";
import { clientCreditPaymentsRouter } from "./modules/clients/credit-payments.routes";
import { opticalLabWorkOrdersRouter } from "./modules/optical/optical-lab-work-orders.routes";
import { healthInsurancePlansRouter } from "./modules/optical/health-insurance-plans.routes";
import { healthInsuranceBillingRouter } from "./modules/optical/health-insurance-billing.routes";
import { prismaUnscoped } from "@filitech/db";
import { redis } from "./lib/redis";
import { getPlatformSecret } from "./lib/platform-secrets";

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      getPlatformSecret("CORS_ORIGIN")
        .then((raw) => {
          const allowedOrigins = raw?.split(",") ?? null;
          if (!allowedOrigins) {
            // Sem valor configurado (nem no painel, nem via env) — libera qualquer
            // origem (*), igual ao comportamento histórico pré-painel admin.
            return callback(null, true);
          }
          if (!origin || allowedOrigins.includes(origin)) {
            return callback(null, true);
          }
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

// Capítulo 11.6 — Agenda Online pública (sem autenticação, tenant resolvido por
// slug na própria URL): precisa vir antes de authMiddleware/tenantContextMiddleware,
// nunca exigir sessão de tenant para o cliente final agendar sozinho.
app.use(publicBookingRouter);

// Autenticação do painel de plataforma (SUPER_ADMIN) — sistema de sessão totalmente
// separado do tenant (Capítulo 14.2), com seu próprio esquema JWT de 3 audiences.
// authMiddleware/tenantContextMiddleware/tenantLockoutMiddleware abaixo são no-ops
// quando não há req.session de tenant, então esta rota segue sem qualquer tenant.
app.use(platformAdminAuthRouter);
app.use(platformAdminAuthMiddleware);
app.use(platformAdminRouter);
app.use(platformSecretsRouter);

// A partir daqui, toda rota é tenant-aware: auth -> contexto de tenant -> lockout -> requireAuth.
app.use(authMiddleware);
app.use(tenantContextMiddleware);
app.use(tenantLockoutMiddleware);

app.get("/me", requireAuth, (req, res) => {
  res.json({ session: req.session });
});

app.use(modulesRouter);
app.use(subscriptionRouter);
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
app.use(inventoryCountRouter);
app.use(schedulingRouter);
app.use(comandaRouter);
app.use(clientRecordsRouter);
app.use(fiscalCodeCatalogRouter);
app.use(ibsCbsRegimeElectionRouter);
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
app.use(tireWarrantyRouter);
app.use(carWashQueueRouter);

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
app.listen(PORT, HOST, () => {
  logger.info({ port: PORT, host: HOST }, "filitech-api ouvindo");
});

// apps/api/src/server.ts
// Entrada real da API — monta Express, middlewares de segurança (Capítulo 3), auth
// (Capítulo 3.5), contexto de tenant (Capítulo 7.1) e tenant lockout (Capítulo 2).
import "dotenv/config";
// fa-w5-boot-no-central-env-validation: precisa ser o PRIMEIRO import depois de
// `dotenv/config` — roda como efeito colateral de import (ver comentário completo
// em lib/env-validation.ts) e precisa avaliar ANTES de qualquer import abaixo que
// transitivamente dispare as checagens ad-hoc de lib/redis.ts, lib/queue.ts ou
// lib/jwt-keys.ts, para que a lista agregada de problemas apareça de uma vez.
import "./lib/env-validation";
import express from "express";
import "express-async-errors";
import cors from "cors";
import helmet from "helmet";
import { logger } from "./lib/logger";
import { initSentry, Sentry } from "./lib/sentry";
import { installProcessCrashGuards } from "./lib/process-guards";
import { requestIdMiddleware } from "./middlewares/request-id.middleware";
import { metricsMiddleware, metricsRouter } from "./lib/metrics";
import { authMiddleware, requireAuth, impersonationAuditMiddleware } from "./middlewares/auth.middleware";
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
import { dataDeletionRequestRouter } from "./modules/data-portability/data-deletion-request.routes";
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
import { closeAllSseConnections } from "./lib/sse";
import { getPlatformSecret } from "./lib/platform-secrets";

// fa-w4-obs-no-error-tracking-apm / fa-w4-obs-no-crash-handlers-server: inicializa
// Sentry (no-op sem SENTRY_DSN) e instala os handlers de uncaughtException/
// unhandledRejection ANTES de montar qualquer rota — se algo explodir durante o
// próprio boot (ex.: um middleware lançando de forma síncrona na primeira
// requisição), a rede de segurança já está de pé.
initSentry("filitech-api");
installProcessCrashGuards("filitech-api");

const app = express();

// fa-w4-obs-no-request-id: primeiro middleware da cadeia, de propósito — toda
// requisição (inclusive os webhooks montados antes do express.json() abaixo)
// precisa ter `req.requestId`/`req.log` disponíveis desde a primeira linha de log.
app.use(requestIdMiddleware);

// fa-w4-obs-no-metrics-endpoint: instrumenta TODA requisição (inclusive webhooks e
// rotas públicas) antes de qualquer outro middleware de negócio — precisa capturar
// a duração real ponta a ponta, incluindo helmet/cors/body-parsing abaixo.
app.use(metricsMiddleware);
// Montado cedo e fora de qualquer auth de tenant/usuário de propósito: é consumido
// por um scraper Prometheus (sidecar/agente externo), não por um usuário logado do
// Filitech ERP — a própria rota já exige `METRICS_TOKEN` em produção (ver
// lib/metrics.ts) em vez do JWT de sessão.
app.use(metricsRouter);

// Railway e Vercel terminam TLS/proxy antes da aplicação — sem isso, `req.ip`
// retornaria o IP interno do proxy reverso, nunca o IP real do cliente, quebrando
// silenciosamente qualquer lógica dependente de IP (allowlist de admin, Capítulo
// 14.5; rate limit e AuditLog por IP, Capítulo 14.4).
// fa-infra-trust-proxy-true-global: `true` confiava cegamente em QUALQUER proxy
// informado em `X-Forwarded-For` (inclusive um cliente malicioso que fale
// diretamente com o processo, se ele algum dia ficar alcançável sem passar pelo
// proxy da plataforma) — o atacante poderia forjar o próprio IP e burlar
// allowlist/rate-limit por IP. Agora o número de "hops" de proxy confiáveis é
// configurável via `TRUST_PROXY_HOPS` (padrão 1 — Railway/Vercel/Caddy/Nginx do
// generic-host ficam todos a exatamente 1 proxy reverso do processo Node).
const TRUST_PROXY_HOPS = Number(process.env.TRUST_PROXY_HOPS ?? 1);
app.set("trust proxy", TRUST_PROXY_HOPS);

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

// fa-w4-obs-redis-healthcheck-shallow: timeout curto para o PING real — um Redis
// gerenciado travado/em failover não pode deixar o healthcheck inteiro pendurado
// esperando resposta que nunca chega.
const REDIS_PING_TIMEOUT_MS = 1_500;

async function pingRedisWithTimeout(): Promise<boolean> {
  try {
    const pong = await Promise.race([
      redis.ping(),
      new Promise<never>((_resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("redis ping timeout")), REDIS_PING_TIMEOUT_MS);
        timer.unref();
      }),
    ]);
    return pong === "PONG";
  } catch {
    return false;
  }
}

async function buildHealthResult(): Promise<{ status: string; database: string; redis: string; timestamp: string; error?: string }> {
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

  // CORREÇÃO (fa-w4-obs-redis-healthcheck-shallow): antes só checava
  // `redis.status === "ready"` — estado de conexão LOCAL do cliente ioredis, que
  // pode continuar "ready" por um bom tempo mesmo com o Redis gerenciado travado/
  // catatônico (failover em andamento, processo preso) sem responder a comandos
  // reais. Agora faz um PING de verdade (com timeout acima) antes de reportar "up".
  const redisUp = await pingRedisWithTimeout();
  result.redis = redisUp ? "up" : "down";
  if (!redisUp) {
    result.status = "degraded";
  }

  return result;
}

// Health check combinado — usado pelo Railway/Docker/Vercel (`healthcheckPath =
// "/health"` em railway.toml) e pelo dashboard do Filitech ERP Desktop (apps/desktop,
// modo HOST) para medir saúde do backend local.
//
// NOTA (fa-w4-obs-redis-healthcheck-shallow): este endpoint único mistura
// liveness+readiness DE PROPÓSITO para este MVP — separar formalmente exigiria
// também atualizar `healthcheckPath` no railway.toml e qualquer outro orquestrador/
// monitor externo já apontando para `/health` hoje, uma mudança de configuração
// coordenada fora do alcance desta correção pontual. `/health/live` e
// `/health/ready` abaixo já existem, de forma puramente ADITIVA (não quebram nada
// que já aponta para `/health`), para quem quiser configurar um orquestrador novo/
// healthcheck mais granular (ex.: liveness sem dependência de Postgres/Redis) no
// futuro.
app.get("/health", async (_req, res) => {
  const result = await buildHealthResult();
  res.status(result.database === "up" && result.redis === "up" ? 200 : 503).json(result);
});

// Liveness: só responde que o processo HTTP está de pé e com o event loop livre —
// nunca verifica dependências externas. Um "down" aqui (timeout/sem resposta)
// significa "o processo travou, mate e reinicie"; nunca "espere ele se recuperar".
app.get("/health/live", (_req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

// Readiness: processo está de pé E consegue falar com Postgres/Redis de verdade —
// um "down" aqui significa "não roteie tráfego novo para este processo ainda" (tira
// da rotação do load balancer), sem necessariamente matar o processo.
app.get("/health/ready", async (_req, res) => {
  const result = await buildHealthResult();
  res.status(result.database === "up" && result.redis === "up" ? 200 : 503).json(result);
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
// GAP DE AUDITORIA FECHADO (fa-superadmin-impersonation-actions-not-audited): hook
// central que grava em AuditLog toda mutação feita sob impersonation — precisa vir
// depois de authMiddleware (que popula req.session.impersonation).
app.use(impersonationAuditMiddleware);

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
app.use(dataDeletionRequestRouter);
app.use(dataImportRouter);
app.use(onlineStoreRouter);

app.use((_req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Rota não encontrada." } });
});

// fa-w4-obs-no-error-tracking-apm: captura toda exceção que chegar até aqui (mesmas
// que o middleware de erro abaixo trata) e envia ao Sentry — precisa vir DEPOIS de
// todas as rotas e ANTES do error handler final de 4 argumentos (ordem exigida pelo
// próprio SDK). No-op transparente quando SENTRY_DSN não está configurado (ver
// lib/sentry.ts): `Sentry.setupExpressErrorHandler` sem `Sentry.init()` prévio não
// lança nem altera o comportamento de erro existente, apenas não envia nada a lugar
// nenhum.
Sentry.setupExpressErrorHandler(app);

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
app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // fa-w4-obs-no-request-id: usa o logger já amarrado ao requestId desta requisição
  // (populado por requestIdMiddleware, primeiro middleware da cadeia) — nunca o
  // `logger` cru aqui, para que esta linha (frequentemente a única pista de um bug
  // em produção) seja correlacionável com o resto do log da mesma requisição.
  (req.log ?? logger).error({ err }, "unhandled-error");
  if (res.headersSent) {
    return;
  }
  res.status(500).json({
    success: false,
    data: null,
    error: {
      code: "INTERNAL_ERROR",
      message: "Erro interno inesperado. Nossa equipe já foi notificada.",
      // fa-w4-obs-no-request-id: devolve o requestId no próprio corpo do erro (além
      // do header x-request-id já setado por requestIdMiddleware) — facilita o
      // suporte/usuário citar um único identificador ao reportar o problema.
      requestId: req.requestId,
    },
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
  // fa-infra-cors-origin-doc-gap: valida no boot (não bloqueante — CORS_ORIGIN pode
  // ter sido configurado só via painel admin/DB, não via env, então um processo
  // recém-subido ainda pode não enxergá-lo num cold start de secret cache) se existe
  // alguma origem de CORS configurada em produção. Sem isso, o comportamento
  // "fail closed" do middleware de CORS acima é silencioso: toda requisição de
  // navegador falha com erro genérico e o operador não tem nenhuma pista do motivo
  // nos logs de inicialização.
  if (process.env.NODE_ENV === "production") {
    getPlatformSecret("CORS_ORIGIN")
      .then((raw) => {
        const allowedOrigins = raw?.split(",").map((o) => o.trim()).filter(Boolean) ?? [];
        if (allowedOrigins.length === 0) {
          logger.error(
            { env: "production" },
            "CORS_ORIGIN não configurado (nem painel admin, nem variável de ambiente) — " +
              "TODA requisição de navegador será rejeitada pela política de CORS. " +
              "Defina a lista de origens de produção (ex.: https://app.seudominio.com.br), " +
              "separadas por vírgula se houver mais de um domínio (ver .env.example).",
          );
        }
      })
      .catch((err) => logger.error({ err }, "falha ao validar CORS_ORIGIN no boot"));
  }

  const httpServer = app.listen(PORT, HOST, () => {
    logger.info({ port: PORT, host: HOST }, "filitech-api ouvindo");
  });

  // GAP DE AUDITORIA FECHADO: sem handler de SIGTERM, um rolling deploy no
  // Docker Swarm/K8s (Capítulo 3) mataria o processo imediatamente — toda
  // requisição HTTP em andamento no instante do deploy (ex.: fechamento de
  // venda, emissão fiscal síncrona) seria abortada no meio, sem resposta ao
  // cliente e com a transação potencialmente em estado intermediário.
  // Graceful shutdown: para de aceitar NOVAS conexões, espera as requisições
  // em andamento terminarem (http.Server.close espera todos os sockets keep-
  // alive ociosos fecharem e as conexões ativas finalizarem antes do callback),
  // encerra Prisma/Redis, e só então sai do processo — com um timeout de
  // segurança para nunca travar indefinidamente um deploy caso alguma conexão
  // fique presa (ex.: cliente lento/conexão quebrada que nunca fecha o socket).
  const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 15_000;
  let shuttingDown = false;
  async function gracefulShutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "sinal de encerramento recebido, iniciando graceful shutdown");

    const forceExitTimer = setTimeout(() => {
      logger.error("graceful shutdown excedeu o timeout, forçando encerramento do processo");
      process.exit(1);
    }, GRACEFUL_SHUTDOWN_TIMEOUT_MS);
    forceExitTimer.unref();

    // Fecha conexões SSE de longa duração ANTES de esperar httpServer.close(),
    // senão o close() nunca resolveria sozinho e todo deploy bateria no timeout.
    closeAllSseConnections();

    httpServer.close(async (err) => {
      if (err) {
        logger.error({ err }, "erro ao fechar o servidor HTTP durante graceful shutdown");
      }
      try {
        await Promise.all([prismaUnscoped.$disconnect(), redis.quit()]);
      } catch (disconnectErr) {
        logger.error({ err: disconnectErr }, "erro ao desconectar Prisma/Redis durante graceful shutdown");
      }
      clearTimeout(forceExitTimer);
      logger.info("graceful shutdown concluído");
      process.exit(0);
    });
  }

  process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => void gracefulShutdown("SIGINT"));
}

export { app };

// packages/db/src/prisma-tenant-extension.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 7.2 — A Extensão: Injeção Automática em Todas as Operações.
import { PrismaClient } from "@prisma/client";
import { getCurrentTenantId } from "./tenant-context";

// A lista TENANT_SCOPED_MODELS é a fonte única de verdade sobre quais modelos
// possuem a coluna tenantId — modelos de catálogo global (Plan, Module) são
// deliberadamente excluídos, enquanto sua tabela de junção (TenantModule)
// permanece protegida.
const TENANT_SCOPED_MODELS = new Set([
  "TenantModule", "Subscription",
  // NOTA: "BillingEvent" fica FORA desta lista — não possui coluna tenantId própria
  // (schema real: id, subscriptionId, provider, externalEventKey, type, payload,
  // createdAt); herda o tenant apenas via subscriptionId -> Subscription. Incluí-lo
  // aqui faz o Prisma lançar "Unknown argument tenantId" em qualquer operação
  // (CORREÇÃO DE AUDITORIA: bug real encontrado e corrigido nesta revisão).
  "User", "RolePermission", "Client", "Supplier",
  "Product", "ProductBatch", "ProductSerial", "ProductVariantAxis", "ProductVariant",
  "Recipe", "RecipeItem", "ProductionBatch", "ReturnableContainerLedger",
  "PrescriptionRecord", "WorkOrder", "WorkOrderItem", "OsChecklist", "OsPhoto",
  "Sale", "SaleItem", "Payment", "CashRegister", "StockMovement",
  // NOTA: "CashRegisterMovement" fica FORA desta lista — não possui coluna tenantId
  // própria (schema real: id, cashRegisterId, type, amount, reason,
  // performedByUserId, createdAt); herda o tenant via cashRegisterId -> CashRegister
  // (CORREÇÃO DE AUDITORIA: mesmo bug do comentário anterior, que dizia "herda via
  // cashRegisterId" mas mantinha o modelo incluído no Set por engano).
  "AccountPayable", "AccountReceivable", "FiscalDocument",
  // Modelos de nicho (Capítulo 12):
  "Service", "Appointment", "ClientServicePackage", "RestaurantTable", "Comanda", "ComandaItem",
  "OpticalPrescription", "Pet", "VaccineRecord", "Vehicle", "VehicleListing",
  // Modelos financeiros (Capítulo 17):
  "ChartOfAccount", "CostCenter", "BankAccount", "BankTransaction", "PaymentCharge",
  // Modelos de relatórios/BI (Capítulo 18):
  "ReportDefinition", "ScheduledReport", "DashboardLayout",
  // Modelos do painel global ligados a um tenant de origem (Capítulo 15) — observação:
  // mesmo sendo consultados/administrados a partir do painel de plataforma, continuam
  // possuindo tenantId e por isso permanecem nesta lista; o painel global, ao precisar
  // listar registros entre tenants (ex.: fila de helpdesk unificada), sempre usa
  // prismaUnscoped para contornar deliberadamente o isolamento, nunca o client
  // tenant-scoped. WebhookDelivery fica fora desta lista por não ter tenantId
  // próprio — seu isolamento vem por herança via endpointId -> TenantWebhookEndpoint.
  "SupportTicket", "TenantApiKey", "TenantWebhookEndpoint",
  // NOTA: "SupportTicketMessage" fica FORA desta lista — não possui coluna tenantId
  // própria (schema real: id, ticketId, authorType, authorId, body, attachmentUrls,
  // createdAt); herda o tenant apenas via ticketId -> SupportTicket, mesmo padrão de
  // BillingEvent acima (CORREÇÃO DE AUDITORIA).
  // Modelos de integrações reais (Capítulo 20):
  "IntegrationCredential",
  // NOTA: "IntegrationHealthCheckLog" fica FORA desta lista — não possui coluna
  // tenantId própria (schema real: id, credentialId, success, httpStatus, latencyMs,
  // responseBody, createdAt); herda o tenant apenas via credentialId ->
  // IntegrationCredential, mesmo padrão acima (CORREÇÃO DE AUDITORIA).
  // Motor de regras fiscais (Capítulo 21.6) — tenantId nulo = regra padrão/nicho,
  // mantida fora do contexto de tenant (consultada via prismaUnscoped pelo motor
  // de cálculo e pelo painel admin); tenantId preenchido = override de um tenant
  // específico, por isso o modelo permanece na lista:
  "TaxRule",
  // Filitech Pessoal — B2C (Capítulo 22): tenants PERSONAL usam exatamente a mesma
  // blindagem multi-tenant dos tenants BUSINESS, sem nenhuma exceção de isolamento.
  "PersonalAccount", "PersonalCategory", "PersonalTransaction",
  // NOTA: "PersonalTransactionSplit" fica FORA desta lista — não possui coluna
  // tenantId própria (schema real: id, transactionId, userId, percentage, amount);
  // herda o tenant via transactionId -> PersonalTransaction (CORREÇÃO DE AUDITORIA).
  "PersonalRecurrenceRule", "PersonalBudget", "PersonalGoal", "PersonalInvestment",
  // NOTA: "PersonalInvestmentPriceHistory" fica FORA desta lista — não possui coluna
  // tenantId própria; herda via investmentId -> PersonalInvestment (CORREÇÃO DE AUDITORIA).
  "PersonalDebt",
  // NOTA: "PersonalDebtInstallment" fica FORA desta lista — não possui coluna tenantId
  // própria; herda via debtId -> PersonalDebt (CORREÇÃO DE AUDITORIA).
  "PersonalBill", "NetWorthSnapshot", "OpenFinanceConsent",
  // Módulo Escritório de Contabilidade (Capítulo 21.18) — apenas AccountingFirmProfile
  // entra nesta lista, pois é o único modelo do módulo com uma única coluna tenantId
  // (o escritório dono do perfil). AccountingEngagement, AccountingEngagementAuditEvent,
  // AccountingEngagementFee, AccountingTask, OfficialTaxDocument e
  // AccountingMarketplaceReview são deliberadamente mantidos FORA desta lista: cada um
  // possui DUAS colunas de tenant (o escritório e o cliente) ou nenhuma coluna tenantId
  // própria (AccountingEngagementFee, acessado só via engagementId), e injetar
  // automaticamente um único where: { tenantId } quebraria a consulta de um dos dois
  // lados legítimos. Eles são protegidos manualmente por assertAccountingAccess()
  // (Capítulo 21.18.3), nunca por esta extensão genérica — mesmo princípio de
  // "fail-closed por omissão" já usado para WebhookDelivery acima.
  // OfficialDocumentLayoutVersion (Capítulo 21.18.7) também fica fora: é um catálogo
  // global de plataforma (sem tenantId), cadastrado apenas pelo painel admin do dono,
  // mesmo padrão já usado para Plan/Module.
  "AccountingFirmProfile",
  // Sócios e repasses (Capítulo 21.18.12) possuem tenantId único e simples — entram
  // normalmente na blindagem automática, sem nenhuma exceção.
  "CompanyPartner", "PartnerPayout",
  // Sistema central de notificações (Capítulo 8.4) — tenantId único e simples,
  // entram normalmente na blindagem automática:
  "Notification", "NotificationPreference", "PushDeviceToken",
  // Módulo de Compras (Capítulo 17.8) — tenantId único e simples, mesmo padrão
  // de WorkOrder/WorkOrderItem:
  "PurchaseOrder", "PurchaseOrderItem",
  // Eventos fiscais pós-emissão (Capítulo 21.19) — tenantId único e simples:
  "FiscalDocumentEvent",
  // Vitrine Virtual (Capítulo 8.5) — tenantId único e simples:
  "OnlineStoreSettings",
  // Contagem física de estoque (Capítulo 17.9) — tenantId único e simples:
  "InventoryCount",
  // NOTA: "InventoryCountItem" fica FORA desta lista — não possui coluna tenantId
  // própria (schema real: id, inventoryCountId, productId, productBatchId, ...);
  // herda o tenant via inventoryCountId -> InventoryCount (CORREÇÃO DE AUDITORIA:
  // mesmo bug do comentário anterior, que dizia "herda via inventoryCountId" mas
  // mantinha o modelo incluído no Set por engano).
  // Importação assistida de dados (Capítulo 18.5) — tenantId único e simples:
  "DataImportJob",
  // Programa de Indicação (Capítulo 2.8) — tenantId único e simples:
  "ReferralCode",
  // NOTA: "Referral" fica FORA desta lista deliberadamente — possui uma segunda referência
  // a tenant (referredTenantId) além da relação indireta via referralCodeId, o mesmo
  // padrão de exclusão documentado acima para outros modelos de dupla referência a tenant;
  // todo acesso a Referral passa pelo serviço dedicado (2.8.1), nunca por query automática.
  // Motor de Fidelidade (Capítulo 4.1.1) — tenantId único e simples:
  "LoyaltyProgram",
  "LoyaltyAccount",
  // NOTA: "LoyaltyTransaction" fica FORA desta lista — não possui coluna tenantId
  // própria (schema real: id, loyaltyAccountId, type, points, saleId, expiresAt,
  // reason, createdAt); herda o tenant via loyaltyAccountId -> LoyaltyAccount
  // (CORREÇÃO DE AUDITORIA: comentário anterior dizia "herda... padrão de SaleItem"
  // mas o modelo permanecia incluído no Set por engano, o que faria o Prisma
  // lançar "Unknown argument tenantId" na primeira query real).
  // TenantIbsCbsRegimeElection (Capítulo 21.6.1, Reforma Tributária) possui tenantId
  // único e simples — entra na blindagem automática, mesmo padrão de LoyaltyProgram/ReferralCode.
  "TenantIbsCbsRegimeElection",
  // Licença Mestra (Capítulo 2.10) — tenantId único e simples, entra normalmente na
  // blindagem automática. NOTA: "LicenseActivation" fica FORA desta lista — não possui
  // coluna tenantId própria (schema real: id, tenantLicenseId, deviceFingerprint,
  // deviceLabel, activatedAt, lastSeenAt, revokedAt); herda o tenant apenas via
  // tenantLicenseId -> TenantLicense, mesmo padrão já documentado acima para
  // BillingEvent/LoyaltyTransaction/etc.
  "TenantLicense",
]);

// NOTA CRÍTICA: Tenant em si NUNCA deve constar nesta lista. O modelo Tenant não
// possui coluna tenantId — ele É a entidade raiz que as demais referenciam. Incluí-lo
// aqui faria a extensão injetar um filtro tenantId inexistente em
// prisma.tenant.findUnique/create/..., quebrando toda criação/consulta de tenant em
// runtime. Pelo mesmo motivo, modelos de catálogo global (Plan, Module) e modelos
// exclusivos da plataforma (PlatformAdminUser e correlatos, Capítulo 13.5) também
// ficam de fora — são sempre acessados via prismaUnscoped, nunca pelo client
// tenant-scoped.

// Operações de leitura que aceitam injeção direta de "where".
const READ_OPERATIONS = new Set(["findFirst", "findFirstOrThrow", "findMany", "findUnique", "findUniqueOrThrow", "count", "aggregate", "groupBy"]);

// Operações de escrita única — recebem tenantId tanto no "data" quanto no "where".
const WRITE_WHERE_OPERATIONS = new Set(["update", "updateMany", "delete", "deleteMany", "upsert"]);

// Tipos auxiliares para que services/funções de domínio aceitem indiferentemente o
// client "cru" (PrismaClient) ou o client blindado por tenant retornado por
// createTenantScopedPrismaClient abaixo — a extension do Prisma Client ($extends)
// retorna um tipo estruturalmente diferente de PrismaClient (não é um subtipo nem
// supertipo em TypeScript, mesmo sendo 100% compatível em runtime), então qualquer
// função que hoje recebe `prisma: PrismaClient` ou `tx: Prisma.TransactionClient`
// como parâmetro precisa aceitar também o client com extension — caso contrário o
// TypeScript rejeita a migração em massa de prismaUnscoped -> prisma dos routers
// (Capítulo 7.2).
export type TenantScopedPrismaClient = ReturnType<typeof createTenantScopedPrismaClient>;
export type AppPrismaClient = PrismaClient | TenantScopedPrismaClient;
export type TenantScopedTransactionClient = Omit<
  TenantScopedPrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;
export type AppPrismaTransactionClient = import("@prisma/client").Prisma.TransactionClient | TenantScopedTransactionClient;

export function createTenantScopedPrismaClient(basePrismaClient: PrismaClient) {
  return basePrismaClient.$extends({
    name: "tenant-isolation-extension",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !TENANT_SCOPED_MODELS.has(model)) {
            return query(args);
          }

          const tenantId = getCurrentTenantId();
          // CORREÇÃO DE AUDITORIA (TypeScript, não documentada originalmente no Capítulo 7.2):
          // o tipo de `args` é uma união discriminada com 1600+ variantes (uma por
          // model x operation da schema completa com 116 models), e o TypeScript não
          // consegue provar em tempo de compilação que toda variante da união possui
          // `data`/`where` apenas porque checamos `operation` em runtime. `$allOperations`
          // é deliberadamente genérico sobre todos os models — o cast para `any` aqui é
          // a forma recomendada pela própria documentação do Prisma para este padrão de
          // extensão genérica; a segurança real do isolamento vem da lista fail-closed
          // `TENANT_SCOPED_MODELS` + do fallback `throw` abaixo, não da inferência de tipos.
          const typedArgs = args as any;

          if (operation === "create") {
            typedArgs.data = { ...typedArgs.data, tenantId };
            return query(typedArgs);
          }

          if (operation === "createMany") {
            typedArgs.data = Array.isArray(typedArgs.data)
              ? typedArgs.data.map((item: Record<string, unknown>) => ({ ...item, tenantId }))
              : typedArgs.data;
            return query(typedArgs);
          }

          if (READ_OPERATIONS.has(operation) || WRITE_WHERE_OPERATIONS.has(operation)) {
            typedArgs.where = { ...(typedArgs.where ?? {}), tenantId };
            return query(typedArgs);
          }

          // Qualquer operação não explicitamente classificada é bloqueada por padrão
          // (fail-closed) em vez de executada sem filtro — preferimos quebrar em
          // desenvolvimento a vazar dados em produção.
          throw new Error(
            `Operação "${operation}" no modelo "${model}" não possui regra de isolamento de tenant definida. Adicione-a explicitamente antes de usar em produção.`,
          );
        },
      },
    },
  });
}

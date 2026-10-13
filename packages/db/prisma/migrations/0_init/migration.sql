-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('PENDING', 'CONVERTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "LoyaltyTransactionType" AS ENUM ('EARN', 'REDEEM', 'EXPIRE', 'MANUAL_ADJUST');

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TenantType" AS ENUM ('BUSINESS', 'PERSONAL', 'ACCOUNTING_OFFICE');

-- CreateEnum
CREATE TYPE "TaxRegime" AS ENUM ('MEI', 'SIMPLES_NACIONAL', 'LUCRO_PRESUMIDO', 'LUCRO_REAL');

-- CreateEnum
CREATE TYPE "PlanAudience" AS ENUM ('BUSINESS', 'PERSONAL', 'BOTH');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'MANAGER', 'TECHNICIAN', 'CASHIER', 'ACCOUNTANT', 'HOUSEHOLD_MEMBER');

-- CreateEnum
CREATE TYPE "ProductTrackingType" AS ENUM ('NONE', 'BATCH', 'SERIAL', 'VARIANT');

-- CreateEnum
CREATE TYPE "ProductionBatchStatus" AS ENUM ('PLANNED', 'PRODUCED', 'PARTIALLY_LOST');

-- CreateEnum
CREATE TYPE "ContainerLedgerDirection" AS ENUM ('BORROWED', 'RETURNED');

-- CreateEnum
CREATE TYPE "WorkOrderStatus" AS ENUM ('RECEIVED', 'DIAGNOSING', 'AWAITING_APPROVAL', 'IN_REPAIR', 'READY', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ChecklistStage" AS ENUM ('ENTRY', 'DIAGNOSIS', 'DELIVERY');

-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('OPEN', 'PAID', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "SalePaymentMethod" AS ENUM ('CASH', 'DEBIT_CARD', 'CREDIT_CARD', 'PIX', 'BOLETO', 'STORE_CREDIT');

-- CreateEnum
CREATE TYPE "SaleChannel" AS ENUM ('COUNTER', 'DINE_IN', 'DELIVERY_IFOOD', 'ONLINE_STORE');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "CashRegisterStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('PURCHASE_IN', 'SALE_OUT', 'ADJUSTMENT', 'RECIPE_CONSUMPTION', 'PRODUCTION_CONSUMPTION', 'LOSS', 'RETURN');

-- CreateEnum
CREATE TYPE "PayableStatus" AS ENUM ('PENDING', 'PAID', 'OVERDUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReceivableStatus" AS ENUM ('PENDING', 'PAID', 'OVERDUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FiscalDocumentType" AS ENUM ('NFCE', 'NFE_SAIDA', 'NFE_ENTRADA');

-- CreateEnum
CREATE TYPE "FiscalDocumentStatus" AS ENUM ('PENDING', 'AUTHORIZED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PisCofinsRegime" AS ENUM ('ISENTO_SIMPLES', 'CUMULATIVO', 'NAO_CUMULATIVO', 'MONOFASICO_CONCENTRADO', 'MONOFASICO_ALIQUOTA_ZERO');

-- CreateEnum
CREATE TYPE "PersonalAccountType" AS ENUM ('CHECKING', 'SAVINGS', 'WALLET_CASH', 'CREDIT_CARD', 'INVESTMENT_BROKERAGE');

-- CreateEnum
CREATE TYPE "PersonalCategoryType" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "PersonalTransactionType" AS ENUM ('INCOME', 'EXPENSE', 'TRANSFER');

-- CreateEnum
CREATE TYPE "PersonalRecurrenceFrequency" AS ENUM ('WEEKLY', 'MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "PersonalGoalType" AS ENUM ('SAVINGS', 'DEBT_PAYOFF', 'EMERGENCY_FUND', 'PURCHASE');

-- CreateEnum
CREATE TYPE "PersonalGoalStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "PersonalInvestmentAssetType" AS ENUM ('TESOURO_DIRETO', 'CDB', 'LCI_LCA', 'ACOES', 'FII', 'CRIPTO', 'PREVIDENCIA_PRIVADA', 'POUPANCA');

-- CreateEnum
CREATE TYPE "PersonalDebtType" AS ENUM ('FINANCIAMENTO_IMOVEL', 'FINANCIAMENTO_VEICULO', 'EMPRESTIMO_PESSOAL', 'CARTAO_PARCELADO', 'CHEQUE_ESPECIAL');

-- CreateEnum
CREATE TYPE "PersonalDebtStatus" AS ENUM ('ACTIVE', 'PAID_OFF');

-- CreateEnum
CREATE TYPE "PersonalDebtInstallmentStatus" AS ENUM ('PENDING', 'PAID', 'OVERDUE');

-- CreateEnum
CREATE TYPE "PersonalBillStatus" AS ENUM ('PENDING', 'PAID', 'OVERDUE');

-- CreateEnum
CREATE TYPE "OpenFinanceConsentStatus" AS ENUM ('UPDATING', 'UPDATED', 'LOGIN_ERROR', 'OUTDATED', 'WAITING_USER_INPUT');

-- CreateEnum
CREATE TYPE "CashRegisterMovementType" AS ENUM ('WITHDRAWAL', 'INJECTION');

-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('WORK_ORDER_STATUS', 'SUPPORT_TICKET_UPDATE', 'CASH_FLOW_ALERT', 'BILLING_DUNNING', 'ACCOUNTING_TASK_REMINDER', 'STOCK_LOW', 'FISCAL_DOCUMENT_REJECTED', 'SYSTEM_ANNOUNCEMENT');

-- CreateEnum
CREATE TYPE "ProductSaleUnit" AS ENUM ('UNIT', 'KG', 'METER', 'SQUARE_METER', 'CUBIC_METER', 'LITER');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('SCHEDULED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "AppointmentSource" AS ENUM ('INTERNAL', 'PUBLIC_BOOKING');

-- CreateEnum
CREATE TYPE "ComandaStatus" AS ENUM ('OPEN', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VehicleListingStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'SOLD', 'CONSIGNED');

-- CreateEnum
CREATE TYPE "PlatformAdminRole" AS ENUM ('SUPER_ADMIN', 'SUPPORT_AGENT', 'FINANCE_ANALYST');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "AccountNature" AS ENUM ('REVENUE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "BankTransactionReconciliationStatus" AS ENUM ('UNMATCHED', 'SUGGESTED', 'MATCHED', 'IGNORED');

-- CreateEnum
CREATE TYPE "ChargeType" AS ENUM ('BOLETO', 'PIX');

-- CreateEnum
CREATE TYPE "ChargeStatus" AS ENUM ('PENDING', 'PAID', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InventoryCountStatus" AS ENUM ('OPEN', 'RECONCILING', 'APPROVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DataImportStatus" AS ENUM ('UPLOADED', 'VALIDATING', 'VALIDATED_WITH_ERRORS', 'VALIDATED_CLEAN', 'IMPORTING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('WHATSAPP_META_CLOUD', 'FISCAL_FOCUS_NFE', 'BILLING_ASAAS', 'BILLING_STRIPE', 'STORAGE_CLOUDFLARE_R2', 'EMAIL_RESEND', 'SMS_ZENVIA', 'TEF_CLISITEF', 'VEHICLE_DATA_FIPE_PLACA', 'BANK_OPEN_FINANCE_PLUGGY');

-- CreateEnum
CREATE TYPE "IntegrationEnvironment" AS ENUM ('SANDBOX', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "FaseReformaTributaria" AS ENUM ('TESTE_COMPENSAVEL', 'TRANSICAO_PLENA', 'REGIME_PLENO');

-- CreateEnum
CREATE TYPE "IbsCbsRegimeOptante" AS ENUM ('EMBUTIDO_NO_DAS', 'REGULAR_COM_CREDITO');

-- CreateEnum
CREATE TYPE "FiscalCodeType" AS ENUM ('NCM', 'NBS', 'CEST');

-- CreateEnum
CREATE TYPE "CatalogImportStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'COMPLETED_WITH_WARNINGS', 'FAILED');

-- CreateEnum
CREATE TYPE "AccountingEngagementScope" AS ENUM ('FULL_BOOKKEEPING', 'TAX_FILING', 'PAYROLL_ESOCIAL', 'PERSONAL_INCOME_TAX', 'DOCUMENT_EXPORT_ONLY');

-- CreateEnum
CREATE TYPE "AccountingEngagementStatus" AS ENUM ('PENDING_ACCOUNTANT_ACCEPTANCE', 'ACTIVE', 'REVOKED_BY_CLIENT', 'REVOKED_BY_ACCOUNTANT', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AccountingEngagementEventType" AS ENUM ('GRANTED', 'ACCEPTED', 'REVOKED_BY_CLIENT', 'REVOKED_BY_ACCOUNTANT', 'EXPIRED', 'SCOPE_CHANGED', 'CROSS_TENANT_ACCESS');

-- CreateEnum
CREATE TYPE "AccountingTaskType" AS ENUM ('ECD_GERACAO', 'ECF_GERACAO', 'EFD_REINF_ENVIO', 'DCTFWEB_GERACAO', 'DEFIS_ENVIO', 'FOLHA_FECHAMENTO', 'DAS_GERACAO', 'DARF_GERACAO', 'IRPF_DECLARACAO');

-- CreateEnum
CREATE TYPE "AccountingTaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'DONE', 'LATE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "OfficialTaxDocumentType" AS ENUM ('ECD', 'ECF', 'EFD_REINF', 'DCTFWEB', 'DEFIS', 'DARF', 'DAS', 'IRPF_DECLARACAO', 'INFORME_RENDIMENTOS_SOCIO');

-- CreateEnum
CREATE TYPE "OfficialTaxDocumentStatus" AS ENUM ('DRAFT', 'GENERATED', 'TRANSMITTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PartnerPayoutType" AS ENUM ('PRO_LABORE', 'PROFIT_DISTRIBUTION');

-- CreateEnum
CREATE TYPE "FiscalDocumentEventType" AS ENUM ('CANCELLATION', 'CORRECTION_LETTER', 'RECIPIENT_MANIFESTATION');

-- CreateEnum
CREATE TYPE "RecipientManifestationType" AS ENUM ('CONFIRMACAO_DA_OPERACAO', 'OPERACAO_NAO_REALIZADA', 'DESCONHECIMENTO_DA_OPERACAO', 'CIENCIA_DA_OPERACAO');

-- CreateTable
CREATE TABLE "referral_codes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referrals" (
    "id" TEXT NOT NULL,
    "referralCodeId" TEXT NOT NULL,
    "referredTenantId" TEXT NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'PENDING',
    "rewardAppliedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_programs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "pointsPerCurrencyUnit" DECIMAL(6,2) NOT NULL DEFAULT 1,
    "redemptionValuePerPoint" DECIMAL(6,4) NOT NULL DEFAULT 0.01,
    "minPointsToRedeem" INTEGER NOT NULL DEFAULT 100,
    "pointsExpireAfterDays" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_accounts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "pointsBalance" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_transactions" (
    "id" TEXT NOT NULL,
    "loyaltyAccountId" TEXT NOT NULL,
    "type" "LoyaltyTransactionType" NOT NULL,
    "points" INTEGER NOT NULL,
    "saleId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "parentTenantId" TEXT,
    "slug" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "tradeName" TEXT NOT NULL,
    "cnpj" TEXT,
    "tenantType" "TenantType" NOT NULL DEFAULT 'BUSINESS',
    "status" "TenantStatus" NOT NULL DEFAULT 'TRIAL',
    "gracePeriodEndsAt" TIMESTAMP(3),
    "taxRegime" "TaxRegime" NOT NULL DEFAULT 'SIMPLES_NACIONAL',
    "simplesNacionalAnexo" TEXT,
    "inscricaoEstadual" TEXT,
    "uf" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "termsAcceptedAt" TIMESTAMP(3),
    "termsVersionAccepted" TEXT,
    "privacyPolicyAcceptedAt" TIMESTAMP(3),
    "privacyPolicyVersionAccepted" TEXT,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "basePrice" DECIMAL(10,2) NOT NULL,
    "includedModules" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "audience" "PlanAudience" NOT NULL DEFAULT 'BUSINESS',
    "maxConnectedAccounts" INTEGER,
    "includedUserSeats" INTEGER DEFAULT 10,
    "extraUserSeatPrice" DECIMAL(10,2) DEFAULT 35.00,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modules" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "monthlyPrice" DECIMAL(10,2) NOT NULL,
    "description" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_modules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "moduleCode" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deactivatedAt" TIMESTAMP(3),

    CONSTRAINT "tenant_modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalSubscriptionId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
    "pastDueSince" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "paymentMethodToken" TEXT,
    "paymentMethodBrand" TEXT,
    "paymentMethodLast4" TEXT,
    "stripeSeatSubscriptionItemId" TEXT,
    "failedPaymentAttempts" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3),
    "firstChargedAt" TIMESTAMP(3),
    "cancelRequestedAt" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "creditBalanceMonths" INTEGER NOT NULL DEFAULT 0,
    "firstCycleDiscountPercent" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_events" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalEventKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "preferredThemeMode" TEXT NOT NULL DEFAULT 'light',
    "totpSecretEncrypted" TEXT,
    "totpConfirmedAt" TIMESTAMP(3),
    "managerPinHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_default_permissions" (
    "id" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "permissionCode" TEXT NOT NULL,

    CONSTRAINT "role_default_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "document" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "creditLimit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "creditBalanceUsed" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "whatsappOptInAt" TIMESTAMP(3),
    "whatsappOptOutAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "document" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "supplierId" TEXT,
    "sku" TEXT NOT NULL,
    "barcode" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "trackingType" "ProductTrackingType" NOT NULL DEFAULT 'NONE',
    "ncm" TEXT DEFAULT '00000000',
    "originUf" TEXT,
    "nicheCode" TEXT,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "wholesalePrice" DECIMAL(12,2),
    "resalePrice" DECIMAL(12,2),
    "wholesaleMinQty" INTEGER,
    "stockQuantity" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "minStockThreshold" DECIMAL(12,3),
    "costPrice" DECIMAL(12,4),
    "reorderTargetQuantity" DECIMAL(12,3),
    "preferredSupplierId" TEXT,
    "isWeighted" BOOLEAN NOT NULL DEFAULT false,
    "isReturnableContainer" BOOLEAN NOT NULL DEFAULT false,
    "isReturnable" BOOLEAN NOT NULL DEFAULT true,
    "requiresPrescriptionRetention" BOOLEAN NOT NULL DEFAULT false,
    "isControlledSubstance" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_batches" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "manufacturingDate" TIMESTAMP(3),
    "expirationDate" TIMESTAMP(3) NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "costPrice" DECIMAL(12,4),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_serials" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "imei" TEXT,
    "status" TEXT NOT NULL DEFAULT 'IN_STOCK',
    "workOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_serials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variant_axes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "product_variant_axes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "axisId" TEXT NOT NULL,
    "axisValue" TEXT NOT NULL,
    "barcode" TEXT,
    "stockQuantity" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "priceOverride" DECIMAL(12,2),

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prescription_records" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "saleItemId" TEXT NOT NULL,
    "prescriptionType" TEXT NOT NULL,
    "electronicPrescriptionNumber" TEXT,
    "retainedDocumentStorageKey" TEXT,
    "patientDocument" TEXT NOT NULL,
    "validatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prescription_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "yieldQuantity" DECIMAL(12,3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "quantityPerYield" DECIMAL(12,4) NOT NULL,

    CONSTRAINT "recipe_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_batches" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "finishedProductId" TEXT NOT NULL,
    "quantityProduced" DECIMAL(12,3) NOT NULL,
    "quantityLost" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "status" "ProductionBatchStatus" NOT NULL DEFAULT 'PLANNED',
    "producedByUserId" TEXT NOT NULL,
    "producedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "returnable_container_ledger" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "direction" "ContainerLedgerDirection" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "saleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "returnable_container_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_orders" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "assignedTechnicianId" TEXT,
    "equipmentDescription" TEXT NOT NULL,
    "reportedIssue" TEXT NOT NULL,
    "status" "WorkOrderStatus" NOT NULL DEFAULT 'RECEIVED',
    "diagnosisNotes" TEXT,
    "budgetValidUntil" TIMESTAMP(3),
    "budgetApprovalToken" TEXT,
    "budgetApprovedAt" TIMESTAMP(3),
    "warrantyDays" INTEGER,
    "warrantyExclusions" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "vehicleId" TEXT,

    CONSTRAINT "work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "productId" TEXT,
    "description" TEXT NOT NULL,
    "itemType" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "commissionable" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "work_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "os_checklists" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "stage" "ChecklistStage" NOT NULL,
    "items" JSONB NOT NULL,
    "clientSignatureUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "os_checklists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "os_photos" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "caption" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "os_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT,
    "cashierId" TEXT NOT NULL,
    "cashRegisterId" TEXT NOT NULL,
    "status" "SaleStatus" NOT NULL DEFAULT 'OPEN',
    "channel" "SaleChannel" NOT NULL DEFAULT 'COUNTER',
    "idempotencyKey" TEXT NOT NULL,
    "paymentMethod" "SalePaymentMethod" NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "chartOfAccountId" TEXT,
    "fiscalStatus" TEXT,
    "refundReason" TEXT,
    "refundedByUserId" TEXT,
    "refundAuthorizedByUserId" TEXT,
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "productId" TEXT,
    "serviceId" TEXT,
    "productVariantId" TEXT,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "totalPrice" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "sale_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "method" "SalePaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(12,2) NOT NULL,
    "changeDue" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tefAuthorizationCode" TEXT,
    "externalProviderId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_registers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "openedById" TEXT NOT NULL,
    "status" "CashRegisterStatus" NOT NULL DEFAULT 'OPEN',
    "openingAmount" DECIMAL(12,2) NOT NULL,
    "closingAmount" DECIMAL(12,2),
    "expectedAmount" DECIMAL(12,2),
    "divergenceAmount" DECIMAL(12,2),
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "cash_registers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productBatchId" TEXT,
    "type" "StockMovementType" NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "reasonCode" TEXT,
    "referenceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts_payable" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "PayableStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "sourceNfeKey" TEXT,
    "chartOfAccountId" TEXT,
    "costCenterId" TEXT,
    "purchaseOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_payable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts_receivable" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "saleId" TEXT,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "ReceivableStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "chartOfAccountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_receivable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_documents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "saleId" TEXT,
    "type" "FiscalDocumentType" NOT NULL,
    "status" "FiscalDocumentStatus" NOT NULL DEFAULT 'PENDING',
    "accessKey" TEXT,
    "xmlStorageKey" TEXT,
    "rejectionReason" TEXT,
    "legacyIcmsAmount" DECIMAL(12,2),
    "legacyPisCofinsAmount" DECIMAL(12,2),
    "cbsAmount" DECIMAL(12,2),
    "ibsAmount" DECIMAL(12,2),
    "selectiveTaxAmount" DECIMAL(12,2),
    "totalTaxesApprox" DECIMAL(12,2),
    "taxRegimeSnapshot" "TaxRegime" NOT NULL,
    "faseReformaTributaria" "FaseReformaTributaria" NOT NULL DEFAULT 'TESTE_COMPENSAVEL',
    "federalIrrfWithheld" DECIMAL(12,2),
    "federalPisCofinsCsllWithheld" DECIMAL(12,2),
    "federalInssWithheld" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fiscal_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_rules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "nicheCode" TEXT,
    "uf" TEXT,
    "ncm" TEXT,
    "nbs" TEXT,
    "cfop" TEXT,
    "cest" TEXT,
    "cstCsosn" TEXT,
    "icmsAliquota" DECIMAL(5,2),
    "icmsInterestadualAliquota" DECIMAL(5,2),
    "icmsStMva" DECIMAL(5,2),
    "icmsBaseReductionPercent" DECIMAL(5,2),
    "issAliquota" DECIMAL(5,2),
    "issRetidoNaFonte" BOOLEAN NOT NULL DEFAULT false,
    "pisCofinsRegime" "PisCofinsRegime" NOT NULL DEFAULT 'ISENTO_SIMPLES',
    "pisAliquotaConcentrada" DECIMAL(5,4),
    "cofinsAliquotaConcentrada" DECIMAL(5,4),
    "ibsAliquota" DECIMAL(5,2),
    "cbsAliquota" DECIMAL(5,2),
    "selectiveTaxAliquota" DECIMAL(5,2),
    "legalReference" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personal_accounts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ownerId" TEXT,
    "name" TEXT NOT NULL,
    "type" "PersonalAccountType" NOT NULL,
    "institutionName" TEXT,
    "currentBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "creditLimit" DECIMAL(14,2),
    "invoiceClosingDay" INTEGER,
    "invoiceDueDay" INTEGER,
    "isShared" BOOLEAN NOT NULL DEFAULT true,
    "openFinanceConsentId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "personal_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personal_categories" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "parentCategoryId" TEXT,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "type" "PersonalCategoryType" NOT NULL,
    "isSystemDefault" BOOLEAN NOT NULL DEFAULT false,
    "isCarneLeaoIncome" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "personal_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personal_transactions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "categoryId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "recurrenceRuleId" TEXT,
    "description" TEXT NOT NULL,
    "merchantName" TEXT,
    "type" "PersonalTransactionType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "attachmentStorageKey" TEXT,
    "openFinanceExternalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "personal_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personal_transaction_splits" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "percentage" DECIMAL(5,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "personal_transaction_splits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personal_recurrence_rules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "frequency" "PersonalRecurrenceFrequency" NOT NULL,
    "dayOfMonth" INTEGER,
    "templateDescription" TEXT NOT NULL,
    "templateAmount" DECIMAL(14,2) NOT NULL,
    "templateAccountId" TEXT NOT NULL,
    "templateCategoryId" TEXT,
    "nextOccurrenceAt" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "personal_recurrence_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personal_budgets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "monthReference" TIMESTAMP(3) NOT NULL,
    "limitAmount" DECIMAL(14,2) NOT NULL,
    "rolloverEnabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "personal_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personal_goals" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "linkedAccountId" TEXT,
    "name" TEXT NOT NULL,
    "type" "PersonalGoalType" NOT NULL,
    "targetAmount" DECIMAL(14,2) NOT NULL,
    "currentAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "targetDate" TIMESTAMP(3),
    "status" "PersonalGoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "personal_goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personal_investments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "assetType" "PersonalInvestmentAssetType" NOT NULL,
    "assetName" TEXT NOT NULL,
    "ticker" TEXT,
    "quantity" DECIMAL(18,8) NOT NULL,
    "averagePrice" DECIMAL(14,2) NOT NULL,
    "currentPrice" DECIMAL(14,2) NOT NULL,
    "openFinanceExternalId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "personal_investments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personal_investment_price_history" (
    "id" TEXT NOT NULL,
    "investmentId" TEXT NOT NULL,
    "priceDate" TIMESTAMP(3) NOT NULL,
    "closingPrice" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "personal_investment_price_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personal_debts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "PersonalDebtType" NOT NULL,
    "originalAmount" DECIMAL(14,2) NOT NULL,
    "remainingAmount" DECIMAL(14,2) NOT NULL,
    "interestRateMonthly" DECIMAL(6,4) NOT NULL,
    "installmentsTotal" INTEGER NOT NULL,
    "installmentsPaid" INTEGER NOT NULL DEFAULT 0,
    "dueDay" INTEGER NOT NULL,
    "status" "PersonalDebtStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "personal_debts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personal_debt_installments" (
    "id" TEXT NOT NULL,
    "debtId" TEXT NOT NULL,
    "installmentNumber" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "status" "PersonalDebtInstallmentStatus" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "personal_debt_installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personal_bills" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "categoryId" TEXT,
    "autoDebitAccountId" TEXT,
    "name" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "dueDay" INTEGER NOT NULL,
    "isRecurring" BOOLEAN NOT NULL DEFAULT true,
    "reminderDaysBefore" INTEGER NOT NULL DEFAULT 3,
    "lastPaidAt" TIMESTAMP(3),
    "status" "PersonalBillStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "personal_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "net_worth_snapshots" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "snapshotDate" TIMESTAMP(3) NOT NULL,
    "totalAssets" DECIMAL(16,2) NOT NULL,
    "totalLiabilities" DECIMAL(16,2) NOT NULL,
    "netWorth" DECIMAL(16,2) NOT NULL,

    CONSTRAINT "net_worth_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "open_finance_consents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'PLUGGY',
    "itemId" TEXT NOT NULL,
    "institutionName" TEXT NOT NULL,
    "status" "OpenFinanceConsentStatus" NOT NULL DEFAULT 'UPDATING',
    "consentExpiresAt" TIMESTAMP(3) NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "open_finance_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_register_movements" (
    "id" TEXT NOT NULL,
    "cashRegisterId" TEXT NOT NULL,
    "type" "CashRegisterMovementType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "performedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_register_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "category" "NotificationCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "linkRoute" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "inApp" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT true,
    "push" BOOLEAN NOT NULL DEFAULT false,
    "whatsapp" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_device_tokens" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "expoPushToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "push_device_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_document_versions" (
    "id" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "contentUrl" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "online_store_settings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "customSlug" TEXT NOT NULL,
    "primaryColorHex" TEXT NOT NULL DEFAULT '#4F46E5',
    "logoStorageKey" TEXT,
    "deliveryEnabled" BOOLEAN NOT NULL DEFAULT false,
    "deliveryFee" DECIMAL(10,2),
    "minOrderAmount" DECIMAL(10,2),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "online_store_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nicheTag" TEXT NOT NULL,
    "basePrice" DECIMAL(12,2) NOT NULL,
    "estimatedDurationMinutes" INTEGER NOT NULL,
    "commissionPercentage" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "petId" TEXT,
    "vehicleId" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'SCHEDULED',
    "source" "AppointmentSource" NOT NULL DEFAULT 'INTERNAL',
    "comandaId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_service_packages" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "totalSessions" INTEGER NOT NULL,
    "sessionsUsed" INTEGER NOT NULL DEFAULT 0,
    "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "client_service_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restaurant_tables" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "seatCount" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "restaurant_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comandas" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tableId" TEXT,
    "clientId" TEXT,
    "status" "ComandaStatus" NOT NULL DEFAULT 'OPEN',
    "saleId" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "comandas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comanda_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "comandaId" TEXT NOT NULL,
    "productId" TEXT,
    "serviceId" TEXT,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "sentToKdsAt" TIMESTAMP(3),

    CONSTRAINT "comanda_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "optical_prescriptions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "prescribingDoctor" TEXT NOT NULL,
    "rightEyeSphere" DECIMAL(4,2) NOT NULL,
    "rightEyeCylinder" DECIMAL(4,2) NOT NULL,
    "rightEyeAxis" INTEGER NOT NULL,
    "leftEyeSphere" DECIMAL(4,2) NOT NULL,
    "leftEyeCylinder" DECIMAL(4,2) NOT NULL,
    "leftEyeAxis" INTEGER NOT NULL,
    "addition" DECIMAL(4,2),
    "pupillaryDistance" DECIMAL(4,1),
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "optical_prescriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "species" TEXT NOT NULL,
    "breed" TEXT,
    "birthDate" TIMESTAMP(3),
    "weightKg" DECIMAL(6,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vaccine_records" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "petId" TEXT NOT NULL,
    "vaccineName" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL,
    "nextDoseDueAt" TIMESTAMP(3),
    "appliedByUserId" TEXT NOT NULL,

    CONSTRAINT "vaccine_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "licensePlate" TEXT NOT NULL,
    "chassisNumber" TEXT,
    "model" TEXT NOT NULL,
    "manufactureYear" INTEGER,
    "mileageKm" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_listings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "chassisNumber" TEXT NOT NULL,
    "licensePlate" TEXT,
    "model" TEXT NOT NULL,
    "manufactureYear" INTEGER NOT NULL,
    "mileageKm" INTEGER NOT NULL,
    "askingPrice" DECIMAL(12,2) NOT NULL,
    "status" "VehicleListingStatus" NOT NULL DEFAULT 'AVAILABLE',
    "consignorClientId" TEXT,
    "consignmentCommissionPercentage" DECIMAL(5,2),
    "atpveDocumentStorageKey" TEXT,
    "soldAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_admin_users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "PlatformAdminRole" NOT NULL,
    "totpSecretEncrypted" TEXT,
    "totpConfirmedAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "platformAdminUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "isImpersonated" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "impersonation_sessions" (
    "id" TEXT NOT NULL,
    "platformAdminUserId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "impersonation_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_parameters" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "updatedByPlatformAdminUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_parameters_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "discount_coupons" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "discountType" TEXT NOT NULL,
    "discountValue" DECIMAL(12,2) NOT NULL,
    "scopeType" TEXT NOT NULL,
    "scopeReferenceId" TEXT,
    "maxRedemptions" INTEGER,
    "redemptionCount" INTEGER NOT NULL DEFAULT 0,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "discount_coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "release_notes" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "deployedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "release_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "two_factor_backup_codes" (
    "id" TEXT NOT NULL,
    "platformAdminUserId" TEXT,
    "userId" TEXT,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "two_factor_backup_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "platformAdminUserId" TEXT,
    "userId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "requestedFromIp" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "active_sessions" (
    "id" TEXT NOT NULL,
    "platformAdminUserId" TEXT,
    "userId" TEXT,
    "refreshTokenHash" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "active_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_ip_allowlist_entries" (
    "id" TEXT NOT NULL,
    "platformAdminUserId" TEXT NOT NULL,
    "cidrRange" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_ip_allowlist_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_events" (
    "id" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "incident_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_flags" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "rolloutPercent" INTEGER NOT NULL DEFAULT 0,
    "enabledForTenantIds" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "openedByUserId" TEXT NOT NULL,
    "assignedToPlatformAdminUserId" TEXT,
    "subject" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "priority" "TicketPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_ticket_messages" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorType" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "attachmentUrls" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_ticket_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_api_keys" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "scopes" TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_webhook_endpoints" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "eventTypes" TEXT[],
    "signingSecretEncrypted" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "statusCode" INTEGER,
    "success" BOOLEAN NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "deliveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chart_of_accounts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nature" "AccountNature" NOT NULL,
    "parentId" TEXT,

    CONSTRAINT "chart_of_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_centers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,

    CONSTRAINT "cost_centers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "agencyNumber" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "currentBalance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "openFinanceConsentId" TEXT,
    "openFinanceExternalAccountId" TEXT,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_transactions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "externalFitId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "reconciliationStatus" "BankTransactionReconciliationStatus" NOT NULL DEFAULT 'UNMATCHED',
    "matchedAccountPayableId" TEXT,
    "matchedAccountReceivableId" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_charges" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountReceivableId" TEXT NOT NULL,
    "type" "ChargeType" NOT NULL,
    "status" "ChargeStatus" NOT NULL DEFAULT 'PENDING',
    "pixQrCodePayload" TEXT,
    "boletoDigitableLine" TEXT,
    "boletoPdfStorageKey" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "externalProviderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "orderNumber" INTEGER NOT NULL,
    "expectedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantityOrdered" DECIMAL(12,3) NOT NULL,
    "quantityReceived" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(12,4) NOT NULL,
    "batchNumber" TEXT,
    "expirationDate" TIMESTAMP(3),

    CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_counts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "InventoryCountStatus" NOT NULL DEFAULT 'OPEN',
    "scope" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedByUserId" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,
    "notes" TEXT,

    CONSTRAINT "inventory_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_count_items" (
    "id" TEXT NOT NULL,
    "inventoryCountId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productBatchId" TEXT,
    "expectedQuantity" DECIMAL(14,3) NOT NULL,
    "countedQuantity" DECIMAL(14,3),
    "countedAt" TIMESTAMP(3),
    "countedByUserId" TEXT,
    "divergenceReason" TEXT,

    CONSTRAINT "inventory_count_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_definitions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "datasetKey" TEXT NOT NULL,
    "dimensions" JSONB NOT NULL,
    "metrics" JSONB NOT NULL,
    "filters" JSONB NOT NULL,
    "chartType" TEXT NOT NULL,
    "isPinnedToDashboard" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_reports" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reportDefinitionId" TEXT NOT NULL,
    "cronExpression" TEXT NOT NULL,
    "recipientEmails" TEXT[],
    "format" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),

    CONSTRAINT "scheduled_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboard_layouts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "widgets" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dashboard_layouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_import_jobs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "targetEntity" TEXT NOT NULL,
    "status" "DataImportStatus" NOT NULL DEFAULT 'UPLOADED',
    "sourceFileKey" TEXT NOT NULL,
    "columnMapping" JSONB NOT NULL,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "processedRows" INTEGER NOT NULL DEFAULT 0,
    "errorReportKey" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "data_import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_credentials" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "provider" "IntegrationProvider" NOT NULL,
    "environment" "IntegrationEnvironment" NOT NULL DEFAULT 'PRODUCTION',
    "encryptedPayload" BYTEA NOT NULL,
    "encryptionKeyId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastTestedAt" TIMESTAMP(3),
    "lastTestSuccess" BOOLEAN,
    "lastTestMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_health_check_logs" (
    "id" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "httpStatus" INTEGER,
    "latencyMs" INTEGER NOT NULL,
    "responseBody" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_health_check_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_ibs_cbs_regime_elections" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "regime" "IbsCbsRegimeOptante" NOT NULL,
    "semestreReferencia" TEXT NOT NULL,
    "janelaAbreEm" TIMESTAMP(3) NOT NULL,
    "janelaFechaEm" TIMESTAMP(3) NOT NULL,
    "eleitoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eleitoPorUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_ibs_cbs_regime_elections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_code_catalog_imports" (
    "id" TEXT NOT NULL,
    "catalogType" "FiscalCodeType" NOT NULL,
    "sourceDescription" TEXT NOT NULL,
    "fileName" TEXT,
    "importedByPlatformAdminUserId" TEXT NOT NULL,
    "totalCodesProcessed" INTEGER NOT NULL,
    "status" "CatalogImportStatus" NOT NULL DEFAULT 'PROCESSING',
    "errorLog" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiscal_code_catalog_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_codes" (
    "id" TEXT NOT NULL,
    "catalogImportId" TEXT NOT NULL,
    "type" "FiscalCodeType" NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiscal_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_firm_profiles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "crcNumber" TEXT NOT NULL,
    "responsibleAccountantName" TEXT NOT NULL,
    "responsibleAccountantCrc" TEXT NOT NULL,
    "bio" TEXT,
    "servicesOffered" "AccountingEngagementScope"[],
    "baseMonthlyFee" DECIMAL(10,2),
    "isListedInMarketplace" BOOLEAN NOT NULL DEFAULT false,
    "marketplaceRatingAverage" DECIMAL(2,1) NOT NULL DEFAULT 0,
    "marketplaceRatingCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_firm_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_engagements" (
    "id" TEXT NOT NULL,
    "accountingFirmTenantId" TEXT NOT NULL,
    "clientTenantId" TEXT NOT NULL,
    "scopes" "AccountingEngagementScope"[],
    "status" "AccountingEngagementStatus" NOT NULL DEFAULT 'PENDING_ACCOUNTANT_ACCEPTANCE',
    "grantedByUserId" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptanceDeadlineAt" TIMESTAMP(3) NOT NULL,
    "acceptedByUserId" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,

    CONSTRAINT "accounting_engagements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_engagement_audit_events" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "eventType" "AccountingEngagementEventType" NOT NULL,
    "actorUserId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "accounting_engagement_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_engagement_fees" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "periodicity" TEXT NOT NULL,
    "dueDay" INTEGER,
    "accountReceivableId" TEXT,
    "accountPayableId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_engagement_fees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_tasks" (
    "id" TEXT NOT NULL,
    "accountingFirmTenantId" TEXT NOT NULL,
    "clientTenantId" TEXT NOT NULL,
    "engagementId" TEXT,
    "taskType" "AccountingTaskType" NOT NULL,
    "competencia" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "AccountingTaskStatus" NOT NULL DEFAULT 'PENDING',
    "assignedUserId" TEXT,
    "completedAt" TIMESTAMP(3),
    "resultingDocumentId" TEXT,

    CONSTRAINT "accounting_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "official_tax_documents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "generatedByAccountingFirmTenantId" TEXT,
    "documentType" "OfficialTaxDocumentType" NOT NULL,
    "layoutVersion" TEXT NOT NULL,
    "competenciaInicio" TIMESTAMP(3) NOT NULL,
    "competenciaFim" TIMESTAMP(3) NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "transmissionProtocol" TEXT,
    "rejectionReason" TEXT,
    "status" "OfficialTaxDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "official_tax_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "official_document_layout_versions" (
    "id" TEXT NOT NULL,
    "documentType" "OfficialTaxDocumentType" NOT NULL,
    "layoutVersion" TEXT NOT NULL,
    "sourceDescription" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "official_document_layout_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_marketplace_reviews" (
    "id" TEXT NOT NULL,
    "accountingFirmTenantId" TEXT NOT NULL,
    "clientTenantId" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_marketplace_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_partners" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cpf" TEXT NOT NULL,
    "participationPercentage" DECIMAL(5,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_payouts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "type" "PartnerPayoutType" NOT NULL,
    "competencia" TEXT NOT NULL,
    "grossAmount" DECIMAL(12,2) NOT NULL,
    "inssWithheld" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "irrfWithheld" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(12,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_document_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fiscalDocumentId" TEXT NOT NULL,
    "eventType" "FiscalDocumentEventType" NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "justification" TEXT,
    "manifestationType" "RecipientManifestationType",
    "protocolNumber" TEXT,
    "eventXmlStorageKey" TEXT,
    "status" "FiscalDocumentStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiscal_document_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "referral_codes_tenantId_key" ON "referral_codes"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "referral_codes_code_key" ON "referral_codes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "referrals_referredTenantId_key" ON "referrals"("referredTenantId");

-- CreateIndex
CREATE INDEX "referrals_status_expiresAt_idx" ON "referrals"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_programs_tenantId_key" ON "loyalty_programs"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_accounts_clientId_key" ON "loyalty_accounts"("clientId");

-- CreateIndex
CREATE INDEX "loyalty_transactions_loyaltyAccountId_createdAt_idx" ON "loyalty_transactions"("loyaltyAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "loyalty_transactions_expiresAt_idx" ON "loyalty_transactions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_cnpj_key" ON "tenants"("cnpj");

-- CreateIndex
CREATE INDEX "tenants_status_idx" ON "tenants"("status");

-- CreateIndex
CREATE INDEX "tenants_parentTenantId_idx" ON "tenants"("parentTenantId");

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "modules_code_key" ON "modules"("code");

-- CreateIndex
CREATE INDEX "tenant_modules_tenantId_active_idx" ON "tenant_modules"("tenantId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_modules_tenantId_moduleCode_key" ON "tenant_modules"("tenantId", "moduleCode");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_externalSubscriptionId_key" ON "subscriptions"("externalSubscriptionId");

-- CreateIndex
CREATE INDEX "subscriptions_tenantId_status_idx" ON "subscriptions"("tenantId", "status");

-- CreateIndex
CREATE INDEX "billing_events_subscriptionId_createdAt_idx" ON "billing_events"("subscriptionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "billing_events_provider_externalEventKey_key" ON "billing_events"("provider", "externalEventKey");

-- CreateIndex
CREATE INDEX "users_tenantId_role_idx" ON "users"("tenantId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenantId_email_key" ON "users"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "role_default_permissions_role_permissionCode_key" ON "role_default_permissions"("role", "permissionCode");

-- CreateIndex
CREATE INDEX "role_permissions_tenantId_userId_idx" ON "role_permissions"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_userId_permission_key" ON "role_permissions"("userId", "permission");

-- CreateIndex
CREATE INDEX "clients_tenantId_name_idx" ON "clients"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "clients_tenantId_document_key" ON "clients"("tenantId", "document");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_tenantId_document_key" ON "suppliers"("tenantId", "document");

-- CreateIndex
CREATE INDEX "products_tenantId_category_idx" ON "products"("tenantId", "category");

-- CreateIndex
CREATE INDEX "products_tenantId_active_idx" ON "products"("tenantId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "products_tenantId_sku_key" ON "products"("tenantId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "products_tenantId_barcode_key" ON "products"("tenantId", "barcode");

-- CreateIndex
CREATE INDEX "product_batches_tenantId_productId_expirationDate_idx" ON "product_batches"("tenantId", "productId", "expirationDate");

-- CreateIndex
CREATE UNIQUE INDEX "product_batches_tenantId_productId_batchNumber_key" ON "product_batches"("tenantId", "productId", "batchNumber");

-- CreateIndex
CREATE INDEX "product_serials_tenantId_imei_idx" ON "product_serials"("tenantId", "imei");

-- CreateIndex
CREATE UNIQUE INDEX "product_serials_tenantId_serialNumber_key" ON "product_serials"("tenantId", "serialNumber");

-- CreateIndex
CREATE UNIQUE INDEX "product_variant_axes_tenantId_productId_name_key" ON "product_variant_axes"("tenantId", "productId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_tenantId_productId_axisValue_key" ON "product_variants"("tenantId", "productId", "axisValue");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_tenantId_barcode_key" ON "product_variants"("tenantId", "barcode");

-- CreateIndex
CREATE UNIQUE INDEX "prescription_records_saleItemId_key" ON "prescription_records"("saleItemId");

-- CreateIndex
CREATE INDEX "prescription_records_tenantId_createdAt_idx" ON "prescription_records"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "recipes_productId_key" ON "recipes"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_items_recipeId_ingredientId_key" ON "recipe_items"("recipeId", "ingredientId");

-- CreateIndex
CREATE INDEX "production_batches_tenantId_finishedProductId_producedAt_idx" ON "production_batches"("tenantId", "finishedProductId", "producedAt");

-- CreateIndex
CREATE INDEX "returnable_container_ledger_tenantId_clientId_productId_idx" ON "returnable_container_ledger"("tenantId", "clientId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_budgetApprovalToken_key" ON "work_orders"("budgetApprovalToken");

-- CreateIndex
CREATE INDEX "work_orders_tenantId_status_idx" ON "work_orders"("tenantId", "status");

-- CreateIndex
CREATE INDEX "work_orders_tenantId_assignedTechnicianId_idx" ON "work_orders"("tenantId", "assignedTechnicianId");

-- CreateIndex
CREATE INDEX "work_order_items_tenantId_workOrderId_idx" ON "work_order_items"("tenantId", "workOrderId");

-- CreateIndex
CREATE INDEX "os_checklists_tenantId_workOrderId_stage_idx" ON "os_checklists"("tenantId", "workOrderId", "stage");

-- CreateIndex
CREATE INDEX "os_photos_tenantId_workOrderId_idx" ON "os_photos"("tenantId", "workOrderId");

-- CreateIndex
CREATE INDEX "sales_tenantId_status_createdAt_idx" ON "sales"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "sales_tenantId_cashRegisterId_idx" ON "sales"("tenantId", "cashRegisterId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_tenantId_idempotencyKey_key" ON "sales"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "sale_items_tenantId_saleId_idx" ON "sale_items"("tenantId", "saleId");

-- CreateIndex
CREATE INDEX "sale_items_tenantId_productId_idx" ON "sale_items"("tenantId", "productId");

-- CreateIndex
CREATE INDEX "payments_tenantId_saleId_status_idx" ON "payments"("tenantId", "saleId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payments_tenantId_idempotencyKey_key" ON "payments"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "cash_registers_tenantId_status_idx" ON "cash_registers"("tenantId", "status");

-- CreateIndex
CREATE INDEX "stock_movements_tenantId_productId_createdAt_idx" ON "stock_movements"("tenantId", "productId", "createdAt");

-- CreateIndex
CREATE INDEX "stock_movements_tenantId_type_idx" ON "stock_movements"("tenantId", "type");

-- CreateIndex
CREATE INDEX "accounts_payable_tenantId_status_dueDate_idx" ON "accounts_payable"("tenantId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "accounts_payable_tenantId_costCenterId_idx" ON "accounts_payable"("tenantId", "costCenterId");

-- CreateIndex
CREATE INDEX "accounts_receivable_tenantId_status_dueDate_idx" ON "accounts_receivable"("tenantId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "accounts_receivable_tenantId_clientId_idx" ON "accounts_receivable"("tenantId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_documents_accessKey_key" ON "fiscal_documents"("accessKey");

-- CreateIndex
CREATE INDEX "fiscal_documents_tenantId_status_idx" ON "fiscal_documents"("tenantId", "status");

-- CreateIndex
CREATE INDEX "fiscal_documents_tenantId_saleId_idx" ON "fiscal_documents"("tenantId", "saleId");

-- CreateIndex
CREATE INDEX "tax_rules_nicheCode_uf_effectiveFrom_idx" ON "tax_rules"("nicheCode", "uf", "effectiveFrom");

-- CreateIndex
CREATE INDEX "tax_rules_tenantId_idx" ON "tax_rules"("tenantId");

-- CreateIndex
CREATE INDEX "personal_accounts_tenantId_type_idx" ON "personal_accounts"("tenantId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "personal_accounts_openFinanceConsentId_institutionName_key" ON "personal_accounts"("openFinanceConsentId", "institutionName");

-- CreateIndex
CREATE INDEX "personal_categories_tenantId_type_idx" ON "personal_categories"("tenantId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "personal_transactions_openFinanceExternalId_key" ON "personal_transactions"("openFinanceExternalId");

-- CreateIndex
CREATE INDEX "personal_transactions_tenantId_accountId_transactionDate_idx" ON "personal_transactions"("tenantId", "accountId", "transactionDate");

-- CreateIndex
CREATE INDEX "personal_transactions_tenantId_categoryId_transactionDate_idx" ON "personal_transactions"("tenantId", "categoryId", "transactionDate");

-- CreateIndex
CREATE UNIQUE INDEX "personal_transaction_splits_transactionId_userId_key" ON "personal_transaction_splits"("transactionId", "userId");

-- CreateIndex
CREATE INDEX "personal_recurrence_rules_tenantId_active_nextOccurrenceAt_idx" ON "personal_recurrence_rules"("tenantId", "active", "nextOccurrenceAt");

-- CreateIndex
CREATE UNIQUE INDEX "personal_budgets_tenantId_categoryId_monthReference_key" ON "personal_budgets"("tenantId", "categoryId", "monthReference");

-- CreateIndex
CREATE INDEX "personal_goals_tenantId_status_idx" ON "personal_goals"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "personal_investments_openFinanceExternalId_key" ON "personal_investments"("openFinanceExternalId");

-- CreateIndex
CREATE INDEX "personal_investments_tenantId_assetType_idx" ON "personal_investments"("tenantId", "assetType");

-- CreateIndex
CREATE UNIQUE INDEX "personal_investment_price_history_investmentId_priceDate_key" ON "personal_investment_price_history"("investmentId", "priceDate");

-- CreateIndex
CREATE INDEX "personal_debts_tenantId_status_idx" ON "personal_debts"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "personal_debt_installments_debtId_installmentNumber_key" ON "personal_debt_installments"("debtId", "installmentNumber");

-- CreateIndex
CREATE INDEX "personal_bills_tenantId_status_dueDay_idx" ON "personal_bills"("tenantId", "status", "dueDay");

-- CreateIndex
CREATE UNIQUE INDEX "net_worth_snapshots_tenantId_snapshotDate_key" ON "net_worth_snapshots"("tenantId", "snapshotDate");

-- CreateIndex
CREATE UNIQUE INDEX "open_finance_consents_itemId_key" ON "open_finance_consents"("itemId");

-- CreateIndex
CREATE INDEX "open_finance_consents_tenantId_status_idx" ON "open_finance_consents"("tenantId", "status");

-- CreateIndex
CREATE INDEX "cash_register_movements_cashRegisterId_createdAt_idx" ON "cash_register_movements"("cashRegisterId", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_tenantId_userId_readAt_idx" ON "notifications"("tenantId", "userId", "readAt");

-- CreateIndex
CREATE INDEX "notifications_tenantId_createdAt_idx" ON "notifications"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_userId_category_key" ON "notification_preferences"("userId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "push_device_tokens_expoPushToken_key" ON "push_device_tokens"("expoPushToken");

-- CreateIndex
CREATE INDEX "push_device_tokens_tenantId_userId_idx" ON "push_device_tokens"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "legal_document_versions_documentType_version_key" ON "legal_document_versions"("documentType", "version");

-- CreateIndex
CREATE UNIQUE INDEX "online_store_settings_tenantId_key" ON "online_store_settings"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "online_store_settings_customSlug_key" ON "online_store_settings"("customSlug");

-- CreateIndex
CREATE INDEX "services_tenantId_nicheTag_idx" ON "services"("tenantId", "nicheTag");

-- CreateIndex
CREATE INDEX "appointments_tenantId_clientId_idx" ON "appointments"("tenantId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_tenantId_professionalId_scheduledAt_key" ON "appointments"("tenantId", "professionalId", "scheduledAt");

-- CreateIndex
CREATE INDEX "client_service_packages_tenantId_clientId_serviceId_idx" ON "client_service_packages"("tenantId", "clientId", "serviceId");

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_tables_tenantId_label_key" ON "restaurant_tables"("tenantId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "comandas_saleId_key" ON "comandas"("saleId");

-- CreateIndex
CREATE INDEX "comandas_tenantId_status_idx" ON "comandas"("tenantId", "status");

-- CreateIndex
CREATE INDEX "comanda_items_tenantId_comandaId_idx" ON "comanda_items"("tenantId", "comandaId");

-- CreateIndex
CREATE INDEX "optical_prescriptions_tenantId_clientId_idx" ON "optical_prescriptions"("tenantId", "clientId");

-- CreateIndex
CREATE INDEX "pets_tenantId_ownerId_idx" ON "pets"("tenantId", "ownerId");

-- CreateIndex
CREATE INDEX "vaccine_records_tenantId_petId_nextDoseDueAt_idx" ON "vaccine_records"("tenantId", "petId", "nextDoseDueAt");

-- CreateIndex
CREATE INDEX "vehicles_tenantId_ownerId_idx" ON "vehicles"("tenantId", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_tenantId_licensePlate_key" ON "vehicles"("tenantId", "licensePlate");

-- CreateIndex
CREATE INDEX "vehicle_listings_tenantId_status_idx" ON "vehicle_listings"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_listings_tenantId_chassisNumber_key" ON "vehicle_listings"("tenantId", "chassisNumber");

-- CreateIndex
CREATE UNIQUE INDEX "platform_admin_users_email_key" ON "platform_admin_users"("email");

-- CreateIndex
CREATE INDEX "audit_logs_targetType_targetId_idx" ON "audit_logs"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "audit_logs_platformAdminUserId_createdAt_idx" ON "audit_logs"("platformAdminUserId", "createdAt");

-- CreateIndex
CREATE INDEX "impersonation_sessions_tenantId_startedAt_idx" ON "impersonation_sessions"("tenantId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "discount_coupons_code_key" ON "discount_coupons"("code");

-- CreateIndex
CREATE UNIQUE INDEX "release_notes_version_key" ON "release_notes"("version");

-- CreateIndex
CREATE INDEX "two_factor_backup_codes_platformAdminUserId_usedAt_idx" ON "two_factor_backup_codes"("platformAdminUserId", "usedAt");

-- CreateIndex
CREATE INDEX "two_factor_backup_codes_userId_usedAt_idx" ON "two_factor_backup_codes"("userId", "usedAt");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_tokenHash_key" ON "password_reset_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_tokenHash_idx" ON "password_reset_tokens"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "active_sessions_refreshTokenHash_key" ON "active_sessions"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "active_sessions_platformAdminUserId_idx" ON "active_sessions"("platformAdminUserId");

-- CreateIndex
CREATE INDEX "active_sessions_userId_idx" ON "active_sessions"("userId");

-- CreateIndex
CREATE INDEX "incident_events_component_startedAt_idx" ON "incident_events"("component", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "feature_flags_key_key" ON "feature_flags"("key");

-- CreateIndex
CREATE INDEX "support_tickets_tenantId_status_idx" ON "support_tickets"("tenantId", "status");

-- CreateIndex
CREATE INDEX "support_tickets_assignedToPlatformAdminUserId_status_idx" ON "support_tickets"("assignedToPlatformAdminUserId", "status");

-- CreateIndex
CREATE INDEX "support_ticket_messages_ticketId_createdAt_idx" ON "support_ticket_messages"("ticketId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_api_keys_keyHash_key" ON "tenant_api_keys"("keyHash");

-- CreateIndex
CREATE INDEX "tenant_api_keys_tenantId_revokedAt_idx" ON "tenant_api_keys"("tenantId", "revokedAt");

-- CreateIndex
CREATE INDEX "tenant_webhook_endpoints_tenantId_active_idx" ON "tenant_webhook_endpoints"("tenantId", "active");

-- CreateIndex
CREATE INDEX "webhook_deliveries_endpointId_deliveredAt_idx" ON "webhook_deliveries"("endpointId", "deliveredAt");

-- CreateIndex
CREATE UNIQUE INDEX "chart_of_accounts_tenantId_code_key" ON "chart_of_accounts"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "cost_centers_tenantId_code_key" ON "cost_centers"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_openFinanceConsentId_openFinanceExternalAccou_key" ON "bank_accounts"("openFinanceConsentId", "openFinanceExternalAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transactions_tenantId_bankAccountId_externalFitId_key" ON "bank_transactions"("tenantId", "bankAccountId", "externalFitId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_charges_accountReceivableId_key" ON "payment_charges"("accountReceivableId");

-- CreateIndex
CREATE INDEX "payment_charges_tenantId_status_idx" ON "payment_charges"("tenantId", "status");

-- CreateIndex
CREATE INDEX "purchase_orders_tenantId_status_idx" ON "purchase_orders"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_tenantId_orderNumber_key" ON "purchase_orders"("tenantId", "orderNumber");

-- CreateIndex
CREATE INDEX "purchase_order_items_tenantId_purchaseOrderId_idx" ON "purchase_order_items"("tenantId", "purchaseOrderId");

-- CreateIndex
CREATE INDEX "inventory_counts_tenantId_status_idx" ON "inventory_counts"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_counts_tenantId_code_key" ON "inventory_counts"("tenantId", "code");

-- CreateIndex
CREATE INDEX "inventory_count_items_inventoryCountId_idx" ON "inventory_count_items"("inventoryCountId");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_count_items_inventoryCountId_productId_productBat_key" ON "inventory_count_items"("inventoryCountId", "productId", "productBatchId");

-- CreateIndex
CREATE INDEX "report_definitions_tenantId_isPinnedToDashboard_idx" ON "report_definitions"("tenantId", "isPinnedToDashboard");

-- CreateIndex
CREATE INDEX "scheduled_reports_tenantId_active_idx" ON "scheduled_reports"("tenantId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "dashboard_layouts_userId_key" ON "dashboard_layouts"("userId");

-- CreateIndex
CREATE INDEX "dashboard_layouts_tenantId_idx" ON "dashboard_layouts"("tenantId");

-- CreateIndex
CREATE INDEX "data_import_jobs_tenantId_status_idx" ON "data_import_jobs"("tenantId", "status");

-- CreateIndex
CREATE INDEX "integration_credentials_provider_active_idx" ON "integration_credentials"("provider", "active");

-- CreateIndex
CREATE UNIQUE INDEX "integration_credentials_tenantId_provider_environment_key" ON "integration_credentials"("tenantId", "provider", "environment");

-- CreateIndex
CREATE INDEX "integration_health_check_logs_credentialId_createdAt_idx" ON "integration_health_check_logs"("credentialId", "createdAt");

-- CreateIndex
CREATE INDEX "tenant_ibs_cbs_regime_elections_tenantId_eleitoEm_idx" ON "tenant_ibs_cbs_regime_elections"("tenantId", "eleitoEm");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_ibs_cbs_regime_elections_tenantId_semestreReferencia_key" ON "tenant_ibs_cbs_regime_elections"("tenantId", "semestreReferencia");

-- CreateIndex
CREATE INDEX "fiscal_code_catalog_imports_catalogType_createdAt_idx" ON "fiscal_code_catalog_imports"("catalogType", "createdAt");

-- CreateIndex
CREATE INDEX "fiscal_codes_type_code_effectiveTo_idx" ON "fiscal_codes"("type", "code", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_codes_type_code_effectiveFrom_key" ON "fiscal_codes"("type", "code", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_firm_profiles_tenantId_key" ON "accounting_firm_profiles"("tenantId");

-- CreateIndex
CREATE INDEX "accounting_engagements_accountingFirmTenantId_status_idx" ON "accounting_engagements"("accountingFirmTenantId", "status");

-- CreateIndex
CREATE INDEX "accounting_engagements_clientTenantId_status_idx" ON "accounting_engagements"("clientTenantId", "status");

-- CreateIndex
CREATE INDEX "accounting_engagement_audit_events_engagementId_occurredAt_idx" ON "accounting_engagement_audit_events"("engagementId", "occurredAt");

-- CreateIndex
CREATE INDEX "accounting_tasks_accountingFirmTenantId_status_dueDate_idx" ON "accounting_tasks"("accountingFirmTenantId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "accounting_tasks_clientTenantId_competencia_idx" ON "accounting_tasks"("clientTenantId", "competencia");

-- CreateIndex
CREATE INDEX "official_tax_documents_tenantId_documentType_competenciaIni_idx" ON "official_tax_documents"("tenantId", "documentType", "competenciaInicio");

-- CreateIndex
CREATE INDEX "official_document_layout_versions_documentType_effectiveFro_idx" ON "official_document_layout_versions"("documentType", "effectiveFrom");

-- CreateIndex
CREATE INDEX "accounting_marketplace_reviews_accountingFirmTenantId_idx" ON "accounting_marketplace_reviews"("accountingFirmTenantId");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_marketplace_reviews_engagementId_authorUserId_key" ON "accounting_marketplace_reviews"("engagementId", "authorUserId");

-- CreateIndex
CREATE UNIQUE INDEX "company_partners_tenantId_cpf_key" ON "company_partners"("tenantId", "cpf");

-- CreateIndex
CREATE INDEX "partner_payouts_tenantId_partnerId_competencia_idx" ON "partner_payouts"("tenantId", "partnerId", "competencia");

-- CreateIndex
CREATE INDEX "fiscal_document_events_tenantId_fiscalDocumentId_idx" ON "fiscal_document_events"("tenantId", "fiscalDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_document_events_fiscalDocumentId_eventType_sequenceN_key" ON "fiscal_document_events"("fiscalDocumentId", "eventType", "sequenceNumber");

-- AddForeignKey
ALTER TABLE "referral_codes" ADD CONSTRAINT "referral_codes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referralCodeId_fkey" FOREIGN KEY ("referralCodeId") REFERENCES "referral_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referredTenantId_fkey" FOREIGN KEY ("referredTenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_programs" ADD CONSTRAINT "loyalty_programs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_accounts" ADD CONSTRAINT "loyalty_accounts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_accounts" ADD CONSTRAINT "loyalty_accounts_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_loyaltyAccountId_fkey" FOREIGN KEY ("loyaltyAccountId") REFERENCES "loyalty_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_parentTenantId_fkey" FOREIGN KEY ("parentTenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_modules" ADD CONSTRAINT "tenant_modules_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_modules" ADD CONSTRAINT "tenant_modules_moduleCode_fkey" FOREIGN KEY ("moduleCode") REFERENCES "modules"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_preferredSupplierId_fkey" FOREIGN KEY ("preferredSupplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_batches" ADD CONSTRAINT "product_batches_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_batches" ADD CONSTRAINT "product_batches_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_serials" ADD CONSTRAINT "product_serials_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_serials" ADD CONSTRAINT "product_serials_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_serials" ADD CONSTRAINT "product_serials_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variant_axes" ADD CONSTRAINT "product_variant_axes_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_axisId_fkey" FOREIGN KEY ("axisId") REFERENCES "product_variant_axes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_records" ADD CONSTRAINT "prescription_records_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_records" ADD CONSTRAINT "prescription_records_saleItemId_fkey" FOREIGN KEY ("saleItemId") REFERENCES "sale_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_batches" ADD CONSTRAINT "production_batches_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_batches" ADD CONSTRAINT "production_batches_finishedProductId_fkey" FOREIGN KEY ("finishedProductId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returnable_container_ledger" ADD CONSTRAINT "returnable_container_ledger_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returnable_container_ledger" ADD CONSTRAINT "returnable_container_ledger_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_assignedTechnicianId_fkey" FOREIGN KEY ("assignedTechnicianId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_items" ADD CONSTRAINT "work_order_items_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_items" ADD CONSTRAINT "work_order_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "os_checklists" ADD CONSTRAINT "os_checklists_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "os_photos" ADD CONSTRAINT "os_photos_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "os_photos" ADD CONSTRAINT "os_photos_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_cashRegisterId_fkey" FOREIGN KEY ("cashRegisterId") REFERENCES "cash_registers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_chartOfAccountId_fkey" FOREIGN KEY ("chartOfAccountId") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_refundedByUserId_fkey" FOREIGN KEY ("refundedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_refundAuthorizedByUserId_fkey" FOREIGN KEY ("refundAuthorizedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_registers" ADD CONSTRAINT "cash_registers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_registers" ADD CONSTRAINT "cash_registers_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_productBatchId_fkey" FOREIGN KEY ("productBatchId") REFERENCES "product_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts_payable" ADD CONSTRAINT "accounts_payable_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts_payable" ADD CONSTRAINT "accounts_payable_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts_payable" ADD CONSTRAINT "accounts_payable_chartOfAccountId_fkey" FOREIGN KEY ("chartOfAccountId") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts_payable" ADD CONSTRAINT "accounts_payable_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts_payable" ADD CONSTRAINT "accounts_payable_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts_receivable" ADD CONSTRAINT "accounts_receivable_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts_receivable" ADD CONSTRAINT "accounts_receivable_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts_receivable" ADD CONSTRAINT "accounts_receivable_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts_receivable" ADD CONSTRAINT "accounts_receivable_chartOfAccountId_fkey" FOREIGN KEY ("chartOfAccountId") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_documents" ADD CONSTRAINT "fiscal_documents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_documents" ADD CONSTRAINT "fiscal_documents_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rules" ADD CONSTRAINT "tax_rules_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_accounts" ADD CONSTRAINT "personal_accounts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_accounts" ADD CONSTRAINT "personal_accounts_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_accounts" ADD CONSTRAINT "personal_accounts_openFinanceConsentId_fkey" FOREIGN KEY ("openFinanceConsentId") REFERENCES "open_finance_consents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_categories" ADD CONSTRAINT "personal_categories_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_categories" ADD CONSTRAINT "personal_categories_parentCategoryId_fkey" FOREIGN KEY ("parentCategoryId") REFERENCES "personal_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_transactions" ADD CONSTRAINT "personal_transactions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_transactions" ADD CONSTRAINT "personal_transactions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "personal_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_transactions" ADD CONSTRAINT "personal_transactions_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "personal_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_transactions" ADD CONSTRAINT "personal_transactions_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_transactions" ADD CONSTRAINT "personal_transactions_recurrenceRuleId_fkey" FOREIGN KEY ("recurrenceRuleId") REFERENCES "personal_recurrence_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_transaction_splits" ADD CONSTRAINT "personal_transaction_splits_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "personal_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_transaction_splits" ADD CONSTRAINT "personal_transaction_splits_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_recurrence_rules" ADD CONSTRAINT "personal_recurrence_rules_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_budgets" ADD CONSTRAINT "personal_budgets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_budgets" ADD CONSTRAINT "personal_budgets_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "personal_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_goals" ADD CONSTRAINT "personal_goals_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_goals" ADD CONSTRAINT "personal_goals_linkedAccountId_fkey" FOREIGN KEY ("linkedAccountId") REFERENCES "personal_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_investments" ADD CONSTRAINT "personal_investments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_investments" ADD CONSTRAINT "personal_investments_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "personal_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_investment_price_history" ADD CONSTRAINT "personal_investment_price_history_investmentId_fkey" FOREIGN KEY ("investmentId") REFERENCES "personal_investments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_debts" ADD CONSTRAINT "personal_debts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_debt_installments" ADD CONSTRAINT "personal_debt_installments_debtId_fkey" FOREIGN KEY ("debtId") REFERENCES "personal_debts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_bills" ADD CONSTRAINT "personal_bills_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_bills" ADD CONSTRAINT "personal_bills_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "personal_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_bills" ADD CONSTRAINT "personal_bills_autoDebitAccountId_fkey" FOREIGN KEY ("autoDebitAccountId") REFERENCES "personal_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "net_worth_snapshots" ADD CONSTRAINT "net_worth_snapshots_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "open_finance_consents" ADD CONSTRAINT "open_finance_consents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_register_movements" ADD CONSTRAINT "cash_register_movements_cashRegisterId_fkey" FOREIGN KEY ("cashRegisterId") REFERENCES "cash_registers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_register_movements" ADD CONSTRAINT "cash_register_movements_performedByUserId_fkey" FOREIGN KEY ("performedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_device_tokens" ADD CONSTRAINT "push_device_tokens_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_device_tokens" ADD CONSTRAINT "push_device_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "online_store_settings" ADD CONSTRAINT "online_store_settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_petId_fkey" FOREIGN KEY ("petId") REFERENCES "pets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_service_packages" ADD CONSTRAINT "client_service_packages_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_service_packages" ADD CONSTRAINT "client_service_packages_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_service_packages" ADD CONSTRAINT "client_service_packages_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_tables" ADD CONSTRAINT "restaurant_tables_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comandas" ADD CONSTRAINT "comandas_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comandas" ADD CONSTRAINT "comandas_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "restaurant_tables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comandas" ADD CONSTRAINT "comandas_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comandas" ADD CONSTRAINT "comandas_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comanda_items" ADD CONSTRAINT "comanda_items_comandaId_fkey" FOREIGN KEY ("comandaId") REFERENCES "comandas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comanda_items" ADD CONSTRAINT "comanda_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comanda_items" ADD CONSTRAINT "comanda_items_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "optical_prescriptions" ADD CONSTRAINT "optical_prescriptions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "optical_prescriptions" ADD CONSTRAINT "optical_prescriptions_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pets" ADD CONSTRAINT "pets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pets" ADD CONSTRAINT "pets_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaccine_records" ADD CONSTRAINT "vaccine_records_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaccine_records" ADD CONSTRAINT "vaccine_records_petId_fkey" FOREIGN KEY ("petId") REFERENCES "pets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_listings" ADD CONSTRAINT "vehicle_listings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_listings" ADD CONSTRAINT "vehicle_listings_consignorClientId_fkey" FOREIGN KEY ("consignorClientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_platformAdminUserId_fkey" FOREIGN KEY ("platformAdminUserId") REFERENCES "platform_admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "impersonation_sessions" ADD CONSTRAINT "impersonation_sessions_platformAdminUserId_fkey" FOREIGN KEY ("platformAdminUserId") REFERENCES "platform_admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "impersonation_sessions" ADD CONSTRAINT "impersonation_sessions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "two_factor_backup_codes" ADD CONSTRAINT "two_factor_backup_codes_platformAdminUserId_fkey" FOREIGN KEY ("platformAdminUserId") REFERENCES "platform_admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "two_factor_backup_codes" ADD CONSTRAINT "two_factor_backup_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_platformAdminUserId_fkey" FOREIGN KEY ("platformAdminUserId") REFERENCES "platform_admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "active_sessions" ADD CONSTRAINT "active_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "active_sessions" ADD CONSTRAINT "active_sessions_platformAdminUserId_fkey" FOREIGN KEY ("platformAdminUserId") REFERENCES "platform_admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_ip_allowlist_entries" ADD CONSTRAINT "admin_ip_allowlist_entries_platformAdminUserId_fkey" FOREIGN KEY ("platformAdminUserId") REFERENCES "platform_admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_ticket_messages" ADD CONSTRAINT "support_ticket_messages_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "support_tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "tenant_webhook_endpoints"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "chart_of_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_openFinanceConsentId_fkey" FOREIGN KEY ("openFinanceConsentId") REFERENCES "open_finance_consents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_startedByUserId_fkey" FOREIGN KEY ("startedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_items" ADD CONSTRAINT "inventory_count_items_inventoryCountId_fkey" FOREIGN KEY ("inventoryCountId") REFERENCES "inventory_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_items" ADD CONSTRAINT "inventory_count_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_items" ADD CONSTRAINT "inventory_count_items_productBatchId_fkey" FOREIGN KEY ("productBatchId") REFERENCES "product_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_items" ADD CONSTRAINT "inventory_count_items_countedByUserId_fkey" FOREIGN KEY ("countedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_definitions" ADD CONSTRAINT "report_definitions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_definitions" ADD CONSTRAINT "report_definitions_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_reports" ADD CONSTRAINT "scheduled_reports_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_reports" ADD CONSTRAINT "scheduled_reports_reportDefinitionId_fkey" FOREIGN KEY ("reportDefinitionId") REFERENCES "report_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboard_layouts" ADD CONSTRAINT "dashboard_layouts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboard_layouts" ADD CONSTRAINT "dashboard_layouts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_import_jobs" ADD CONSTRAINT "data_import_jobs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_import_jobs" ADD CONSTRAINT "data_import_jobs_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_ibs_cbs_regime_elections" ADD CONSTRAINT "tenant_ibs_cbs_regime_elections_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_ibs_cbs_regime_elections" ADD CONSTRAINT "tenant_ibs_cbs_regime_elections_eleitoPorUserId_fkey" FOREIGN KEY ("eleitoPorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_code_catalog_imports" ADD CONSTRAINT "fiscal_code_catalog_imports_importedByPlatformAdminUserId_fkey" FOREIGN KEY ("importedByPlatformAdminUserId") REFERENCES "platform_admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_codes" ADD CONSTRAINT "fiscal_codes_catalogImportId_fkey" FOREIGN KEY ("catalogImportId") REFERENCES "fiscal_code_catalog_imports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_firm_profiles" ADD CONSTRAINT "accounting_firm_profiles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_engagements" ADD CONSTRAINT "accounting_engagements_accountingFirmTenantId_fkey" FOREIGN KEY ("accountingFirmTenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_engagements" ADD CONSTRAINT "accounting_engagements_clientTenantId_fkey" FOREIGN KEY ("clientTenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_engagement_audit_events" ADD CONSTRAINT "accounting_engagement_audit_events_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "accounting_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_engagement_fees" ADD CONSTRAINT "accounting_engagement_fees_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "accounting_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_tasks" ADD CONSTRAINT "accounting_tasks_accountingFirmTenantId_fkey" FOREIGN KEY ("accountingFirmTenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_tasks" ADD CONSTRAINT "accounting_tasks_clientTenantId_fkey" FOREIGN KEY ("clientTenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_tasks" ADD CONSTRAINT "accounting_tasks_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "accounting_engagements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "official_tax_documents" ADD CONSTRAINT "official_tax_documents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "official_tax_documents" ADD CONSTRAINT "official_tax_documents_generatedByAccountingFirmTenantId_fkey" FOREIGN KEY ("generatedByAccountingFirmTenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_marketplace_reviews" ADD CONSTRAINT "accounting_marketplace_reviews_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "accounting_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_partners" ADD CONSTRAINT "company_partners_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_payouts" ADD CONSTRAINT "partner_payouts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_payouts" ADD CONSTRAINT "partner_payouts_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "company_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_document_events" ADD CONSTRAINT "fiscal_document_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_document_events" ADD CONSTRAINT "fiscal_document_events_fiscalDocumentId_fkey" FOREIGN KEY ("fiscalDocumentId") REFERENCES "fiscal_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;


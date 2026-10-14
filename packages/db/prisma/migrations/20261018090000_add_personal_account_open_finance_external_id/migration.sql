-- Capítulo 22.5 — fecha o gap de auditoria do worker real de sincronização Pluggy:
-- `PersonalAccount` só tinha `openFinanceConsentId`, com idempotência (incorretamente)
-- chaveada em `institutionName`, o que mescla duas contas reais distintas da mesma
-- instituição (ex.: conta corrente + cartão de crédito do mesmo banco) em uma única
-- linha. Adiciona o id lógico real da conta no agregador (mesmo papel de
-- `BankAccount.openFinanceExternalAccountId` no lado BUSINESS) e substitui a
-- constraint de unicidade antiga por uma chaveada no identificador real do agregador.
-- NOTA: escrita manualmente (ambiente sandbox sem acesso a um Postgres local/shadow
-- database para rodar `prisma migrate dev` de verdade — mesma limitação documentada
-- em outras migrations recentes, ex.: 20261017094500_add_user_whatsapp_phone).

-- DropIndex
DROP INDEX IF EXISTS "personal_accounts_openFinanceConsentId_institutionName_key";

-- AlterTable
ALTER TABLE "personal_accounts" ADD COLUMN "openFinanceExternalAccountId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "personal_accounts_openFinanceConsentId_openFinanceExternal_key" ON "personal_accounts"("openFinanceConsentId", "openFinanceExternalAccountId");

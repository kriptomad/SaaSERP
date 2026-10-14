// apps/api/src/workers/pluggy-sync.worker.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 17.4.1 (Open Finance empresarial) e 22.5
// (Open Finance pessoal) — consumidor real do job "sync-open-finance-item" enfileirado
// por `pluggy-webhook.routes.ts` (evento `item/updated`/`item/created`) e pelas rotas
// de "sincronizar agora" (`bank-reconciliation.routes.ts` / `personal-planning.routes.ts`).
// Fecha o gap de auditoria em que `OpenFinanceConsent` existia desde o Capítulo 22.5,
// mas nenhum worker jamais chamava a API real da Pluggy para buscar contas/transações
// — apenas o CRUD do consentimento (assumindo que o widget client-side já tinha
// rodado) existia.
//
// GAP TAMBÉM FECHADO para o lado BUSINESS: o comentário em `schema.prisma` no model
// `BankAccount` já dizia "a conta vinculada via Open Finance (Caminho A) é criada pelo
// worker de sincronização (Capítulo 22.5/17.4.1), nunca por esta rota" — este arquivo
// é, literalmente, esse worker.
//
// Executa dentro de `runWithTenantContext` (mesmo contrato de AsyncLocalStorage usado
// pelas requisições HTTP autenticadas), exatamente como `fiscal-emission.worker.ts` —
// cada job já chega com exatamente um `tenantId` (o dono do `OpenFinanceConsent`),
// nunca cross-tenant.
import { Worker, Job } from "bullmq";
import { prisma, prismaUnscoped, runWithTenantContext } from "@filitech/db";
import { queueRedisConnection, QUEUE_NAMES } from "../lib/queue";
import { fetchPluggyAccounts, fetchPluggyTransactions, PluggyAccount } from "../lib/pluggy-client";

interface PluggySyncJobData {
  itemId: string;
  consentId: string;
}

// Janela de busca de transações: 90 dias corridos, ou desde o último sync bem
// sucedido (`OpenFinanceConsent.lastSyncedAt`), o que for mais recente — nunca refaz
// os últimos 90 dias inteiros a cada "item/updated" incremental, mas cobre o primeiro
// sync completo de um consentimento novo.
const FALLBACK_WINDOW_DAYS = 90;

function resolveSyncWindowStart(lastSyncedAt: Date | null): Date {
  const fallback = new Date(Date.now() - FALLBACK_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  if (!lastSyncedAt) return fallback;
  return lastSyncedAt < fallback ? fallback : lastSyncedAt;
}

async function syncBusinessBankAccounts(tenantId: string, consentId: string, accounts: PluggyAccount[], windowStart: Date) {
  let accountsUpserted = 0;
  let transactionsImported = 0;

  for (const account of accounts) {
    const bankAccount = await prisma.bankAccount.upsert({
      where: { openFinanceConsentId_openFinanceExternalAccountId: { openFinanceConsentId: consentId, openFinanceExternalAccountId: account.id } },
      create: {
        tenantId,
        bankName: account.marketingName || account.name,
        agencyNumber: "—", // Pluggy não expõe agência isoladamente no objeto Account (apenas `number`/`transferNumber` dentro de `bankData`) — campo preenchido com placeholder documentado, nunca inventado como um número real.
        accountNumber: account.number,
        currentBalance: account.balance,
        openFinanceConsentId: consentId,
        openFinanceExternalAccountId: account.id,
      },
      update: {
        bankName: account.marketingName || account.name,
        accountNumber: account.number,
        currentBalance: account.balance,
      },
    });
    accountsUpserted += 1;

    const transactions = await fetchPluggyTransactions(account.id, windowStart, new Date());
    // `@@unique([tenantId, bankAccountId, externalFitId])` + `createMany({ skipDuplicates: true })`
    // — aqui `externalFitId` recebe o id real da transação no agregador (Pluggy),
    // exatamente como o comentário do campo no schema já documentava ("...OU id da
    // transação no agregador Open Finance, sincronização automática, Capítulo 17.4.1").
    const result = await prisma.bankTransaction.createMany({
      data: transactions.map((t) => ({
        tenantId,
        bankAccountId: bankAccount.id,
        externalFitId: t.id,
        description: t.description,
        amount: t.amount,
        transactionDate: new Date(t.date),
      })),
      skipDuplicates: true,
    });
    transactionsImported += result.count;
  }

  return { accountsUpserted, transactionsImported };
}

async function syncPersonalAccounts(tenantId: string, consentId: string, accounts: PluggyAccount[], windowStart: Date) {
  let accountsUpserted = 0;
  let transactionsImported = 0;

  const personalAccountTypeByPluggy: Record<string, "CHECKING" | "SAVINGS" | "CREDIT_CARD"> = {
    CHECKING_ACCOUNT: "CHECKING",
    SAVINGS_ACCOUNT: "SAVINGS",
    CREDIT_CARD: "CREDIT_CARD",
  };

  for (const account of accounts) {
    const personalAccount = await prisma.personalAccount.upsert({
      where: { openFinanceConsentId_openFinanceExternalAccountId: { openFinanceConsentId: consentId, openFinanceExternalAccountId: account.id } },
      create: {
        tenantId,
        name: account.marketingName || account.name,
        type: personalAccountTypeByPluggy[account.subtype] ?? "CHECKING",
        institutionName: account.marketingName || account.name,
        currentBalance: account.balance,
        openFinanceConsentId: consentId,
        openFinanceExternalAccountId: account.id,
      },
      update: {
        name: account.marketingName || account.name,
        currentBalance: account.balance,
      },
    });
    accountsUpserted += 1;

    const transactions = await fetchPluggyTransactions(account.id, windowStart, new Date());

    // Idempotente via `PersonalTransaction.openFinanceExternalId @unique` (Capítulo
    // 22.5) — mesmo princípio do lado BUSINESS, chave real do agregador em vez de id
    // interno. `createdByUserId` exige um User real (FK obrigatória); como não existe
    // um ator humano por trás de uma sincronização automática, usa o próprio dono da
    // conta (`ownerId`) quando presente, ou o primeiro OWNER do tenant como fallback
    // — nunca um `createdByUserId` inventado/fictício.
    const fallbackUserId = personalAccount.ownerId ?? (await prisma.user.findFirstOrThrow({ where: { tenantId }, orderBy: { createdAt: "asc" } })).id;

    for (const t of transactions) {
      await prisma.personalTransaction.upsert({
        where: { openFinanceExternalId: t.id },
        create: {
          tenantId,
          accountId: personalAccount.id,
          createdByUserId: fallbackUserId,
          description: t.description,
          merchantName: t.descriptionRaw ?? null,
          type: t.amount >= 0 ? "INCOME" : "EXPENSE",
          amount: Math.abs(t.amount),
          transactionDate: new Date(t.date),
          openFinanceExternalId: t.id,
        },
        // Reimportar nunca sobrescreve uma transação já categorizada/editada manualmente
        // pelo usuário — apenas garante a existência (idempotência), igual ao
        // comportamento do `createMany({ skipDuplicates: true })` do lado BUSINESS.
        update: {},
      });
      transactionsImported += 1;
    }
  }

  return { accountsUpserted, transactionsImported };
}

export async function pluggySyncProcessor(job: Job<PluggySyncJobData>): Promise<{ accountsUpserted: number; transactionsImported: number }> {
  const { itemId, consentId } = job.data;

  // Fora de `runWithTenantContext` por necessidade: ainda não sabemos o tenantId do
  // consentimento (é exatamente o que esta consulta resolve) — usa o client
  // `prismaUnscoped`, nunca o tenant-scoped, para este único lookup inicial.
  const consent = await prismaUnscoped.openFinanceConsent.findUniqueOrThrow({ where: { id: consentId } });
  const tenant = await prismaUnscoped.tenant.findUniqueOrThrow({ where: { id: consent.tenantId }, select: { tenantType: true } });
  const windowStart = resolveSyncWindowStart(consent.lastSyncedAt);

  return runWithTenantContext({ tenantId: consent.tenantId, userId: "system-worker", role: "SYSTEM_WORKER" }, async () => {
    const accounts = await fetchPluggyAccounts(itemId);

    const result =
      tenant.tenantType === "PERSONAL"
        ? await syncPersonalAccounts(consent.tenantId, consentId, accounts, windowStart)
        : await syncBusinessBankAccounts(consent.tenantId, consentId, accounts, windowStart);

    await prisma.openFinanceConsent.update({
      where: { id: consentId },
      data: { status: "UPDATED", lastSyncedAt: new Date() },
    });

    return result;
  });
}

export function startPluggySyncWorker(): Worker {
  return new Worker<PluggySyncJobData>(QUEUE_NAMES.PLUGGY_SYNC, pluggySyncProcessor, {
    connection: queueRedisConnection,
    concurrency: 3,
  });
}

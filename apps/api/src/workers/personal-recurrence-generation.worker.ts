// apps/api/src/workers/personal-recurrence-generation.worker.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 22.4 — motor de recorrência do Filitech
// Pessoal: varredura diária que gera automaticamente a próxima PersonalTransaction de
// cada PersonalRecurrenceRule ativa cujo `nextOccurrenceAt` já chegou (salário,
// aluguel, assinaturas), sem nenhuma intervenção manual do usuário, e já deixa
// `nextOccurrenceAt` apontando para a ocorrência seguinte (idempotente por natureza:
// uma regra só é processada de novo quando a nova data chegar).
import { Worker, Job } from "bullmq";
import { prismaUnscoped } from "@filitech/db";
import { queueRedisConnection, QUEUE_NAMES, personalRecurrenceGenerationQueue } from "../lib/queue";
import { notifyTenant } from "../modules/notifications/notify.service";
import { createModuleLogger } from "../lib/logger";

const log = createModuleLogger("personal-recurrence-generation.worker");

const REPEATABLE_JOB_NAME = "daily-sweep";
const DAILY_CRON_4AM = "0 4 * * *";

// Avança `nextOccurrenceAt` conforme a frequência da regra. MONTHLY/YEARLY usam
// `dayOfMonth` para corrigir o dia (ex.: regra criada dia 31/jan avançando para
// fevereiro cai no dia 28/29, não no dia 3 de março) — sem isso, `setMonth` do próprio
// JS "transborda" silenciosamente para o mês seguinte em meses mais curtos.
function computeNextOccurrence(current: Date, frequency: "WEEKLY" | "MONTHLY" | "YEARLY", dayOfMonth: number | null): Date {
  const next = new Date(current);
  if (frequency === "WEEKLY") {
    next.setUTCDate(next.getUTCDate() + 7);
    return next;
  }
  const monthsToAdd = frequency === "YEARLY" ? 12 : 1;
  const targetDay = dayOfMonth ?? current.getUTCDate();
  const targetMonthFirstDay = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + monthsToAdd, 1));
  const lastDayOfTargetMonth = new Date(Date.UTC(targetMonthFirstDay.getUTCFullYear(), targetMonthFirstDay.getUTCMonth() + 1, 0)).getUTCDate();
  targetMonthFirstDay.setUTCDate(Math.min(targetDay, lastDayOfTargetMonth));
  return targetMonthFirstDay;
}

export async function personalRecurrenceGenerationProcessor(_job: Job): Promise<{ generated: number }> {
  const now = new Date();

  const dueRules = await prismaUnscoped.personalRecurrenceRule.findMany({
    where: { active: true, nextOccurrenceAt: { lte: now } },
  });

  let generated = 0;
  for (const rule of dueRules) {
    try {
      // Regra pode ter sido criada/paga manualmente entre a leitura e aqui (dois
      // workers nunca rodam ao mesmo tempo no mesmo processo, mas um redeploy pode
      // sobrepor instâncias por alguns segundos) — a condição `nextOccurrenceAt: {
      // lte: now }` dentro do `updateMany` garante que só um processo realmente
      // avança a regra (claim atômico, mesmo padrão de personal-bill-reminders).
      const account = await prismaUnscoped.personalAccount.findUnique({ where: { id: rule.templateAccountId } });
      if (!account) {
        log.warn({ ruleId: rule.id }, "conta-modelo da regra de recorrência não existe mais — desativando regra");
        await prismaUnscoped.personalRecurrenceRule.update({ where: { id: rule.id }, data: { active: false } });
        continue;
      }

      // Tipo da transação gerada deriva da categoria-modelo (INCOME/EXPENSE); regras
      // sem categoria (ex.: transferências internas futuras) assumem EXPENSE —
      // comportamento mais seguro (nunca infla saldo sem o usuário confirmar).
      const templateCategory = rule.templateCategoryId
        ? await prismaUnscoped.personalCategory.findUnique({ where: { id: rule.templateCategoryId } })
        : null;
      const transactionType = templateCategory?.type ?? "EXPENSE";
      const signedDelta = transactionType === "INCOME" ? rule.templateAmount : rule.templateAmount.negated();
      const nextOccurrenceAt = computeNextOccurrence(rule.nextOccurrenceAt, rule.frequency, rule.dayOfMonth);
      const shouldDeactivate = Boolean(rule.endDate && nextOccurrenceAt > rule.endDate);

      // Dono da PersonalTransaction gerada automaticamente: não há usuário "logado"
      // dentro de um worker, então atribuímos ao OWNER mais antigo do tenant (mesma
      // convenção de atribuição de sistema usada em platform-admin.routes.ts para
      // impersonation) — garante `createdByUserId` sempre satisfeito (NOT NULL).
      const owner = await prismaUnscoped.user.findFirst({
        where: { tenantId: rule.tenantId, role: "OWNER", active: true },
        orderBy: { createdAt: "asc" },
      });
      if (!owner) {
        log.warn({ ruleId: rule.id, tenantId: rule.tenantId }, "tenant sem OWNER ativo — pulando geração de recorrência");
        continue;
      }

      const claimed = await prismaUnscoped.personalRecurrenceRule.updateMany({
        where: { id: rule.id, nextOccurrenceAt: { lte: now } },
        data: { nextOccurrenceAt, active: shouldDeactivate ? false : true },
      });
      if (claimed.count === 0) continue; // outra instância já processou esta regra

      await prismaUnscoped.$transaction([
        prismaUnscoped.personalTransaction.create({
          data: {
            tenantId: rule.tenantId,
            accountId: rule.templateAccountId,
            categoryId: rule.templateCategoryId,
            createdByUserId: owner.id,
            recurrenceRuleId: rule.id,
            description: rule.templateDescription,
            type: transactionType,
            amount: rule.templateAmount,
            transactionDate: now,
          },
        }),
        prismaUnscoped.personalAccount.update({
          where: { id: rule.templateAccountId },
          data: { currentBalance: { increment: signedDelta } },
        }),
      ]);

      await notifyTenant({
        tenantId: rule.tenantId,
        category: "CASH_FLOW_ALERT",
        severity: "INFO",
        title: "Lançamento recorrente gerado",
        body: `"${rule.templateDescription}" foi lançado automaticamente em ${account.name} (R$ ${rule.templateAmount.toFixed(2)}).`,
        linkRoute: "/pessoal/transacoes",
        sourceType: "PERSONAL_RECURRENCE_RULE",
        sourceId: rule.id,
      });

      generated += 1;
    } catch (err) {
      log.error({ err, ruleId: rule.id }, "falha ao gerar transação a partir de regra de recorrência");
    }
  }

  return { generated };
}

export function startPersonalRecurrenceGenerationWorker(): Worker {
  return new Worker(QUEUE_NAMES.PERSONAL_RECURRENCE_GENERATION, personalRecurrenceGenerationProcessor, {
    connection: queueRedisConnection,
  });
}

export async function schedulePersonalRecurrenceGenerationJob(): Promise<void> {
  await personalRecurrenceGenerationQueue.upsertJobScheduler(
    REPEATABLE_JOB_NAME,
    { pattern: DAILY_CRON_4AM },
    { name: REPEATABLE_JOB_NAME },
  );
}

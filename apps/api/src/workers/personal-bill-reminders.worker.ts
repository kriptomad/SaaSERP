// apps/api/src/workers/personal-bill-reminders.worker.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 22.8 — varredura diária das PersonalBill
// (aluguel, luz, água, internet, streaming): dispara lembrete `reminderDaysBefore`
// dias antes do vencimento, marca OVERDUE automaticamente no dia seguinte ao
// vencimento não pago, e reabre o ciclo (PAID → PENDING) no início do mês seguinte
// para contas recorrentes — sem isso, uma conta paga em janeiro nunca voltaria a
// lembrar o usuário em fevereiro (PersonalBill não tem um registro por mês, apenas
// um único `status`/`lastPaidAt` reaproveitado ciclo a ciclo).
import { Worker, Job } from "bullmq";
import { prismaUnscoped } from "@filitech/db";
import { queueRedisConnection, QUEUE_NAMES, personalBillRemindersQueue, DEFAULT_RECURRING_JOB_OPTS } from "../lib/queue";
import { notifyTenant } from "../modules/notifications/notify.service";
import { createModuleLogger } from "../lib/logger";

const log = createModuleLogger("personal-bill-reminders.worker");

const REPEATABLE_JOB_NAME = "daily-sweep";
const DAILY_CRON_7AM = "0 7 * * *";

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

// Data de vencimento do ciclo corrente, com o mesmo ajuste de "último dia do mês" do
// motor de recorrência (ex.: dueDay = 31 em fevereiro vence dia 28/29).
function currentCycleDueDate(reference: Date, dueDay: number): Date {
  const lastDayOfMonth = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), Math.min(dueDay, lastDayOfMonth)));
}

export async function personalBillRemindersProcessor(_job: Job): Promise<{ reopened: number; reminded: number; overdue: number }> {
  const today = startOfDay(new Date());
  const bills = await prismaUnscoped.personalBill.findMany({});

  let reopened = 0;
  let reminded = 0;
  let overdue = 0;

  for (const bill of bills) {
    try {
      const dueDate = currentCycleDueDate(today, bill.dueDay);

      // Reabre o ciclo: conta recorrente paga em um mês anterior ao mês corrente
      // volta a PENDING para o novo ciclo de cobrança poder ser lembrado de novo.
      if (bill.isRecurring && bill.status === "PAID" && bill.lastPaidAt && startOfDay(bill.lastPaidAt) < new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))) {
        await prismaUnscoped.personalBill.update({ where: { id: bill.id }, data: { status: "PENDING" } });
        reopened += 1;
        continue; // já reaberta — reminder/overdue deste mesmo dia roda no próximo tick caso aplicável
      }

      if (bill.status !== "PENDING") continue;

      if (today > dueDate) {
        await prismaUnscoped.personalBill.update({ where: { id: bill.id }, data: { status: "OVERDUE" } });
        await notifyTenant({
          tenantId: bill.tenantId,
          category: "CASH_FLOW_ALERT",
          severity: "CRITICAL",
          title: "Conta vencida",
          body: `"${bill.name}" venceu em ${dueDate.toLocaleDateString("pt-BR")} e ainda não foi paga.`,
          linkRoute: "/pessoal/contas",
          sourceType: "PERSONAL_BILL",
          sourceId: bill.id,
        });
        overdue += 1;
        continue;
      }

      const reminderDate = new Date(dueDate);
      reminderDate.setUTCDate(reminderDate.getUTCDate() - bill.reminderDaysBefore);
      if (today >= reminderDate) {
        // Lembrete é reenviado a cada dia dentro da janela (até o vencimento) — decisão
        // deliberada de MVP: PersonalBill não guarda "último lembrete enviado por
        // ciclo", e lembrar todo dia próximo do vencimento é o comportamento padrão de
        // apps financeiros equivalentes (ex.: Mobills, Organizze).
        const daysUntilDue = Math.round((dueDate.getTime() - today.getTime()) / 86_400_000);
        await notifyTenant({
          tenantId: bill.tenantId,
          category: "CASH_FLOW_ALERT",
          severity: daysUntilDue <= 1 ? "WARNING" : "INFO",
          title: "Conta a vencer",
          body: `"${bill.name}" vence em ${daysUntilDue === 0 ? "hoje" : `${daysUntilDue} dia(s)`} (${dueDate.toLocaleDateString("pt-BR")}).`,
          linkRoute: "/pessoal/contas",
          sourceType: "PERSONAL_BILL",
          sourceId: bill.id,
        });
        reminded += 1;
      }
    } catch (err) {
      log.error({ err, billId: bill.id }, "falha ao processar lembrete de conta a pagar");
    }
  }

  return { reopened, reminded, overdue };
}

export function startPersonalBillRemindersWorker(): Worker {
  return new Worker(QUEUE_NAMES.PERSONAL_BILL_REMINDERS, personalBillRemindersProcessor, {
    connection: queueRedisConnection,
    // CORREÇÃO DE AUDITORIA (fa-w5-perf-worker-default-concurrency): job diário
    // único cujo processor já itera TODAS as PersonalBill do sistema inteiro num
    // `for` sequencial na mesma execução — nunca há dois jobs desta fila
    // concorrentes. `concurrency: 1` explicitado (antes implícito).
    concurrency: 1,
  });
}

export async function schedulePersonalBillRemindersJob(): Promise<void> {
  await personalBillRemindersQueue.upsertJobScheduler(
    REPEATABLE_JOB_NAME,
    { pattern: DAILY_CRON_7AM },
    { name: REPEATABLE_JOB_NAME, opts: DEFAULT_RECURRING_JOB_OPTS },
  );
}

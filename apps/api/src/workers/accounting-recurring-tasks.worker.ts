// apps/api/src/workers/accounting-recurring-tasks.worker.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 21.18.4 — "motor de tarefas recorrentes por
// competência ... gerado automaticamente por um cron mensal a partir do `taxRegime` e
// dos `scopes` ativos do vínculo, nunca cadastrado manualmente tarefa por tarefa"
// (comentário do próprio schema.prisma em `model AccountingTask`).
//
// GAP DE AUDITORIA FECHADO (Mega-Audit Rodada 4): `accounting-office.routes.ts`
// documentava explicitamente esse cron como PENDENTE — só existia CRUD manual de
// `AccountingTask`. Este worker fecha o gap gerando, no 1º dia de cada mês, o
// conjunto-padrão de obrigações do mês para cada `AccountingEngagement` ATIVO,
// conforme o `taxRegime` do tenant-cliente.
//
// ESCOPO HONESTO: o calendário de obrigações abaixo (quais tarefas + regime + dia de
// vencimento) é o conjunto-padrão mais comum de um regime tributário brasileiro
// (DAS/DEFIS no Simples/MEI; DARF/ECD/ECF no Presumido/Real; folha e EFD-Reinf/DCTFWeb
// para quem tem empregados/pró-labore em qualquer regime), mas NÃO substitui o
// calendário fiscal específico do escritório/cliente (convenções coletivas,
// parcelamentos, regimes especiais por Estado/Município). O escritório pode sempre
// ajustar/excluir manualmente via `PATCH /accounting-tasks/:id` depois de geradas.
import { Worker, Job } from "bullmq";
import { prismaUnscoped } from "@filitech/db";
import { queueRedisConnection, QUEUE_NAMES, accountingRecurringTasksQueue } from "../lib/queue";
import { createModuleLogger } from "../lib/logger";

const log = createModuleLogger("accounting-recurring-tasks.worker");

const REPEATABLE_JOB_NAME = "monthly-generation";
// Dia 1 de cada mês, 06:00 — antes do expediente, para a tarefa já aparecer na fila
// do contador no início do mês corrente (padrão de workers mensais já existentes,
// ex. personal-investment-quotes.worker.ts roda após o fechamento do pregão).
const MONTHLY_CRON_DAY1_6AM = "0 6 1 * *";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function competenciaOf(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}`;
}

function dueDateInMonth(reference: Date, day: number): Date {
  const lastDayOfMonth = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), Math.min(day, lastDayOfMonth)));
}

interface TaskPlanItem {
  taskType:
    | "FOLHA_FECHAMENTO"
    | "DAS_GERACAO"
    | "DARF_GERACAO"
    | "EFD_REINF_ENVIO"
    | "DCTFWEB_GERACAO"
    | "ECD_GERACAO"
    | "ECF_GERACAO"
    | "DEFIS_ENVIO"
    | "IRPF_DECLARACAO";
  dueDate: Date;
  competencia: string;
}

// Competência das obrigações mensais é o mês ANTERIOR ao mês corrente (ex.: folha de
// outubro fechada/declarada em novembro); as anuais usam o ano-calendário anterior.
function buildMonthlyPlan(now: Date, taxRegime: string): TaskPlanItem[] {
  const prevMonthRef = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const monthlyCompetencia = competenciaOf(prevMonthRef);
  const plan: TaskPlanItem[] = [
    // Fechamento de folha/pró-labore: comum a qualquer regime com empregados/sócios.
    { taskType: "FOLHA_FECHAMENTO", dueDate: dueDateInMonth(now, 5), competencia: monthlyCompetencia },
    // EFD-Reinf/DCTFWeb: declarações de retenções/folha, aplicáveis a qualquer regime
    // com folha — mesmo critério usado em ecf-reinf-dctfweb.service.ts.
    { taskType: "EFD_REINF_ENVIO", dueDate: dueDateInMonth(now, 15), competencia: monthlyCompetencia },
    { taskType: "DCTFWEB_GERACAO", dueDate: dueDateInMonth(now, 15), competencia: monthlyCompetencia },
  ];

  if (taxRegime === "MEI" || taxRegime === "SIMPLES_NACIONAL") {
    plan.push({ taskType: "DAS_GERACAO", dueDate: dueDateInMonth(now, 20), competencia: monthlyCompetencia });
  }
  if (taxRegime === "LUCRO_PRESUMIDO" || taxRegime === "LUCRO_REAL") {
    plan.push({ taskType: "DARF_GERACAO", dueDate: dueDateInMonth(now, 25), competencia: monthlyCompetencia });
  }

  // Obrigações ANUAIS: geradas uma única vez por ano, em janeiro, referentes ao
  // ano-calendário anterior, com vencimento no prazo legal padrão de cada uma.
  if (now.getUTCMonth() === 0) {
    const priorYear = now.getUTCFullYear() - 1;
    const yearCompetencia = `${priorYear}-ANUAL`;
    if (taxRegime === "LUCRO_PRESUMIDO" || taxRegime === "LUCRO_REAL") {
      // ECD: último dia útil de maio; ECF: último dia útil de julho (prazos legais
      // padrão da Receita Federal) — usamos o último dia do mês indicado.
      plan.push({ taskType: "ECD_GERACAO", dueDate: new Date(Date.UTC(now.getUTCFullYear(), 4, 31)), competencia: yearCompetencia });
      plan.push({ taskType: "ECF_GERACAO", dueDate: new Date(Date.UTC(now.getUTCFullYear(), 6, 31)), competencia: yearCompetencia });
    }
    if (taxRegime === "MEI" || taxRegime === "SIMPLES_NACIONAL") {
      // DEFIS: prazo legal 31/março.
      plan.push({ taskType: "DEFIS_ENVIO", dueDate: new Date(Date.UTC(now.getUTCFullYear(), 2, 31)), competencia: yearCompetencia });
    }
    // IRPF de sócios/pró-labore: prazo legal 30/abril, comum a qualquer regime.
    plan.push({ taskType: "IRPF_DECLARACAO", dueDate: new Date(Date.UTC(now.getUTCFullYear(), 3, 30)), competencia: yearCompetencia });
  }

  return plan;
}

export async function accountingRecurringTasksProcessor(_job: Job): Promise<{ created: number; skippedExisting: number }> {
  const now = new Date();
  const engagements = await prismaUnscoped.accountingEngagement.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      accountingFirmTenantId: true,
      clientTenantId: true,
      clientTenant: { select: { taxRegime: true } },
    },
  });

  let created = 0;
  let skippedExisting = 0;

  for (const engagement of engagements) {
    try {
      const plan = buildMonthlyPlan(now, engagement.clientTenant.taxRegime);
      for (const item of plan) {
        // Idempotência: nunca duplica a mesma tarefa (mesmo vínculo + tipo +
        // competência) se o worker rodar mais de uma vez no mesmo mês (reinício,
        // retry do BullMQ, etc.).
        const existing = await prismaUnscoped.accountingTask.findFirst({
          where: { engagementId: engagement.id, taskType: item.taskType, competencia: item.competencia },
          select: { id: true },
        });
        if (existing) {
          skippedExisting += 1;
          continue;
        }
        await prismaUnscoped.accountingTask.create({
          data: {
            accountingFirmTenantId: engagement.accountingFirmTenantId,
            clientTenantId: engagement.clientTenantId,
            engagementId: engagement.id,
            taskType: item.taskType,
            competencia: item.competencia,
            dueDate: item.dueDate,
          },
        });
        created += 1;
      }
    } catch (err) {
      log.error({ err, engagementId: engagement.id }, "falha ao gerar tarefas recorrentes do vínculo");
    }
  }

  return { created, skippedExisting };
}

export function startAccountingRecurringTasksWorker(): Worker {
  return new Worker(QUEUE_NAMES.ACCOUNTING_RECURRING_TASKS, accountingRecurringTasksProcessor, {
    connection: queueRedisConnection,
  });
}

export async function scheduleAccountingRecurringTasksJob(): Promise<void> {
  await accountingRecurringTasksQueue.upsertJobScheduler(
    REPEATABLE_JOB_NAME,
    { pattern: MONTHLY_CRON_DAY1_6AM },
    { name: REPEATABLE_JOB_NAME },
  );
}

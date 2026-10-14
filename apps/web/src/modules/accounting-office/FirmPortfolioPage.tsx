// apps/web/src/modules/accounting-office/FirmPortfolioPage.tsx
// Carteira de Clientes do próprio escritório (Capítulo 21.18.6) — GAP DE AUDITORIA
// FECHADO: antes desta página, um tenant ACCOUNTING_OFFICE não tinha nenhuma visão
// agregada dos clientes vinculados nem da fila de tarefas consolidada; só existia a
// visão lado-cliente (AccountingOfficePage.tsx).
import {
  Alert,
  Chip,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { accountingOfficeApi, ENGAGEMENT_SCOPE_LABEL, TASK_STATUS_LABEL } from "./api";
import { Page, PageHeader, QueryState } from "../../shared/ui/PageLayout";
import { formatDate } from "../../shared/ui/format";

export function FirmPortfolioPage() {
  const portfolioQuery = useQuery({
    queryKey: ["accounting-firm-portfolio"],
    queryFn: () => accountingOfficeApi.getFirmPortfolio(),
  });

  return (
    <Page>
      <PageHeader
        title="Carteira de Clientes"
        subtitle="Visão consolidada de todos os clientes vinculados ao seu escritório e da fila de tarefas por cliente."
      />
      <QueryState query={portfolioQuery}>
        {(portfolio) => (
          <Stack spacing={3}>
            {portfolio.clients.length === 0 && (
              <Alert severity="info">
                Nenhum cliente vinculado ainda. Quando um lojista conceder uma procuração eletrônica ao seu
                escritório e você aceitar o vínculo, ele aparecerá aqui.
              </Alert>
            )}

            <Paper variant="outlined">
              <Typography variant="subtitle1" sx={{ p: 2, pb: 0 }}>
                Clientes ativos ({portfolio.clients.length})
              </Typography>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Cliente</TableCell>
                      <TableCell>CNPJ</TableCell>
                      <TableCell>Escopos</TableCell>
                      <TableCell>Vínculo desde</TableCell>
                      <TableCell align="right">Pendentes</TableCell>
                      <TableCell align="right">Atrasadas</TableCell>
                      <TableCell align="right">Concluídas</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {portfolio.clients.map((c) => (
                      <TableRow key={c.engagementId} hover>
                        <TableCell>
                          <Typography variant="body2" fontWeight={600}>
                            {c.clientTradeName}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {c.clientSlug}
                          </Typography>
                        </TableCell>
                        <TableCell>{c.clientCnpj ?? "—"}</TableCell>
                        <TableCell>
                          <Stack direction="row" spacing={0.5} flexWrap="wrap">
                            {c.scopes.map((s) => (
                              <Chip key={s} label={ENGAGEMENT_SCOPE_LABEL[s]} size="small" />
                            ))}
                          </Stack>
                        </TableCell>
                        <TableCell>{formatDate(c.grantedAt)}</TableCell>
                        <TableCell align="right">
                          <Chip label={c.tasks.pending} size="small" color={c.tasks.pending > 0 ? "warning" : "default"} />
                        </TableCell>
                        <TableCell align="right">
                          <Chip label={c.tasks.late} size="small" color={c.tasks.late > 0 ? "error" : "default"} />
                        </TableCell>
                        <TableCell align="right">
                          <Chip label={c.tasks.done} size="small" color="success" />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>

            <Paper variant="outlined">
              <Typography variant="subtitle1" sx={{ p: 2, pb: 0 }}>
                Fila de tarefas (todos os clientes)
              </Typography>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Cliente</TableCell>
                      <TableCell>Tipo</TableCell>
                      <TableCell>Competência</TableCell>
                      <TableCell>Vencimento</TableCell>
                      <TableCell>Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {portfolio.taskQueue.map((t) => (
                      <TableRow key={t.id} hover>
                        <TableCell>{t.clientTradeName}</TableCell>
                        <TableCell>{t.taskType}</TableCell>
                        <TableCell>{t.competencia}</TableCell>
                        <TableCell>{formatDate(t.dueDate)}</TableCell>
                        <TableCell>
                          <Chip
                            label={TASK_STATUS_LABEL[t.status]}
                            size="small"
                            color={t.status === "LATE" ? "error" : t.status === "DONE" ? "success" : "default"}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                    {portfolio.taskQueue.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5}>
                          <Typography variant="body2" color="text.secondary">
                            Nenhuma tarefa pendente.
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          </Stack>
        )}
      </QueryState>
    </Page>
  );
}

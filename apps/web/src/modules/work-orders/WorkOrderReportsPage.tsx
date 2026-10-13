// apps/web/src/modules/work-orders/WorkOrderReportsPage.tsx
// Relatórios gerenciais de Assistência Técnica (Capítulo 4.2): comissionamento por
// técnico, consulta de garantia por IMEI/Serial e indicadores de ciclo/ticket médio.
// Esta tela é NOVA e só consome `work-order-reports.routes.ts` (read-only sobre a
// máquina de estados de O.S.) — nenhuma tela existente de O.S. foi alterada.
import { useState } from "react";
import {
  Alert,
  Button,
  Card,
  CardContent,
  Chip,
  Grid,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Page, PageHeader, QueryState, errorMessage } from "../../shared/ui/PageLayout";
import { useToast } from "../../shared/ui/Toast";
import { money, formatDate, formatDateTime, dateInputToIso, toDateInput } from "../../shared/ui/format";
import { useProfessionals } from "../../shared/lookups";
import { workOrderReportsApi } from "./work-order-reports.api";

function PeriodFilter({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (next: { from: string; to: string }) => void;
}) {
  return (
    <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
      <TextField
        type="date"
        label="De"
        InputLabelProps={{ shrink: true }}
        value={from}
        onChange={(e) => onChange({ from: e.target.value, to })}
        size="small"
      />
      <TextField
        type="date"
        label="Até"
        InputLabelProps={{ shrink: true }}
        value={to}
        onChange={(e) => onChange({ from, to: e.target.value })}
        size="small"
      />
    </Stack>
  );
}

function KpisSection({ from, to }: { from: string; to: string }) {
  const query = useQuery({
    queryKey: ["work-order-reports", "kpis", from, to],
    queryFn: () =>
      workOrderReportsApi.kpis({
        from: from ? dateInputToIso(from) : undefined,
        to: to ? dateInputToIso(to) : undefined,
      }),
  });

  return (
    <QueryState query={query}>
      {(data) => (
        <Grid container spacing={2} sx={{ mb: 3 }}>
          {[
            { label: "O.S. entregues no período", value: String(data.deliveredCount) },
            { label: "Backlog aberto (todas, não entregues/canceladas)", value: String(data.backlogCount) },
            { label: "Tempo médio de ciclo (RECEIVED → DELIVERED)", value: data.avgCycleTimeHours != null ? `${data.avgCycleTimeHours} h` : "—" },
            { label: "Ticket médio de mão de obra", value: data.avgLaborTicket != null ? money(data.avgLaborTicket) : "—" },
            { label: "Ticket médio de peças", value: data.avgPartsTicket != null ? money(data.avgPartsTicket) : "—" },
          ].map((kpi) => (
            <Grid item xs={12} sm={6} md={4} key={kpi.label}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="caption" color="text.secondary">
                    {kpi.label}
                  </Typography>
                  <Typography variant="h5">{kpi.value}</Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
          <Grid item xs={12}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              O.S. entregues por técnico
            </Typography>
            {data.deliveredByTechnician.length === 0 ? (
              <Alert severity="info">Nenhuma entrega no período.</Alert>
            ) : (
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {data.deliveredByTechnician.map((t) => (
                  <Chip key={t.technicianId} label={`${t.technicianName}: ${t.deliveredCount}`} />
                ))}
              </Stack>
            )}
          </Grid>
        </Grid>
      )}
    </QueryState>
  );
}

function CommissionsSection({ from, to }: { from: string; to: string }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const technicians = useProfessionals();
  const [editTechnicianId, setEditTechnicianId] = useState("");
  const [editPercent, setEditPercent] = useState("");

  const commissionsQuery = useQuery({
    queryKey: ["work-order-reports", "commissions", from, to],
    queryFn: () =>
      workOrderReportsApi.commissions({
        from: from ? dateInputToIso(from) : undefined,
        to: to ? dateInputToIso(to) : undefined,
      }),
  });
  const rulesQuery = useQuery({ queryKey: ["work-order-reports", "commission-rules"], queryFn: () => workOrderReportsApi.commissionRules() });

  const mutation = useMutation({
    mutationFn: workOrderReportsApi.setCommissionRule,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["work-order-reports", "commission-rules"] });
      void queryClient.invalidateQueries({ queryKey: ["work-order-reports", "commissions"] });
      toast.success("Regra de comissão salva.");
      setEditPercent("");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  function saveRule() {
    const percent = Number(editPercent.replace(",", "."));
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      toast.error("Informe um percentual entre 0 e 100.");
      return;
    }
    mutation.mutate({ technicianId: editTechnicianId || null, commissionPercent: percent });
  }

  const defaultRule = (rulesQuery.data ?? []).find((r) => r.technicianId === null);

  return (
    <Stack spacing={2} sx={{ mb: 3 }}>
      <Typography variant="h6">Comissão por técnico (mão de obra, liberada só em O.S. entregue)</Typography>
      <QueryState query={commissionsQuery} isEmpty={(d) => d.technicians.length === 0} emptyMessage="Nenhuma O.S. entregue com técnico atribuído no período.">
        {(data) => (
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Técnico</TableCell>
                  <TableCell align="right">O.S. entregues</TableCell>
                  <TableCell align="right">Mão de obra comissionável</TableCell>
                  <TableCell align="right">% comissão aplicada</TableCell>
                  <TableCell align="right">Comissão a pagar</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.technicians.map((row) => (
                  <TableRow key={row.technicianId}>
                    <TableCell>{row.technicianName}</TableCell>
                    <TableCell align="right">{row.deliveredCount}</TableCell>
                    <TableCell align="right">{money(row.commissionableLaborValue)}</TableCell>
                    <TableCell align="right">{row.commissionPercent}%</TableCell>
                    <TableCell align="right">{money(row.commissionValue)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </QueryState>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Configurar % de comissão
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
          Regra padrão do tenant: {defaultRule ? `${defaultRule.commissionPercent}%` : "não configurada (0%)"}. Técnicos sem regra própria usam a padrão.
        </Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ sm: "center" }}>
          <TextField select label="Técnico" value={editTechnicianId} onChange={(e) => setEditTechnicianId(e.target.value)} size="small" sx={{ minWidth: 220 }}>
            <MenuItem value="">Regra padrão do tenant</MenuItem>
            {(technicians.data ?? []).map((t) => (
              <MenuItem key={t.id} value={t.id}>
                {t.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField label="% comissão" value={editPercent} onChange={(e) => setEditPercent(e.target.value)} size="small" sx={{ width: 140 }} />
          <Button variant="contained" onClick={saveRule} disabled={mutation.isPending}>
            Salvar
          </Button>
        </Stack>
      </Paper>
    </Stack>
  );
}

function WarrantySection() {
  const [serial, setSerial] = useState("");
  const [searched, setSearched] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["work-order-reports", "warranty-check", searched],
    queryFn: () => workOrderReportsApi.warrantyCheck(searched as string),
    enabled: Boolean(searched),
    retry: false,
  });

  return (
    <Stack spacing={2}>
      <Typography variant="h6">Garantia por número de série / IMEI</Typography>
      <Typography variant="body2" color="text.secondary">
        Verifica se a última O.S. entregue deste equipamento ainda está dentro do prazo de garantia.
      </Typography>
      <Stack direction="row" spacing={2}>
        <TextField label="Série ou IMEI" value={serial} onChange={(e) => setSerial(e.target.value)} size="small" sx={{ minWidth: 260 }} />
        <Button variant="contained" onClick={() => setSearched(serial.trim())} disabled={!serial.trim()}>
          Consultar
        </Button>
      </Stack>
      {searched && (
        <QueryState query={query}>
          {(data) => (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2">
                {data.product.name} — série {data.serial}
                {data.imei ? ` · IMEI ${data.imei}` : ""}
              </Typography>
              {!data.hasDeliveredWorkOrder ? (
                <Alert severity="info" sx={{ mt: 1 }}>
                  Este equipamento não tem O.S. entregue registrada.
                </Alert>
              ) : (
                <>
                  <Alert severity={data.withinWarranty ? "success" : "warning"} sx={{ mt: 1 }}>
                    {data.withinWarranty
                      ? `Dentro da garantia até ${formatDate(data.warrantyExpiresAt)}.`
                      : `Fora da garantia${data.warrantyExpiresAt ? ` (expirou em ${formatDate(data.warrantyExpiresAt)})` : ""}.`}
                  </Alert>
                  <Typography variant="body2" sx={{ mt: 1 }}>
                    Última O.S. entregue: {data.workOrder?.equipmentDescription} em {formatDateTime(data.workOrder?.deliveredAt)} ({data.workOrder?.warrantyDays ?? 0} dias de garantia)
                  </Typography>
                  {data.workOrder?.warrantyExclusions && (
                    <Typography variant="caption" color="text.secondary" display="block">
                      Exclusões: {data.workOrder.warrantyExclusions}
                    </Typography>
                  )}
                </>
              )}
            </Paper>
          )}
        </QueryState>
      )}
    </Stack>
  );
}

export function WorkOrderReportsPage() {
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const [period, setPeriod] = useState({ from: toDateInput(firstOfMonth), to: toDateInput(today) });

  return (
    <Page maxWidth={1400}>
      <PageHeader
        title="Relatórios de Assistência Técnica"
        subtitle="Comissão por técnico, garantia por série/IMEI e indicadores de ciclo das O.S."
        actions={<PeriodFilter from={period.from} to={period.to} onChange={setPeriod} />}
      />
      <KpisSection from={period.from} to={period.to} />
      <CommissionsSection from={period.from} to={period.to} />
      <WarrantySection />
    </Page>
  );
}

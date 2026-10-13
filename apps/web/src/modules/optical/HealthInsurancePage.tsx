// apps/web/src/modules/optical/HealthInsurancePage.tsx
// Capítulo 11.2 — Ótica: convênios faturam em lote. Venda individual é fechada
// normalmente no PDV (`paymentMethod = HEALTH_INSURANCE`); aqui o gestor cadastra o
// convênio e, periodicamente, fecha a fatura consolidada (uma única
// AccountReceivable agrupando todas as vendas ainda não faturadas do convênio).
import { useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
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
import AddIcon from "@mui/icons-material/Add";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Page, PageHeader, QueryState, errorMessage } from "../../shared/ui/PageLayout";
import { useToast } from "../../shared/ui/Toast";
import { formatDate, money, dateInputToIso, toDateInput } from "../../shared/ui/format";
import { healthInsurancePlansApi, healthInsuranceBillingApi, type HealthInsurancePlan } from "./api";

function NewPlanDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState("");
  const [billingDueDay, setBillingDueDay] = useState("10");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => healthInsurancePlansApi.create({ name: name.trim(), billingDueDay: Number(billingDueDay) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["health-insurance-plans"] });
      toast.success("Convênio cadastrado.");
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Novo convênio</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="Nome do convênio" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          <TextField
            label="Dia de vencimento padrão da fatura"
            type="number"
            value={billingDueDay}
            onChange={(e) => setBillingDueDay(e.target.value)}
            helperText="Dia do mês (1-28) usado como referência de vencimento."
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={create.isPending}>
          Cancelar
        </Button>
        <Button
          variant="contained"
          disabled={create.isPending}
          onClick={() => {
            setError(null);
            if (!name.trim()) return setError("Informe o nome do convênio.");
            const day = Number(billingDueDay);
            if (!Number.isInteger(day) || day < 1 || day > 28) return setError("Dia de vencimento deve ser um inteiro entre 1 e 28.");
            create.mutate();
          }}
        >
          {create.isPending ? "Salvando…" : "Salvar"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function CloseBillingDialog({ plan, onClose }: { plan: HealthInsurancePlan; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [dueDate, setDueDate] = useState(toDateInput(new Date()));
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const preview = useQuery({ queryKey: ["health-insurance-plans", plan.id, "unbilled-sales"], queryFn: () => healthInsuranceBillingApi.unbilledSales(plan.id) });

  const close = useMutation({
    mutationFn: () => healthInsuranceBillingApi.closeBilling(plan.id, { dueDate: dateInputToIso(dueDate), referenceDescription: description.trim() || undefined }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["health-insurance-plans", plan.id, "unbilled-sales"] });
      toast.success(`Fatura consolidada gerada: ${result.billedSalesCount} venda(s), total ${money(result.totalAmount)}.`);
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Fechar faturamento — {plan.name}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <QueryState query={preview} isEmpty={(d) => d.sales.length === 0} emptyMessage="Não há vendas pendentes de faturamento para este convênio.">
            {(data) => (
              <>
                <Typography variant="body2">
                  {data.count} venda(s) pendente(s) · total {money(data.totalAmount)}
                </Typography>
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Data</TableCell>
                        <TableCell>Cliente</TableCell>
                        <TableCell align="right">Valor</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {data.sales.map((s) => (
                        <TableRow key={s.id}>
                          <TableCell>{formatDate(s.createdAt)}</TableCell>
                          <TableCell>{s.client?.name ?? "—"}</TableCell>
                          <TableCell align="right">{money(s.totalAmount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
                <TextField label="Vencimento da fatura consolidada" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} InputLabelProps={{ shrink: true }} required />
                <TextField label="Descrição (opcional)" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={`Fatura consolidada — convênio ${plan.name}`} />
              </>
            )}
          </QueryState>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={close.isPending}>
          Cancelar
        </Button>
        <Button variant="contained" disabled={close.isPending || !preview.data || preview.data.sales.length === 0} onClick={() => close.mutate()}>
          {close.isPending ? "Fechando…" : "Fechar faturamento"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function HealthInsurancePage() {
  const query = useQuery({ queryKey: ["health-insurance-plans"], queryFn: () => healthInsurancePlansApi.list() });
  const [newOpen, setNewOpen] = useState(false);
  const [billingPlan, setBillingPlan] = useState<HealthInsurancePlan | null>(null);

  return (
    <Page>
      <PageHeader
        title="Convênios ópticos"
        subtitle="Cadastro de convênios e faturamento consolidado em lote (venda individual no PDV, recebimento consolidado por convênio)."
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setNewOpen(true)}>
            Novo convênio
          </Button>
        }
      />
      <QueryState query={query} isEmpty={(d) => d.length === 0} emptyMessage="Nenhum convênio cadastrado ainda.">
        {(data) => (
          <Paper>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Nome</TableCell>
                    <TableCell>Dia de vencimento</TableCell>
                    <TableCell>Ativo</TableCell>
                    <TableCell align="right">Ações</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.map((p) => (
                    <TableRow key={p.id} hover>
                      <TableCell>{p.name}</TableCell>
                      <TableCell>{p.billingDueDay}</TableCell>
                      <TableCell>
                        <FormControlLabel control={<Checkbox checked={p.active} disabled />} label="" sx={{ m: 0 }} />
                      </TableCell>
                      <TableCell align="right">
                        <Button size="small" onClick={() => setBillingPlan(p)}>
                          Fechar faturamento
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        )}
      </QueryState>
      {newOpen && <NewPlanDialog onClose={() => setNewOpen(false)} />}
      {billingPlan && <CloseBillingDialog plan={billingPlan} onClose={() => setBillingPlan(null)} />}
    </Page>
  );
}

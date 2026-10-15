// apps/web/src/modules/personal-finance/PersonalInvestmentsPage.tsx
// Capítulo 22.6 — carteira de investimentos (mark-to-market manual; a cotação
// automática via BrasilAPI está documentada como PENDENTE no backend, ver
// personal-investments.routes.ts).
import { useState } from "react";
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
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
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import PriceChangeIcon from "@mui/icons-material/PriceChange";
import HistoryIcon from "@mui/icons-material/History";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Page, PageHeader, QueryState, errorMessage } from "../../shared/ui/PageLayout";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { useToast } from "../../shared/ui/Toast";
import { formatDate, money, parseDecimal } from "../../shared/ui/format";
import { INVESTMENT_ASSET_TYPE_LABEL, personalFinanceApi, type PersonalAccount, type PersonalInvestment, type PersonalInvestmentAssetType } from "./api";

function CreateInvestmentDialog({ accounts, onClose }: { accounts: PersonalAccount[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [accountId, setAccountId] = useState("");
  const [assetType, setAssetType] = useState<PersonalInvestmentAssetType>("TESOURO_DIRETO");
  const [assetName, setAssetName] = useState("");
  const [ticker, setTicker] = useState("");
  const [quantity, setQuantity] = useState("");
  const [averagePrice, setAveragePrice] = useState("");
  const [currentPrice, setCurrentPrice] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => personalFinanceApi.createInvestment(body),
    onSuccess: () => {
      toast.success("Investimento cadastrado.");
      void queryClient.invalidateQueries({ queryKey: ["personal-investments"] });
      onClose();
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  function submit() {
    setFormError(null);
    if (!accountId) return setFormError("Selecione a conta/corretora.");
    if (!assetName.trim()) return setFormError("Informe o nome do ativo.");
    const qty = parseDecimal(quantity);
    const avg = parseDecimal(averagePrice);
    const cur = parseDecimal(currentPrice);
    if (qty === null || qty <= 0) return setFormError("Informe a quantidade.");
    if (avg === null || avg <= 0) return setFormError("Informe o preço médio de compra.");
    if (cur === null || cur <= 0) return setFormError("Informe o preço atual de mercado.");
    mutation.mutate({ accountId, assetType, assetName: assetName.trim(), ticker: ticker.trim() || undefined, quantity: qty, averagePrice: avg, currentPrice: cur });
  }

  return (
    <Dialog open onClose={mutation.isPending ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Novo investimento</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {formError && <Alert severity="error">{formError}</Alert>}
          <TextField select label="Conta/corretora" value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
            {accounts.map((a) => (
              <MenuItem key={a.id} value={a.id}>
                {a.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField select label="Tipo de ativo" value={assetType} onChange={(e) => setAssetType(e.target.value as PersonalInvestmentAssetType)}>
            {(Object.keys(INVESTMENT_ASSET_TYPE_LABEL) as PersonalInvestmentAssetType[]).map((t) => (
              <MenuItem key={t} value={t}>
                {INVESTMENT_ASSET_TYPE_LABEL[t]}
              </MenuItem>
            ))}
          </TextField>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField label="Nome do ativo" value={assetName} onChange={(e) => setAssetName(e.target.value)} required fullWidth />
            <TextField label="Ticker (opcional)" value={ticker} onChange={(e) => setTicker(e.target.value)} fullWidth />
          </Stack>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField label="Quantidade" value={quantity} onChange={(e) => setQuantity(e.target.value)} required fullWidth />
            <TextField label="Preço médio (R$)" value={averagePrice} onChange={(e) => setAveragePrice(e.target.value)} required fullWidth />
            <TextField label="Preço atual (R$)" value={currentPrice} onChange={(e) => setCurrentPrice(e.target.value)} required fullWidth />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={mutation.isPending}>
          Cancelar
        </Button>
        <Button variant="contained" onClick={submit} disabled={mutation.isPending}>
          {mutation.isPending ? "Salvando…" : "Salvar"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function UpdatePriceDialog({ investment, onClose }: { investment: PersonalInvestment; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [currentPrice, setCurrentPrice] = useState(String(Number(investment.currentPrice)));
  const [formError, setFormError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => personalFinanceApi.updateInvestmentPrice(investment.id, { currentPrice: parseDecimal(currentPrice) }),
    onSuccess: () => {
      toast.success("Preço atualizado.");
      void queryClient.invalidateQueries({ queryKey: ["personal-investments"] });
      onClose();
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  return (
    <Dialog open onClose={mutation.isPending ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>Atualizar preço — {investment.assetName}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {formError && <Alert severity="error">{formError}</Alert>}
          <TextField label="Preço atual (R$)" value={currentPrice} onChange={(e) => setCurrentPrice(e.target.value)} autoFocus />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={mutation.isPending}>
          Cancelar
        </Button>
        <Button
          variant="contained"
          onClick={() => {
            setFormError(null);
            const price = parseDecimal(currentPrice);
            if (price === null || price <= 0) return setFormError("Informe um preço válido.");
            mutation.mutate();
          }}
          disabled={mutation.isPending}
        >
          {mutation.isPending ? "Salvando…" : "Salvar"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function PriceHistoryDialog({ investment, onClose }: { investment: PersonalInvestment; onClose: () => void }) {
  const query = useQuery({ queryKey: ["personal-investment-history", investment.id], queryFn: () => personalFinanceApi.priceHistory(investment.id) });

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Histórico de preços — {investment.assetName}</DialogTitle>
      <DialogContent>
        <QueryState query={query} isEmpty={(d) => d.length === 0} emptyMessage="Nenhum histórico de preço registrado ainda.">
          {(rows) => (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Data</TableCell>
                  <TableCell align="right">Preço de fechamento</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {[...rows].reverse().map((h) => (
                  <TableRow key={h.id}>
                    <TableCell>{formatDate(h.priceDate)}</TableCell>
                    <TableCell align="right">{money(h.closingPrice)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </QueryState>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Fechar</Button>
      </DialogActions>
    </Dialog>
  );
}

export function PersonalInvestmentsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const query = useQuery({ queryKey: ["personal-investments"], queryFn: () => personalFinanceApi.investments() });
  const accountsQuery = useQuery({ queryKey: ["personal-accounts"], queryFn: () => personalFinanceApi.accounts() });
  const [creating, setCreating] = useState(false);
  const [updatingPrice, setUpdatingPrice] = useState<PersonalInvestment | null>(null);
  const [viewingHistory, setViewingHistory] = useState<PersonalInvestment | null>(null);
  const [deleting, setDeleting] = useState<PersonalInvestment | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => personalFinanceApi.deleteInvestment(id),
    onSuccess: () => {
      toast.success("Investimento excluído.");
      void queryClient.invalidateQueries({ queryKey: ["personal-investments"] });
      setDeleting(null);
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      setDeleting(null);
    },
  });

  return (
    <Page maxWidth={1300}>
      <PageHeader
        title="Investimentos"
        subtitle={query.data ? `Valor total de mercado: ${money(query.data.reduce((s, i) => s + Number(i.marketValue), 0))}` : undefined}
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>
            Novo investimento
          </Button>
        }
      />
      <QueryState query={query} isEmpty={(d) => d.length === 0} emptyMessage="Nenhum investimento cadastrado ainda.">
        {(rows) => (
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Ativo</TableCell>
                  <TableCell>Tipo</TableCell>
                  <TableCell align="right">Quantidade</TableCell>
                  <TableCell align="right">Preço médio</TableCell>
                  <TableCell align="right">Preço atual</TableCell>
                  <TableCell align="right">Valor de mercado</TableCell>
                  <TableCell align="right">Resultado</TableCell>
                  <TableCell align="right">Ações</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((i) => {
                  const gain = Number(i.unrealizedGainLoss);
                  return (
                    <TableRow key={i.id} hover>
                      <TableCell>
                        {i.assetName}
                        {i.ticker && <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>({i.ticker})</Typography>}
                      </TableCell>
                      <TableCell>{INVESTMENT_ASSET_TYPE_LABEL[i.assetType]}</TableCell>
                      <TableCell align="right">{Number(i.quantity).toLocaleString("pt-BR", { maximumFractionDigits: 8 })}</TableCell>
                      <TableCell align="right">{money(i.averagePrice)}</TableCell>
                      <TableCell align="right">{money(i.currentPrice)}</TableCell>
                      <TableCell align="right">{money(i.marketValue)}</TableCell>
                      <TableCell align="right">
                        <Chip size="small" label={money(gain)} color={gain >= 0 ? "success" : "error"} />
                      </TableCell>
                      <TableCell align="right">
                        <Tooltip title="Atualizar preço">
                          <IconButton size="small" onClick={() => setUpdatingPrice(i)} aria-label={`Atualizar preço de ${i.assetName}`}>
                            <PriceChangeIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Histórico de preços">
                          <IconButton size="small" onClick={() => setViewingHistory(i)} aria-label={`Histórico de ${i.assetName}`}>
                            <HistoryIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Excluir">
                          <IconButton size="small" onClick={() => setDeleting(i)} aria-label={`Excluir ${i.assetName}`}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </QueryState>
      {creating && <CreateInvestmentDialog accounts={accountsQuery.data ?? []} onClose={() => setCreating(false)} />}
      {updatingPrice && <UpdatePriceDialog investment={updatingPrice} onClose={() => setUpdatingPrice(null)} />}
      {viewingHistory && <PriceHistoryDialog investment={viewingHistory} onClose={() => setViewingHistory(null)} />}
      <ConfirmDialog
        open={deleting !== null}
        title="Excluir investimento"
        message={`${deleting?.assetName} será removido da sua carteira.`}
        confirmLabel="Excluir"
        busy={deleteMutation.isPending}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
        onClose={() => setDeleting(null)}
      />
    </Page>
  );
}

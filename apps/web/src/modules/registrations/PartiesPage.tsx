// apps/web/src/modules/registrations/PartiesPage.tsx
// Telas de Clientes e Fornecedores (CRUD via API real). A API não expõe DELETE para
// nenhum dos dois, então não há ação de exclusão (lacuna do backend, não da tela).
import { useState } from "react";
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Alert,
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
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import SearchIcon from "@mui/icons-material/Search";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { clientsApi, suppliersApi, type Client, type Supplier } from "./api";
import { healthInsurancePlansApi } from "../optical/api";
import { Page, PageHeader, QueryState, errorMessage } from "../../shared/ui/PageLayout";
import { useToast } from "../../shared/ui/Toast";
import { useDebounced } from "../../shared/ui/useDebounced";
import { money, parseDecimal } from "../../shared/ui/format";

type Kind = "client" | "supplier";
type Party = Client | Supplier;

const COPY = {
  client: { title: "Clientes", singular: "cliente", queryKey: "clients" },
  supplier: { title: "Fornecedores", singular: "fornecedor", queryKey: "suppliers" },
} as const;

const PAGE_SIZE = 50;

interface FormState {
  name: string;
  document: string;
  phone: string;
  email: string;
  creditLimit: string;
  isReseller: boolean;
  isBusinessAccount: boolean;
  healthInsurancePlanId: string;
  healthInsurancePlanMemberId: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  document: "",
  phone: "",
  email: "",
  creditLimit: "0",
  isReseller: false,
  isBusinessAccount: false,
  healthInsurancePlanId: "",
  healthInsurancePlanMemberId: "",
};

function toForm(party: Party | null): FormState {
  if (!party) return EMPTY_FORM;
  return {
    name: party.name,
    document: party.document ?? "",
    phone: party.phone ?? "",
    email: party.email ?? "",
    creditLimit: "creditLimit" in party ? String(Number(party.creditLimit)) : "0",
    isReseller: "isReseller" in party ? Boolean(party.isReseller) : false,
    isBusinessAccount: "isBusinessAccount" in party ? Boolean((party as Client).isBusinessAccount) : false,
    healthInsurancePlanId: "healthInsurancePlanId" in party ? (party.healthInsurancePlanId ?? "") : "",
    healthInsurancePlanMemberId: "healthInsurancePlanMemberId" in party ? (party.healthInsurancePlanMemberId ?? "") : "",
  };
}

function PartyDialog({ kind, party, onClose }: { kind: Kind; party: Party | null; onClose: () => void }) {
  const copy = COPY[kind];
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<FormState>(() => toForm(party));
  const [formError, setFormError] = useState<string | null>(null);
  const healthInsurancePlans = useQuery({
    queryKey: ["health-insurance-plans"],
    queryFn: () => healthInsurancePlansApi.list(),
    enabled: kind === "client",
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const base = {
        name: form.name.trim(),
        document: form.document.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
      };
      if (kind === "client") {
        const creditLimit = parseDecimal(form.creditLimit) ?? 0;
        const clientExtra = {
          creditLimit,
          isReseller: form.isReseller,
          isBusinessAccount: form.isBusinessAccount,
          healthInsurancePlanId: form.healthInsurancePlanId || null,
          healthInsurancePlanMemberId: form.healthInsurancePlanMemberId.trim() || null,
        };
        return party ? clientsApi.update(party.id, { ...base, ...clientExtra }) : clientsApi.create({ ...base, ...clientExtra });
      }
      return party ? suppliersApi.update(party.id, base) : suppliersApi.create(base);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [copy.queryKey] });
      toast.success(`${copy.singular[0].toUpperCase()}${copy.singular.slice(1)} salvo com sucesso.`);
      onClose();
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  const set = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  function submit() {
    setFormError(null);
    if (form.name.trim().length < 2) {
      setFormError("Informe o nome (mínimo 2 caracteres).");
      return;
    }
    mutation.mutate();
  }

  return (
    <Dialog open onClose={mutation.isPending ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>{party ? `Editar ${copy.singular}` : `Novo ${copy.singular}`}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {formError && <Alert severity="error">{formError}</Alert>}
          <TextField label="Nome" value={form.name} onChange={set("name")} required autoFocus fullWidth />
          <TextField label="CPF/CNPJ" value={form.document} onChange={set("document")} fullWidth />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField label="Telefone" value={form.phone} onChange={set("phone")} fullWidth />
            <TextField label="E-mail" type="email" value={form.email} onChange={set("email")} fullWidth />
          </Stack>
          {kind === "client" && (
            <>
              <TextField label="Limite de crédito (R$)" value={form.creditLimit} onChange={set("creditLimit")} fullWidth />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={form.isReseller}
                    onChange={(e) => setForm((prev) => ({ ...prev, isReseller: e.target.checked }))}
                  />
                }
                label="Cliente revendedor (usa Preço Revenda na precificação em cascata — Capítulo 4.3)"
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={form.isBusinessAccount}
                    onChange={(e) => setForm((prev) => ({ ...prev, isBusinessAccount: e.target.checked }))}
                  />
                }
                label="Conta profissional/empresarial (construtora, empreiteiro — limite de crédito maior e faturamento mensal consolidado, Capítulo 11.8)"
              />
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField
                  select
                  label="Convênio óptico (opcional)"
                  value={form.healthInsurancePlanId}
                  onChange={(e) => setForm((prev) => ({ ...prev, healthInsurancePlanId: e.target.value }))}
                  helperText="Capítulo 11.2 — habilita venda com pagamento por convênio no PDV."
                  fullWidth
                >
                  <MenuItem value="">Nenhum</MenuItem>
                  {(healthInsurancePlans.data ?? []).map((plan) => (
                    <MenuItem key={plan.id} value={plan.id}>
                      {plan.name}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  label="Matrícula no convênio"
                  value={form.healthInsurancePlanMemberId}
                  onChange={set("healthInsurancePlanMemberId")}
                  disabled={!form.healthInsurancePlanId}
                  fullWidth
                />
              </Stack>
            </>
          )}
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

function PartiesPage({ kind }: { kind: Kind }) {
  const copy = COPY[kind];
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search.trim());
  const [editing, setEditing] = useState<Party | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loadedPages, setLoadedPages] = useState(1);

  const query = useQuery({
    queryKey: [copy.queryKey, debounced, loadedPages],
    queryFn: () =>
      kind === "client"
        ? clientsApi.list(debounced || undefined, 1, PAGE_SIZE * loadedPages)
        : suppliersApi.list(debounced || undefined, 1, PAGE_SIZE * loadedPages),
  });

  const rows = (query.data?.data ?? []) as Party[];
  const total = query.data?.meta?.total ?? rows.length;
  const hasMore = rows.length < total;

  return (
    <Page>
      <PageHeader
        title={copy.title}
        subtitle={`Exibindo ${rows.length} de ${total} registros.`}
        actions={
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            Novo {copy.singular}
          </Button>
        }
      />
      <TextField
        fullWidth
        size="small"
        label={kind === "client" ? "Buscar por nome, CPF/CNPJ ou telefone" : "Buscar por nome ou CPF/CNPJ"}
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setLoadedPages(1);
        }}
        sx={{ mb: 2 }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon fontSize="small" />
            </InputAdornment>
          ),
        }}
      />
      <QueryState query={query} isEmpty={(d) => d.data.length === 0} emptyMessage={`Nenhum ${copy.singular} encontrado.`}>
        {() => (
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Nome</TableCell>
                  <TableCell>CPF/CNPJ</TableCell>
                  <TableCell>Telefone</TableCell>
                  <TableCell>E-mail</TableCell>
                  {kind === "client" && <TableCell align="right">Limite de crédito</TableCell>}
                  {kind === "client" && <TableCell align="right">Saldo usado (crediário)</TableCell>}
                  <TableCell align="right">Ações</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} hover>
                    <TableCell>{row.name}</TableCell>
                    <TableCell>{row.document ?? "—"}</TableCell>
                    <TableCell>{row.phone ?? "—"}</TableCell>
                    <TableCell>{row.email ?? "—"}</TableCell>
                    {kind === "client" && <TableCell align="right">{money((row as Client).creditLimit)}</TableCell>}
                    {kind === "client" && (
                      <TableCell align="right">{money((row as Client).creditBalanceUsed)}</TableCell>
                    )}
                    <TableCell align="right">
                      <Tooltip title="Editar">
                        <IconButton
                          size="small"
                          aria-label={`Editar ${row.name}`}
                          onClick={() => {
                            setEditing(row);
                            setDialogOpen(true);
                          }}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </QueryState>
      {hasMore && (
        <Stack direction="row" justifyContent="center" sx={{ mt: 2 }}>
          <Button onClick={() => setLoadedPages((p) => p + 1)} disabled={query.isFetching}>
            {query.isFetching ? "Carregando…" : `Carregar mais (${rows.length} de ${total})`}
          </Button>
        </Stack>
      )}
      {dialogOpen && (
        <PartyDialog
          key={editing?.id ?? "new"}
          kind={kind}
          party={editing}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </Page>
  );
}

export function ClientsPage() {
  return <PartiesPage kind="client" />;
}

export function SuppliersPage() {
  return <PartiesPage kind="supplier" />;
}

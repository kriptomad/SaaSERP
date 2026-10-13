// apps/web/src/modules/registrations/ProductsPage.tsx
// Cadastro de produtos. /products devolve todos os produtos ativos sem paginação
// server-side, então busca (nome/SKU/EAN) e paginação são feitas no cliente.
import { useMemo, useState } from "react";
import {
  Alert,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Tooltip,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import EditIcon from "@mui/icons-material/Edit";
import GridViewIcon from "@mui/icons-material/GridView";
import SearchIcon from "@mui/icons-material/Search";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  productsApi,
  TRACKING_LABEL,
  type ProductDetail,
  type ProductInput,
  type ProductListItem,
  type TrackingType,
} from "./api";
import { Page, PageHeader, QueryState, errorMessage } from "../../shared/ui/PageLayout";
import { useToast } from "../../shared/ui/Toast";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { SupplierPicker } from "../../shared/lookups";
import { money, parseDecimal, qty } from "../../shared/ui/format";
import { VariantsDialog } from "../product-variants/VariantsDialog";

interface FormState {
  sku: string;
  barcode: string;
  name: string;
  description: string;
  category: string;
  trackingType: TrackingType;
  ncm: string;
  originUf: string;
  unitPrice: string;
  wholesalePrice: string;
  wholesaleMinQty: string;
  costPrice: string;
  minStockThreshold: string;
  stockQuantity: string;
  isWeighted: boolean;
  supplierId: string | null;
  collectionTag: string;
}

const EMPTY: FormState = {
  sku: "",
  barcode: "",
  name: "",
  description: "",
  category: "",
  trackingType: "NONE",
  ncm: "00000000",
  originUf: "",
  unitPrice: "",
  wholesalePrice: "",
  wholesaleMinQty: "",
  costPrice: "",
  minStockThreshold: "",
  stockQuantity: "0",
  isWeighted: false,
  supplierId: null,
  collectionTag: "",
};

function fromProduct(p: ProductDetail): FormState {
  return {
    sku: p.sku,
    barcode: p.barcode ?? "",
    name: p.name,
    description: p.description ?? "",
    category: p.category ?? "",
    trackingType: p.trackingType,
    ncm: p.ncm,
    originUf: p.originUf ?? "",
    unitPrice: String(Number(p.unitPrice)),
    wholesalePrice: p.wholesalePrice ? String(Number(p.wholesalePrice)) : "",
    wholesaleMinQty: p.wholesaleMinQty ? String(p.wholesaleMinQty) : "",
    costPrice: p.costPrice ? String(Number(p.costPrice)) : "",
    minStockThreshold: p.minStockThreshold ? String(Number(p.minStockThreshold)) : "",
    stockQuantity: String(Number(p.stockQuantity)),
    isWeighted: p.isWeighted,
    supplierId: p.supplierId,
    collectionTag: p.collectionTag ?? "",
  };
}

function ProductForm({ product, onClose }: { product: ProductDetail | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<FormState>(product ? fromProduct(product) : EMPTY);
  const [formError, setFormError] = useState<string | null>(null);

  const set = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const mutation = useMutation({
    mutationFn: (input: ProductInput) => (product ? productsApi.update(product.id, input) : productsApi.create(input)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      toast.success("Produto salvo com sucesso.");
      onClose();
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  function submit() {
    setFormError(null);
    const unitPrice = parseDecimal(form.unitPrice);
    if (form.sku.trim().length < 1 || form.name.trim().length < 2) {
      setFormError("SKU e nome (mínimo 2 caracteres) são obrigatórios.");
      return;
    }
    if (unitPrice === null || unitPrice <= 0) {
      setFormError("Informe um preço de venda maior que zero.");
      return;
    }
    if (form.originUf.trim() && form.originUf.trim().length !== 2) {
      setFormError("UF de origem deve ter 2 letras.");
      return;
    }
    const wholesalePrice = parseDecimal(form.wholesalePrice);
    const wholesaleMinQty = parseDecimal(form.wholesaleMinQty);
    const input: ProductInput = {
      sku: form.sku.trim(),
      barcode: form.barcode.trim() || null,
      name: form.name.trim(),
      description: form.description.trim() || null,
      category: form.category.trim() || null,
      trackingType: form.trackingType,
      ncm: form.ncm.trim() || "00000000",
      originUf: form.originUf.trim().toUpperCase() || null,
      unitPrice,
      wholesalePrice: wholesalePrice && wholesalePrice > 0 ? wholesalePrice : null,
      wholesaleMinQty: wholesaleMinQty && wholesaleMinQty > 0 ? Math.round(wholesaleMinQty) : null,
      costPrice: parseDecimal(form.costPrice),
      minStockThreshold: parseDecimal(form.minStockThreshold),
      isWeighted: form.isWeighted,
      supplierId: form.supplierId,
      collectionTag: form.collectionTag.trim() || null,
      ...(product ? {} : { stockQuantity: parseDecimal(form.stockQuantity) ?? 0 }),
    };
    mutation.mutate(input);
  }

  return (
    <Dialog open onClose={mutation.isPending ? undefined : onClose} fullWidth maxWidth="md">
      <DialogTitle>{product ? "Editar produto" : "Novo produto"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {formError && <Alert severity="error">{formError}</Alert>}
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField label="Nome" value={form.name} onChange={set("name")} required fullWidth autoFocus />
            <TextField label="SKU" value={form.sku} onChange={set("sku")} required sx={{ minWidth: 180 }} />
            <TextField label="Código de barras (EAN)" value={form.barcode} onChange={set("barcode")} sx={{ minWidth: 220 }} />
          </Stack>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField label="Categoria" value={form.category} onChange={set("category")} fullWidth />
            <TextField select label="Tipo de rastreio" value={form.trackingType} onChange={set("trackingType")} fullWidth>
              {(Object.keys(TRACKING_LABEL) as TrackingType[]).map((t) => (
                <MenuItem key={t} value={t}>
                  {t} — {TRACKING_LABEL[t]}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          <TextField label="Descrição" value={form.description} onChange={set("description")} multiline minRows={2} fullWidth />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField label="Preço de venda (R$)" value={form.unitPrice} onChange={set("unitPrice")} required fullWidth />
            <TextField label="Custo (R$)" value={form.costPrice} onChange={set("costPrice")} fullWidth />
            <TextField label="Preço atacado (R$)" value={form.wholesalePrice} onChange={set("wholesalePrice")} fullWidth />
            <TextField label="Qtd. mín. atacado" value={form.wholesaleMinQty} onChange={set("wholesaleMinQty")} fullWidth />
          </Stack>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField label="NCM" value={form.ncm} onChange={set("ncm")} fullWidth />
            <TextField label="UF de origem" value={form.originUf} onChange={set("originUf")} inputProps={{ maxLength: 2 }} fullWidth />
            <TextField label="Estoque mínimo" value={form.minStockThreshold} onChange={set("minStockThreshold")} fullWidth />
            <TextField
              label="Estoque inicial"
              value={form.stockQuantity}
              onChange={set("stockQuantity")}
              disabled={Boolean(product)}
              helperText={product ? "Use Estoque › Ajuste" : undefined}
              fullWidth
            />
          </Stack>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems="center">
            <FormControlLabel
              control={
                <Switch checked={form.isWeighted} onChange={(e) => setForm((p) => ({ ...p, isWeighted: e.target.checked }))} />
              }
              label="Vendido por peso"
            />
            <SupplierPicker value={form.supplierId} onChange={(id) => setForm((p) => ({ ...p, supplierId: id }))} label="Fornecedor (opcional)" />
          </Stack>
          <TextField
            label="Coleção/estação (opcional)"
            value={form.collectionTag}
            onChange={set("collectionTag")}
            helperText='Capítulo 11.4 — ex.: "Verão 2026". Habilita o relatório de giro por coleção e a sinalização de liquidação.'
            fullWidth
          />
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

// Busca o produto completo (a listagem não traz custo, UF nem fornecedor) antes de editar.
function EditProductLoader({ id, onClose }: { id: string; onClose: () => void }) {
  const query = useQuery({ queryKey: ["products", id], queryFn: () => productsApi.get(id) });
  if (query.isError) {
    return (
      <Dialog open onClose={onClose}>
        <DialogContent>
          <Alert severity="error">{errorMessage(query.error)}</Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Fechar</Button>
        </DialogActions>
      </Dialog>
    );
  }
  if (!query.data) {
    return (
      <Dialog open>
        <DialogContent>
          <CircularProgress aria-label="Carregando produto" />
        </DialogContent>
      </Dialog>
    );
  }
  return <ProductForm product={query.data} onClose={onClose} />;
}

export function ProductsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const query = useQuery({ queryKey: ["products"], queryFn: productsApi.list });
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [formState, setFormState] = useState<{ mode: "new" } | { mode: "edit"; id: string } | null>(null);
  const [toDelete, setToDelete] = useState<ProductListItem | null>(null);
  const [variantsFor, setVariantsFor] = useState<ProductListItem | null>(null);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const all = query.data ?? [];
    if (!term) return all;
    return all.filter(
      (p) => p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term) || (p.barcode ?? "").includes(term),
    );
  }, [query.data, search]);

  const removal = useMutation({
    mutationFn: (id: string) => productsApi.remove(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      toast.success("Produto desativado.");
      setToDelete(null);
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      setToDelete(null);
    },
  });

  const visible = filtered.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  return (
    <Page>
      <PageHeader
        title="Produtos"
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setFormState({ mode: "new" })}>
            Novo produto
          </Button>
        }
      />
      <TextField
        fullWidth
        size="small"
        label="Buscar por nome, SKU ou código de barras"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(0);
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
      <QueryState query={query} isEmpty={(d) => d.length === 0} emptyMessage="Nenhum produto cadastrado ainda.">
        {() =>
          filtered.length === 0 ? (
            <Alert severity="info">Nenhum produto corresponde à busca.</Alert>
          ) : (
            <Paper>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Produto</TableCell>
                      <TableCell>SKU</TableCell>
                      <TableCell>EAN</TableCell>
                      <TableCell>Rastreio</TableCell>
                      <TableCell align="right">Preço</TableCell>
                      <TableCell align="right">Estoque</TableCell>
                      <TableCell align="right">Ações</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {visible.map((p) => (
                      <TableRow key={p.id} hover>
                        <TableCell>
                          {p.name}
                          {p.category && (
                            <Chip size="small" label={p.category} variant="outlined" sx={{ ml: 1 }} />
                          )}
                          {p.collectionTag && (
                            <Chip size="small" label={p.collectionTag} color="secondary" variant="outlined" sx={{ ml: 1 }} />
                          )}
                        </TableCell>
                        <TableCell>{p.sku}</TableCell>
                        <TableCell>{p.barcode ?? "—"}</TableCell>
                        <TableCell>
                          <Chip size="small" label={p.trackingType} color={p.trackingType === "NONE" ? "default" : "primary"} />
                        </TableCell>
                        <TableCell align="right">{money(p.unitPrice)}</TableCell>
                        <TableCell align="right">{qty(p.stockQuantity)}</TableCell>
                        <TableCell align="right">
                          {p.trackingType === "VARIANT" && (
                            <Tooltip title="Grade / variantes">
                              <IconButton size="small" aria-label={`Variantes de ${p.name}`} onClick={() => setVariantsFor(p)}>
                                <GridViewIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          )}
                          <Tooltip title="Editar">
                            <IconButton size="small" aria-label={`Editar ${p.name}`} onClick={() => setFormState({ mode: "edit", id: p.id })}>
                              <EditIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Desativar">
                            <IconButton size="small" aria-label={`Desativar ${p.name}`} onClick={() => setToDelete(p)}>
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              <TablePagination
                component="div"
                count={filtered.length}
                page={page}
                onPageChange={(_, next) => setPage(next)}
                rowsPerPage={rowsPerPage}
                onRowsPerPageChange={(e) => {
                  setRowsPerPage(Number(e.target.value));
                  setPage(0);
                }}
                rowsPerPageOptions={[10, 25, 50, 100]}
                labelRowsPerPage="Linhas por página"
              />
            </Paper>
          )
        }
      </QueryState>
      {formState?.mode === "new" && <ProductForm product={null} onClose={() => setFormState(null)} />}
      {formState?.mode === "edit" && <EditProductLoader id={formState.id} onClose={() => setFormState(null)} />}
      {variantsFor && (
        <VariantsDialog productId={variantsFor.id} productName={variantsFor.name} onClose={() => setVariantsFor(null)} />
      )}
      <ConfirmDialog
        open={toDelete !== null}
        title="Desativar produto"
        message={`Desativar "${toDelete?.name}"? Ele deixa de aparecer nas listagens e no PDV (o histórico é preservado).`}
        confirmLabel="Desativar"
        busy={removal.isPending}
        onConfirm={() => toDelete && removal.mutate(toDelete.id)}
        onClose={() => setToDelete(null)}
      />
    </Page>
  );
}

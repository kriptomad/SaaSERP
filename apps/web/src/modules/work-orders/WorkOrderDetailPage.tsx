// apps/web/src/modules/work-orders/WorkOrderDetailPage.tsx
// Detalhe da O.S.: itens, orçamento, checklist, fotos e transições de status.
// Fotos: upload real direto para o Cloudflare R2 via URL assinada (Capítulo 3) —
// o navegador faz o PUT binário direto no R2, a API só grava o ponteiro storageKey.
import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link as RouterLink, useParams } from "react-router-dom";
import {
  PATCH_TRANSITIONS,
  PAYMENT_METHOD_LABEL,
  WO_STATUS,
  workOrderTotal,
  workOrdersApi,
  type Checklist,
  type PaymentMethod,
  type WorkOrderDetail,
} from "./api";
import { Page, PageHeader, QueryState, errorMessage } from "../../shared/ui/PageLayout";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { useToast } from "../../shared/ui/Toast";
import { formatDate, formatDateTime, money, parseDecimal, qty, toNumber } from "../../shared/ui/format";
import { resolveStorageDownloadUrl, uploadFileToStorage } from "../../shared/storage/upload";
import { fetchCurrentCashRegister } from "../../api/client";

const STAGE_LABEL: Record<Checklist["stage"], string> = { ENTRY: "Entrada", DIAGNOSIS: "Diagnóstico", DELIVERY: "Entrega" };

function useRefresh(id: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["work-order", id] });
    void queryClient.invalidateQueries({ queryKey: ["work-orders"] });
  };
}

function ItemsTab({ order }: { order: WorkOrderDetail }) {
  const toast = useToast();
  const refresh = useRefresh(order.id);
  const closed = order.status === "DELIVERED" || order.status === "CANCELLED";
  const [description, setDescription] = useState("");
  const [itemType, setItemType] = useState<"PART" | "LABOR">("LABOR");
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");
  const [commissionable, setCommissionable] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [itemToRemove, setItemToRemove] = useState<{ id: string; description: string; subtotal: number } | null>(null);

  const add = useMutation({
    mutationFn: workOrdersApi.addItem.bind(null, order.id),
    onSuccess: () => {
      setDescription("");
      setUnitPrice("");
      setQuantity("1");
      refresh();
    },
    onError: (error) => setFormError(errorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: (itemId: string) => workOrdersApi.removeItem(order.id, itemId),
    onSuccess: () => {
      refresh();
      setItemToRemove(null);
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      setItemToRemove(null);
    },
  });

  function submit() {
    setFormError(null);
    const q = parseDecimal(quantity);
    const price = parseDecimal(unitPrice);
    if (!description.trim()) return setFormError("Informe a descrição do item.");
    if (!q || q <= 0) return setFormError("Quantidade deve ser maior que zero.");
    if (price === null || price < 0) return setFormError("Informe o valor unitário.");
    add.mutate({ description: description.trim(), itemType, quantity: q, unitPrice: price, commissionable: itemType === "LABOR" && commissionable });
  }

  return (
    <Stack spacing={2}>
      {order.items.length === 0 ? (
        <Alert severity="info">Nenhuma peça ou mão de obra lançada.</Alert>
      ) : (
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Descrição</TableCell>
                <TableCell>Tipo</TableCell>
                <TableCell align="right">Qtd.</TableCell>
                <TableCell align="right">Unitário</TableCell>
                <TableCell align="right">Subtotal</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {order.items.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>{i.description}</TableCell>
                  <TableCell>{i.itemType === "PART" ? "Peça" : "Mão de obra"}</TableCell>
                  <TableCell align="right">{qty(i.quantity)}</TableCell>
                  <TableCell align="right">{money(i.unitPrice)}</TableCell>
                  <TableCell align="right">{money(toNumber(i.quantity) * toNumber(i.unitPrice))}</TableCell>
                  <TableCell align="right">
                    {!closed && (
                      <IconButton
                        size="small"
                        aria-label={`Remover ${i.description}`}
                        onClick={() =>
                          setItemToRemove({ id: i.id, description: i.description, subtotal: toNumber(i.quantity) * toNumber(i.unitPrice) })
                        }
                        disabled={remove.isPending}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell colSpan={4} align="right">
                  <strong>Total</strong>
                </TableCell>
                <TableCell align="right">
                  <strong>{money(workOrderTotal(order.items))}</strong>
                </TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>
      )}
      {!closed && (
        <Paper sx={{ p: 2 }}>
          <Stack spacing={2}>
            <Typography variant="subtitle2">Lançar item</Typography>
            {formError && <Alert severity="error">{formError}</Alert>}
            <Stack direction={{ xs: "column", md: "row" }} spacing={1} alignItems={{ md: "center" }}>
              <TextField label="Descrição" value={description} onChange={(e) => setDescription(e.target.value)} sx={{ flex: 3 }} />
              <TextField select label="Tipo" value={itemType} onChange={(e) => setItemType(e.target.value as typeof itemType)} sx={{ flex: 1 }}>
                <MenuItem value="LABOR">Mão de obra</MenuItem>
                <MenuItem value="PART">Peça</MenuItem>
              </TextField>
              <TextField label="Qtd." value={quantity} onChange={(e) => setQuantity(e.target.value)} sx={{ flex: 1 }} />
              <TextField label="Unitário (R$)" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} sx={{ flex: 1 }} />
              {itemType === "LABOR" && (
                <FormControlLabel control={<Checkbox checked={commissionable} onChange={(e) => setCommissionable(e.target.checked)} />} label="Comissionável" />
              )}
              <Button variant="contained" onClick={submit} disabled={add.isPending}>
                Adicionar
              </Button>
            </Stack>
          </Stack>
        </Paper>
      )}

      <ConfirmDialog
        open={itemToRemove !== null}
        title="Remover item da ordem de serviço"
        message={`Remover "${itemToRemove?.description}" (${money(itemToRemove?.subtotal ?? 0)})? Esta ação não pode ser desfeita.`}
        confirmLabel="Remover item"
        busy={remove.isPending}
        onConfirm={() => itemToRemove && remove.mutate(itemToRemove.id)}
        onClose={() => setItemToRemove(null)}
      />
    </Stack>
  );
}

function ChecklistTab({ order }: { order: WorkOrderDetail }) {
  const refresh = useRefresh(order.id);
  const [stage, setStage] = useState<Checklist["stage"]>("ENTRY");
  const [entries, setEntries] = useState<Array<{ label: string; ok: boolean }>>([]);
  const [label, setLabel] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => workOrdersApi.addChecklist(order.id, { stage, items: Object.fromEntries(entries.map((e) => [e.label, e.ok])) }),
    onSuccess: () => {
      setEntries([]);
      refresh();
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  function addEntry() {
    const text = label.trim();
    if (!text) return;
    setEntries((prev) => (prev.some((e) => e.label === text) ? prev : [...prev, { label: text, ok: true }]));
    setLabel("");
  }

  return (
    <Stack spacing={2}>
      {order.checklist.length === 0 ? (
        <Alert severity="info">Nenhum checklist registrado.</Alert>
      ) : (
        order.checklist.map((c) => (
          <Paper key={c.id} sx={{ p: 2 }}>
            <Typography variant="subtitle2">
              {STAGE_LABEL[c.stage] ?? c.stage} · {formatDateTime(c.createdAt)}
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
              {Object.entries(c.items ?? {}).map(([key, value]) => (
                <Chip key={key} size="small" label={key} color={value === true ? "success" : value === false ? "error" : "default"} variant="outlined" />
              ))}
            </Stack>
          </Paper>
        ))
      )}
      <Paper sx={{ p: 2 }}>
        <Stack spacing={2}>
          <Typography variant="subtitle2">Novo checklist</Typography>
          {formError && <Alert severity="error">{formError}</Alert>}
          <TextField select label="Etapa" value={stage} onChange={(e) => setStage(e.target.value as Checklist["stage"])} sx={{ maxWidth: 240 }}>
            {(Object.keys(STAGE_LABEL) as Checklist["stage"][]).map((s) => (
              <MenuItem key={s} value={s}>
                {STAGE_LABEL[s]}
              </MenuItem>
            ))}
          </TextField>
          <Stack direction="row" spacing={1}>
            <TextField
              size="small"
              label="Item verificado (ex.: Tela sem trincas)"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addEntry()}
              fullWidth
            />
            <Button onClick={addEntry}>Incluir</Button>
          </Stack>
          <Box>
            {entries.map((entry) => (
              <FormControlLabel
                key={entry.label}
                sx={{ display: "flex" }}
                control={
                  <Checkbox
                    checked={entry.ok}
                    onChange={(e) => setEntries((prev) => prev.map((p) => (p.label === entry.label ? { ...p, ok: e.target.checked } : p)))}
                  />
                }
                label={entry.label}
              />
            ))}
          </Box>
          <Box>
            <Button
              variant="contained"
              disabled={entries.length === 0 || mutation.isPending}
              onClick={() => {
                setFormError(null);
                mutation.mutate();
              }}
            >
              Salvar checklist
            </Button>
          </Box>
        </Stack>
      </Paper>
    </Stack>
  );
}

function PhotosTab({ order }: { order: WorkOrderDetail }) {
  const refresh = useRefresh(order.id);
  const toast = useToast();
  const [caption, setCaption] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [viewingPhotoId, setViewingPhotoId] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!selectedFile) throw new Error("Selecione um arquivo de foto antes de enviar.");
      setUploading(true);
      try {
        const storageKey = await uploadFileToStorage(selectedFile, "work-order-photos");
        return workOrdersApi.addPhoto(order.id, { storageKey, caption: caption.trim() || null });
      } finally {
        setUploading(false);
      }
    },
    onSuccess: () => {
      setSelectedFile(null);
      setCaption("");
      refresh();
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  async function handleViewPhoto(photoId: string, storageKey: string) {
    setViewingPhotoId(photoId);
    try {
      const url = await resolveStorageDownloadUrl(storageKey);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setViewingPhotoId(null);
    }
  }

  return (
    <Stack spacing={2}>
      <Alert severity="info">
        Fotos do laudo técnico: JPEG/PNG/WEBP até 15 MB, enviadas diretamente para o armazenamento Cloudflare R2.
      </Alert>
      {order.photos.length === 0 ? (
        <Alert severity="info">Nenhuma foto registrada.</Alert>
      ) : (
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Legenda</TableCell>
                <TableCell>Registrada em</TableCell>
                <TableCell align="right">Ações</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {order.photos.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{p.caption ?? "—"}</TableCell>
                  <TableCell>{formatDateTime(p.createdAt)}</TableCell>
                  <TableCell align="right">
                    <Button size="small" disabled={viewingPhotoId === p.id} onClick={() => handleViewPhoto(p.id, p.storageKey)}>
                      {viewingPhotoId === p.id ? "Abrindo…" : "Ver foto"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      <Paper sx={{ p: 2 }}>
        <Stack spacing={2}>
          {formError && <Alert severity="error">{formError}</Alert>}
          <Stack direction={{ xs: "column", md: "row" }} spacing={1} alignItems={{ md: "center" }}>
            <Button variant="outlined" component="label">
              {selectedFile ? selectedFile.name : "Escolher foto"}
              <input
                type="file"
                hidden
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => {
                  setFormError(null);
                  setSelectedFile(e.target.files?.[0] ?? null);
                }}
              />
            </Button>
            <TextField label="Legenda" value={caption} onChange={(e) => setCaption(e.target.value)} fullWidth />
            <Button
              variant="contained"
              disabled={!selectedFile || mutation.isPending || uploading}
              onClick={() => {
                setFormError(null);
                mutation.mutate();
              }}
            >
              {uploading ? "Enviando…" : "Enviar foto"}
            </Button>
          </Stack>
        </Stack>
      </Paper>
    </Stack>
  );
}

function DiagnosisCard({ order }: { order: WorkOrderDetail }) {
  const toast = useToast();
  const refresh = useRefresh(order.id);
  const [notes, setNotes] = useState(order.diagnosisNotes ?? "");
  const mutation = useMutation({
    mutationFn: () => workOrdersApi.update(order.id, { diagnosisNotes: notes.trim() || null }),
    onSuccess: () => {
      toast.success("Diagnóstico salvo.");
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const closed = order.status === "DELIVERED" || order.status === "CANCELLED";
  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        Diagnóstico
      </Typography>
      <TextField fullWidth multiline minRows={2} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={closed} />
      {!closed && (
        <Button sx={{ mt: 1 }} onClick={() => mutation.mutate()} disabled={mutation.isPending || notes === (order.diagnosisNotes ?? "")}>
          Salvar diagnóstico
        </Button>
      )}
    </Paper>
  );
}

type Confirm = { kind: "status"; status: string } | { kind: "approve" } | null;

function Detail({ order }: { order: WorkOrderDetail }) {
  const toast = useToast();
  const refresh = useRefresh(order.id);
  const [tab, setTab] = useState(0);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [validForDays, setValidForDays] = useState("7");
  const [warrantyDays, setWarrantyDays] = useState("");
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [deliverOpen, setDeliverOpen] = useState(false);
  const [deliverPaymentMethod, setDeliverPaymentMethod] = useState<PaymentMethod>("CASH");
  const [deliverError, setDeliverError] = useState<string | null>(null);

  const transition = useMutation({
    mutationFn: async (action: NonNullable<Confirm>) => {
      if (action.kind === "status") return workOrdersApi.update(order.id, { status: action.status });
      if (!order.budgetApprovalToken) throw new Error("Orçamento sem token de aprovação.");
      return workOrdersApi.approveBudget(order.budgetApprovalToken);
    },
    onSuccess: () => {
      toast.success("Status atualizado.");
      refresh();
      setConfirm(null);
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      setConfirm(null);
    },
  });

  const deliver = useMutation({
    mutationFn: async () => {
      const current = await fetchCurrentCashRegister();
      if (!current.data?.id) throw new Error("Nenhum caixa aberto. Abra o caixa antes de entregar a O.S.");
      return workOrdersApi.deliver(order.id, { cashRegisterId: current.data.id, paymentMethod: deliverPaymentMethod });
    },
    onSuccess: () => {
      toast.success("O.S. entregue, venda registrada e nota fiscal emitida.");
      setDeliverOpen(false);
      refresh();
    },
    onError: (error) => setDeliverError(errorMessage(error)),
  });

  const budget = useMutation({
    mutationFn: () => {
      const days = parseDecimal(validForDays);
      if (!days || days < 1 || days > 90) throw new Error("Validade do orçamento: entre 1 e 90 dias.");
      const warranty = parseDecimal(warrantyDays);
      return workOrdersApi.setBudget(order.id, { validForDays: Math.round(days), ...(warranty !== null ? { warrantyDays: Math.round(warranty) } : {}) });
    },
    onSuccess: () => {
      toast.success("Orçamento gerado — O.S. aguardando aprovação do cliente.");
      setBudgetOpen(false);
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const status = WO_STATUS[order.status];
  const closed = order.status === "DELIVERED" || order.status === "CANCELLED";
  const nextStatuses = PATCH_TRANSITIONS[order.status];
  const confirmCopy =
    confirm?.kind === "status"
      ? { title: "Mudar status", message: `Mover a O.S. para “${WO_STATUS[confirm.status as keyof typeof WO_STATUS].label}”?` }
      : { title: "Registrar aprovação do orçamento", message: "Confirma que o cliente aprovou o orçamento? A O.S. seguirá para reparo." };

  return (
    <>
      <PageHeader
        title={`O.S. — ${order.equipmentDescription}`}
        subtitle={`Aberta em ${formatDate(order.createdAt)} · Cliente: ${order.client?.name ?? "—"} · Técnico: ${order.assignedTechnician?.name ?? "não atribuído"}${order.vehicle ? ` · Veículo: ${order.vehicle.licensePlate}` : ""}`}
        actions={
          <Button component={RouterLink} to="/os">
            Voltar
          </Button>
        }
      />
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
        <Chip label={status.label} color={status.color} />
        {nextStatuses.map((s) => (
          <Button key={s} size="small" variant="outlined" color={s === "CANCELLED" ? "inherit" : "primary"} onClick={() => setConfirm({ kind: "status", status: s })}>
            {s === "CANCELLED" ? "Cancelar O.S." : `→ ${WO_STATUS[s].label}`}
          </Button>
        ))}
        {order.status === "AWAITING_APPROVAL" && order.budgetApprovalToken && (
          <Button size="small" variant="contained" onClick={() => setConfirm({ kind: "approve" })}>
            Registrar aprovação do cliente
          </Button>
        )}
        {order.status === "READY" && (
          <Button size="small" variant="contained" onClick={() => { setDeliverError(null); setDeliverOpen(true); }}>
            Entregar ao cliente
          </Button>
        )}
        {!closed && order.status !== "READY" && order.items.length > 0 && (
          <Button size="small" variant="outlined" onClick={() => setBudgetOpen((v) => !v)}>
            {order.status === "AWAITING_APPROVAL" ? "Refazer orçamento" : "Gerar orçamento"}
          </Button>
        )}
      </Stack>

      {budgetOpen && (
        <Paper sx={{ p: 2, mb: 2 }}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }}>
            <TextField size="small" label="Validade do orçamento (dias)" value={validForDays} onChange={(e) => setValidForDays(e.target.value)} />
            <TextField size="small" label="Garantia (dias, opcional)" value={warrantyDays} onChange={(e) => setWarrantyDays(e.target.value)} />
            <Button variant="contained" onClick={() => budget.mutate()} disabled={budget.isPending}>
              Gerar orçamento ({money(workOrderTotal(order.items))})
            </Button>
          </Stack>
        </Paper>
      )}

      {order.status === "AWAITING_APPROVAL" && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Orçamento válido até {formatDate(order.budgetValidUntil)}. Aguardando aprovação do cliente.
        </Alert>
      )}
      {order.budgetApprovedAt && <Alert severity="success" sx={{ mb: 2 }}>Orçamento aprovado em {formatDateTime(order.budgetApprovedAt)}.</Alert>}

      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle2">Defeito relatado</Typography>
        <Typography variant="body2">{order.reportedIssue}</Typography>
      </Paper>
      <Box sx={{ mb: 2 }}>
        <DiagnosisCard order={order} />
      </Box>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label={`Itens (${order.items.length})`} />
        <Tab label={`Checklist (${order.checklist.length})`} />
        <Tab label={`Fotos (${order.photos.length})`} />
      </Tabs>
      {tab === 0 && <ItemsTab order={order} />}
      {tab === 1 && <ChecklistTab order={order} />}
      {tab === 2 && <PhotosTab order={order} />}

      <ConfirmDialog
        open={confirm !== null}
        title={confirmCopy.title}
        message={confirmCopy.message}
        busy={transition.isPending}
        onConfirm={() => confirm && transition.mutate(confirm)}
        onClose={() => setConfirm(null)}
      />

      <Dialog open={deliverOpen} onClose={() => setDeliverOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Entregar ao cliente</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {deliverError && <Alert severity="error">{deliverError}</Alert>}
            <Typography variant="body2">
              A entrega gera a cobrança ({money(workOrderTotal(order.items))}), registra a venda no caixa e emite a nota fiscal (NFC-e para peças e/ou NFS-e para serviço).
            </Typography>
            <TextField
              select
              label="Forma de pagamento"
              value={deliverPaymentMethod}
              onChange={(e) => setDeliverPaymentMethod(e.target.value as PaymentMethod)}
            >
              {(Object.keys(PAYMENT_METHOD_LABEL) as PaymentMethod[]).map((m) => (
                <MenuItem key={m} value={m}>
                  {PAYMENT_METHOD_LABEL[m]}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeliverOpen(false)} disabled={deliver.isPending}>
            Voltar
          </Button>
          <Button variant="contained" onClick={() => deliver.mutate()} disabled={deliver.isPending}>
            {deliver.isPending ? "Entregando…" : "Confirmar entrega"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

export function WorkOrderDetailPage() {
  const { id = "" } = useParams();
  const query = useQuery({ queryKey: ["work-order", id], queryFn: () => workOrdersApi.get(id), enabled: Boolean(id) });
  return (
    <Page maxWidth={1100}>
      <QueryState query={query}>{(order) => <Detail key={order.id} order={order} />}</QueryState>
    </Page>
  );
}

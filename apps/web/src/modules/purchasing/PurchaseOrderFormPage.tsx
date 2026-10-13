// apps/web/src/modules/purchasing/PurchaseOrderFormPage.tsx
import { useState } from "react";
import { Alert, Box, Button, IconButton, Paper, Stack, TextField, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import LightbulbIcon from "@mui/icons-material/LightbulbOutlined";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, Link as RouterLink } from "react-router-dom";
import { purchaseOrdersApi } from "./api";
import { Page, PageHeader, errorMessage } from "../../shared/ui/PageLayout";
import { ProductPicker, SupplierPicker } from "../../shared/lookups";
import { useToast } from "../../shared/ui/Toast";
import { dateInputToIso, money, parseDecimal } from "../../shared/ui/format";

interface Line {
  key: number;
  productId: string | null;
  quantity: string;
  unitCost: string;
}

let lineSeq = 0;
const newLine = (partial: Partial<Line> = {}): Line => ({ key: ++lineSeq, productId: null, quantity: "1", unitCost: "", ...partial });

export function PurchaseOrderFormPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [expectedAt, setExpectedAt] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [formError, setFormError] = useState<string | null>(null);

  const updateLine = (key: number, patch: Partial<Line>) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const total = lines.reduce((sum, l) => sum + (parseDecimal(l.quantity) ?? 0) * (parseDecimal(l.unitCost) ?? 0), 0);

  const suggestions = useMutation({
    mutationFn: purchaseOrdersApi.suggestions,
    onSuccess: (list) => {
      if (list.length === 0) {
        toast.success("Nenhum produto abaixo do estoque mínimo.");
        return;
      }
      setLines((prev) => {
        const existing = new Set(prev.map((l) => l.productId));
        const fresh = list
          .filter((s) => !existing.has(s.productId))
          .map((s) => newLine({ productId: s.productId, quantity: String(Math.max(1, Math.ceil(Number(s.suggestedQuantity)))) }));
        return [...prev.filter((l) => l.productId), ...fresh];
      });
      const preferred = list.find((s) => s.preferredSupplierId)?.preferredSupplierId;
      if (preferred) setSupplierId((current) => current ?? preferred);
      const fastMovers = list.filter((s) => Number(s.avgDailySalesVelocity) > 0).length;
      toast.success(
        `${list.length} sugestão(ões) de reposição carregada(s) (${fastMovers} considerando giro histórico de 30 dias). Informe o custo unitário de cada item.`,
      );
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const create = useMutation({
    mutationFn: purchaseOrdersApi.create,
    onSuccess: (order) => {
      void queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      toast.success(`Ordem de compra #${order.orderNumber} criada (rascunho).`);
      navigate("/compras");
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  function submit() {
    setFormError(null);
    if (!supplierId) return setFormError("Selecione o fornecedor.");
    const items = [];
    for (const [index, l] of lines.entries()) {
      const quantityOrdered = parseDecimal(l.quantity);
      const unitCost = parseDecimal(l.unitCost);
      if (!l.productId || !quantityOrdered || quantityOrdered <= 0 || !unitCost || unitCost <= 0) {
        return setFormError(`Item ${index + 1}: informe produto, quantidade e custo unitário maiores que zero.`);
      }
      items.push({ productId: l.productId, quantityOrdered, unitCost });
    }
    if (items.length === 0) return setFormError("Inclua ao menos um item.");
    create.mutate({
      supplierId,
      items,
      ...(expectedAt ? { expectedAt: dateInputToIso(expectedAt) } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    });
  }

  return (
    <Page maxWidth={960}>
      <PageHeader
        title="Nova ordem de compra"
        actions={
          <Button component={RouterLink} to="/compras">
            Voltar
          </Button>
        }
      />
      <Paper sx={{ p: 3 }}>
        <Stack spacing={2}>
          {formError && <Alert severity="error">{formError}</Alert>}
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <Box sx={{ flex: 2 }}>
              <SupplierPicker value={supplierId} onChange={setSupplierId} required />
            </Box>
            <TextField
              label="Previsão de entrega"
              type="date"
              value={expectedAt}
              onChange={(e) => setExpectedAt(e.target.value)}
              InputLabelProps={{ shrink: true }}
              sx={{ flex: 1 }}
            />
          </Stack>
          <TextField label="Observações" value={notes} onChange={(e) => setNotes(e.target.value)} multiline minRows={2} />

          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="subtitle1">Itens</Typography>
            <Button size="small" startIcon={<LightbulbIcon />} onClick={() => suggestions.mutate()} disabled={suggestions.isPending}>
              Carregar sugestões de reposição
            </Button>
          </Stack>
          {lines.map((line) => (
            <Stack key={line.key} direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }}>
              <Box sx={{ flex: 3 }}>
                <ProductPicker value={line.productId} onChange={(p) => updateLine(line.key, { productId: p?.id ?? null })} required />
              </Box>
              <TextField label="Qtd." value={line.quantity} onChange={(e) => updateLine(line.key, { quantity: e.target.value })} sx={{ flex: 1 }} />
              <TextField label="Custo unit. (R$)" value={line.unitCost} onChange={(e) => updateLine(line.key, { unitCost: e.target.value })} sx={{ flex: 1 }} />
              <IconButton aria-label="Remover item" onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))} disabled={lines.length === 1}>
                <DeleteIcon />
              </IconButton>
            </Stack>
          ))}
          <Box>
            <Button startIcon={<AddIcon />} onClick={() => setLines((prev) => [...prev, newLine()])}>
              Adicionar item
            </Button>
          </Box>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="h6">Total: {money(total)}</Typography>
            <Button variant="contained" onClick={submit} disabled={create.isPending}>
              {create.isPending ? "Salvando…" : "Criar ordem de compra"}
            </Button>
          </Stack>
        </Stack>
      </Paper>
    </Page>
  );
}

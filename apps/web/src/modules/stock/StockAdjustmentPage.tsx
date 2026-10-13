// apps/web/src/modules/stock/StockAdjustmentPage.tsx
// Ajuste manual: quantidade positiva = ADJUSTMENT (acréscimo); negativa = LOSS (baixa).
import { useEffect, useState } from "react";
import { Alert, Button, MenuItem, Paper, Stack, TextField, Typography } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { stockApi } from "./api";
import { Page, PageHeader, errorMessage } from "../../shared/ui/PageLayout";
import { ProductPicker, useProductsLookup } from "../../shared/lookups";
import { useToast } from "../../shared/ui/Toast";
import { parseDecimal, qty, toNumber } from "../../shared/ui/format";

export function StockAdjustmentPage() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const toast = useToast();
  const products = useProductsLookup();
  const productId = params.get("productId");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [batchId, setBatchId] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const selected = (products.data ?? []).find((p) => p.id === productId);
  const isBatchTracked = selected?.trackingType === "BATCH";
  const delta = parseDecimal(quantity);

  // Produtos rastreados por lote exigem productBatchId: o backend atualiza
  // ProductBatch.quantity, não só o total do produto (ver stock.routes.ts).
  const batches = useQuery({
    queryKey: ["product-batches", productId],
    queryFn: () => stockApi.batches(productId!),
    enabled: Boolean(productId) && isBatchTracked,
  });

  useEffect(() => {
    setBatchId("");
  }, [productId]);

  const mutation = useMutation({
    mutationFn: () =>
      stockApi.adjust({
        productId: productId!,
        quantity: delta!,
        reasonCode: reason.trim(),
        productBatchId: isBatchTracked ? batchId : undefined,
      }),
    onSuccess: (movement) => {
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      void queryClient.invalidateQueries({ queryKey: ["stock-movements"] });
      void queryClient.invalidateQueries({ queryKey: ["product-batches", productId] });
      toast.success(`Ajuste registrado (${movement.type}, ${qty(movement.quantity)}).`);
      setQuantity("");
      setReason("");
      setBatchId("");
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  function submit() {
    setFormError(null);
    if (!productId) return setFormError("Selecione um produto.");
    if (delta === null || delta === 0) return setFormError("Informe uma quantidade diferente de zero (use negativo para baixa).");
    if (!reason.trim()) return setFormError("Informe o motivo do ajuste.");
    if (isBatchTracked && !batchId) return setFormError("Este produto é controlado por lote: selecione o lote a ajustar.");
    mutation.mutate();
  }

  return (
    <Page maxWidth={720}>
      <PageHeader title="Ajuste manual de estoque" subtitle="Registra um StockMovement e atualiza o saldo do produto." />
      <Paper sx={{ p: 3 }}>
        <Stack spacing={2}>
          {formError && <Alert severity="error">{formError}</Alert>}
          <ProductPicker
            value={productId}
            onChange={(p) => {
              const next = new URLSearchParams(params);
              if (p) next.set("productId", p.id);
              else next.delete("productId");
              setParams(next, { replace: true });
            }}
            required
          />
          {selected && (
            <Typography variant="body2" color="text.secondary">
              Saldo atual: <strong>{qty(selected.stockQuantity)}</strong>
              {delta !== null && delta !== 0 && <> → saldo após o ajuste: <strong>{qty(toNumber(selected.stockQuantity) + delta)}</strong></>}
            </Typography>
          )}
          {isBatchTracked && (
            <TextField
              select
              label="Lote"
              value={batchId}
              onChange={(e) => setBatchId(e.target.value)}
              helperText="Produto controlado por lote: o ajuste incide sobre o lote selecionado."
              required
            >
              {(batches.data ?? []).map((b) => (
                <MenuItem key={b.id} value={b.id}>
                  {b.batchNumber} — venc. {new Date(b.expirationDate).toLocaleDateString("pt-BR")} — saldo {qty(b.quantity)}
                </MenuItem>
              ))}
            </TextField>
          )}
          <TextField
            label="Quantidade (+ entrada / − baixa)"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            helperText="Ex.: 5 para acrescentar, -2 para dar baixa por perda."
            required
          />
          <TextField label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} required />
          <Button variant="contained" onClick={submit} disabled={mutation.isPending}>
            {mutation.isPending ? "Registrando…" : "Registrar ajuste"}
          </Button>
        </Stack>
      </Paper>
    </Page>
  );
}

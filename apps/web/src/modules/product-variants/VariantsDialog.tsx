// apps/web/src/modules/product-variants/VariantsDialog.tsx
// Gestão de eixos (Cor, Tamanho) e variantes (combinações) de um produto com
// trackingType VARIANT/NONE, incluindo ajuste de estoque por variante.
import { useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  MenuItem,
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
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import TuneIcon from "@mui/icons-material/Tune";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { productVariantsApi } from "./api";
import { QueryState, errorMessage } from "../../shared/ui/PageLayout";
import { useToast } from "../../shared/ui/Toast";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { money, qty } from "../../shared/ui/format";

function AxesSection({ productId }: { productId: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const axes = useQuery({ queryKey: ["variant-axes", productId], queryFn: () => productVariantsApi.listAxes(productId) });
  const [newAxisName, setNewAxisName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [axisToDelete, setAxisToDelete] = useState<{ id: string; name: string; variantCount: number } | null>(null);

  const create = useMutation({
    mutationFn: (name: string) => productVariantsApi.createAxis(productId, name),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["variant-axes", productId] });
      setNewAxisName("");
      toast.success("Eixo criado.");
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (axisId: string) => productVariantsApi.removeAxis(axisId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["variant-axes", productId] });
      toast.success("Eixo removido.");
      setAxisToDelete(null);
    },
    onError: (e) => {
      toast.error(errorMessage(e));
      setAxisToDelete(null);
    },
  });

  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2">Eixos (Cor, Tamanho, …)</Typography>
      {error && <Alert severity="error">{error}</Alert>}
      <Stack direction="row" spacing={1}>
        <TextField size="small" label="Nome do eixo" value={newAxisName} onChange={(e) => setNewAxisName(e.target.value)} />
        <Button
          size="small"
          variant="outlined"
          startIcon={<AddIcon />}
          disabled={create.isPending}
          onClick={() => {
            setError(null);
            if (!newAxisName.trim()) return setError("Informe o nome do eixo.");
            create.mutate(newAxisName.trim());
          }}
        >
          Adicionar
        </Button>
      </Stack>
      <QueryState query={axes} isEmpty={(d) => d.length === 0} emptyMessage="Nenhum eixo cadastrado ainda.">
        {(data) => (
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {data.map((axis) => (
              <Stack key={axis.id} direction="row" alignItems="center" spacing={0.5} sx={{ border: 1, borderColor: "divider", borderRadius: 1, px: 1 }}>
                <Typography variant="body2">
                  {axis.name} ({axis._count.variants})
                </Typography>
                <Tooltip title="Remover eixo">
                  <span>
                    <IconButton
                      size="small"
                      aria-label="Remover eixo"
                      onClick={() => setAxisToDelete({ id: axis.id, name: axis.name, variantCount: axis._count.variants })}
                      disabled={remove.isPending}
                    >
                      <DeleteIcon fontSize="inherit" />
                    </IconButton>
                  </span>
                </Tooltip>
              </Stack>
            ))}
          </Stack>
        )}
      </QueryState>
      <ConfirmDialog
        open={axisToDelete !== null}
        title="Remover eixo"
        message={`Remover o eixo "${axisToDelete?.name}"? ${
          axisToDelete && axisToDelete.variantCount > 0
            ? `Isso afeta ${axisToDelete.variantCount} variante(s) associada(s) a este eixo.`
            : "Esta ação não pode ser desfeita."
        }`}
        confirmLabel="Remover eixo"
        busy={remove.isPending}
        onConfirm={() => axisToDelete && remove.mutate(axisToDelete.id)}
        onClose={() => setAxisToDelete(null)}
      />
    </Stack>
  );
}

function VariantsSection({ productId }: { productId: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const axes = useQuery({ queryKey: ["variant-axes", productId], queryFn: () => productVariantsApi.listAxes(productId) });
  const variants = useQuery({ queryKey: ["variants", productId], queryFn: () => productVariantsApi.listVariants(productId) });
  const [axisId, setAxisId] = useState("");
  const [axisValue, setAxisValue] = useState("");
  const [barcode, setBarcode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState<{ id: string; label: string } | null>(null);
  const [adjustDelta, setAdjustDelta] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustError, setAdjustError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => productVariantsApi.createVariant(productId, { axisId, axisValue: axisValue.trim(), barcode: barcode.trim() || null }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["variants", productId] });
      setAxisValue("");
      setBarcode("");
      toast.success("Variante criada.");
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => productVariantsApi.removeVariant(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["variants", productId] });
      toast.success("Variante removida.");
      setToDelete(null);
    },
    onError: (e) => {
      toast.error(errorMessage(e));
      setToDelete(null);
    },
  });
  const adjust = useMutation({
    mutationFn: () => productVariantsApi.adjustStock(adjusting!.id, { quantityDelta: Number(adjustDelta), reasonCode: adjustReason.trim() }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["variants", productId] });
      toast.success("Estoque da variante ajustado.");
      setAdjusting(null);
      setAdjustDelta("");
      setAdjustReason("");
    },
    onError: (e) => setAdjustError(errorMessage(e)),
  });

  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2">Variantes (combinações)</Typography>
      {error && <Alert severity="error">{error}</Alert>}
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <TextField size="small" select label="Eixo" value={axisId} onChange={(e) => setAxisId(e.target.value)} sx={{ minWidth: 160 }}>
          {(axes.data ?? []).map((a) => (
            <MenuItem key={a.id} value={a.id}>
              {a.name}
            </MenuItem>
          ))}
        </TextField>
        <TextField size="small" label="Valor (ex.: Azul/G)" value={axisValue} onChange={(e) => setAxisValue(e.target.value)} />
        <TextField size="small" label="Código de barras" value={barcode} onChange={(e) => setBarcode(e.target.value)} />
        <Button
          size="small"
          variant="outlined"
          startIcon={<AddIcon />}
          disabled={create.isPending}
          onClick={() => {
            setError(null);
            if (!axisId) return setError("Selecione um eixo.");
            if (!axisValue.trim()) return setError("Informe o valor da variante.");
            create.mutate();
          }}
        >
          Adicionar
        </Button>
      </Stack>
      <QueryState query={variants} isEmpty={(d) => d.length === 0} emptyMessage="Nenhuma variante cadastrada ainda.">
        {(data) => (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Eixo</TableCell>
                  <TableCell>Valor</TableCell>
                  <TableCell>Código de barras</TableCell>
                  <TableCell align="right">Preço</TableCell>
                  <TableCell align="right">Estoque</TableCell>
                  <TableCell align="right">Ações</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.map((v) => (
                  <TableRow key={v.id} hover>
                    <TableCell>{v.axis.name}</TableCell>
                    <TableCell>{v.axisValue}</TableCell>
                    <TableCell>{v.barcode ?? "—"}</TableCell>
                    <TableCell align="right">{v.priceOverride ? money(v.priceOverride) : "—"}</TableCell>
                    <TableCell align="right">{qty(v.stockQuantity)}</TableCell>
                    <TableCell align="right">
                      <Tooltip title="Ajustar estoque">
                        <IconButton
                          size="small"
                          aria-label={`Ajustar estoque da variante ${v.axis.name}: ${v.axisValue}`}
                          onClick={() => setAdjusting({ id: v.id, label: `${v.axis.name}: ${v.axisValue}` })}
                        >
                          <TuneIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Remover">
                        <IconButton
                          size="small"
                          aria-label={`Remover variante ${v.axis.name}: ${v.axisValue}`}
                          onClick={() => setToDelete(v.id)}
                        >
                          <DeleteIcon fontSize="small" />
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
      <ConfirmDialog
        open={toDelete !== null}
        title="Remover variante"
        message="Remover esta variante? Só é possível se não houver estoque nem vendas registradas."
        confirmLabel="Remover"
        busy={remove.isPending}
        onConfirm={() => toDelete && remove.mutate(toDelete)}
        onClose={() => setToDelete(null)}
      />
      <Dialog open={adjusting !== null} onClose={() => setAdjusting(null)} fullWidth maxWidth="xs">
        <DialogTitle>Ajustar estoque — {adjusting?.label}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {adjustError && <Alert severity="error">{adjustError}</Alert>}
            <TextField
              label="Quantidade (+ entrada / − baixa)"
              value={adjustDelta}
              onChange={(e) => setAdjustDelta(e.target.value)}
              autoFocus
            />
            <TextField label="Motivo" value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAdjusting(null)} disabled={adjust.isPending}>
            Cancelar
          </Button>
          <Button
            variant="contained"
            disabled={adjust.isPending}
            onClick={() => {
              setAdjustError(null);
              const delta = Number(adjustDelta);
              if (!delta) return setAdjustError("Informe uma quantidade diferente de zero.");
              if (adjustReason.trim().length < 2) return setAdjustError("Informe o motivo do ajuste.");
              adjust.mutate();
            }}
          >
            {adjust.isPending ? "Ajustando…" : "Ajustar"}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

export function VariantsDialog({ productId, productName, onClose }: { productId: string; productName: string; onClose: () => void }) {
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Grade / variantes — {productName}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <AxesSection productId={productId} />
          <Divider />
          <VariantsSection productId={productId} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Fechar</Button>
      </DialogActions>
    </Dialog>
  );
}

// apps/web/src/modules/recipes/ProductionBatchPage.tsx
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 4.4 (Padaria/Confeitaria) — produção
// diária baixa insumos proporcionalmente NO MOMENTO DA PRODUÇÃO (não da venda), e
// controle de perdas/quebras via `StockMovement` tipo `LOSS`, "crítico para a
// margem real". Também expõe o relatório gerencial de % de perda sobre produção
// (pesquisa de mercado: perda operacional saudável < 5%-6% em padarias/confeitarias).
import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  Tab,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BATCH_STATUS, productionBatchesApi, recipesApi, type Recipe } from "./api";
import { Page, PageHeader, QueryState, errorMessage } from "../../shared/ui/PageLayout";
import { ProductPicker } from "../../shared/lookups";
import type { ProductListItem } from "../registrations/api";
import { useToast } from "../../shared/ui/Toast";
import { formatDateTime, parseDecimal, qty } from "../../shared/ui/format";
import { ApiError } from "../../api/client";

function IngredientsPreview({ recipe, quantityProduced }: { recipe: Recipe; quantityProduced: number }) {
  const yieldQty = Number(recipe.yieldQuantity);
  if (!yieldQty || quantityProduced <= 0) return null;
  const ratio = quantityProduced / yieldQty;
  return (
    <TableContainer component={Paper} variant="outlined" sx={{ mt: 2 }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Insumo</TableCell>
            <TableCell align="right">Qtd. a baixar</TableCell>
            <TableCell align="right">Estoque atual</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {recipe.items.map((item) => {
            const required = Number(item.quantityPerYield) * ratio;
            const available = item.ingredient ? Number(item.ingredient.stockQuantity) : null;
            const insufficient = available !== null && available < required;
            return (
              <TableRow key={item.id} sx={insufficient ? { bgcolor: "error.light" } : undefined}>
                <TableCell>{item.ingredient ? `${item.ingredient.name} (${item.ingredient.sku})` : item.ingredientId}</TableCell>
                <TableCell align="right">{qty(required)}</TableCell>
                <TableCell align="right">{available !== null ? qty(available) : "—"}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function RegisterBatchTab() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [product, setProduct] = useState<ProductListItem | null>(null);
  const [quantityProduced, setQuantityProduced] = useState("");
  const [quantityLost, setQuantityLost] = useState("");
  const [lossReasonCode, setLossReasonCode] = useState("");

  const recipeQuery = useQuery({
    queryKey: ["recipe", product?.id],
    queryFn: () => recipesApi.getByProduct(product!.id),
    enabled: product !== null,
    retry: false,
  });
  const recipeNotFound = recipeQuery.isError && recipeQuery.error instanceof ApiError && recipeQuery.error.status === 404;

  const historyQuery = useQuery({
    queryKey: ["production-batches", product?.id],
    queryFn: () => productionBatchesApi.list(product?.id),
    enabled: product !== null,
  });

  const mutation = useMutation({
    mutationFn: () => {
      if (!product) throw new Error("Selecione o produto final.");
      const produced = parseDecimal(quantityProduced);
      if (!produced || produced <= 0) throw new Error("Informe a quantidade produzida.");
      const lost = quantityLost.trim() ? parseDecimal(quantityLost) : 0;
      if (lost === null || lost < 0) throw new Error("Quantidade perdida inválida.");
      if (lost > 0 && !lossReasonCode.trim()) throw new Error("Informe o motivo da perda/quebra.");
      return productionBatchesApi.produce({
        finishedProductId: product.id,
        quantityProduced: produced,
        quantityLost: lost || undefined,
        lossReasonCode: lost > 0 ? lossReasonCode.trim() : undefined,
      });
    },
    onSuccess: () => {
      toast.success("Fornada registrada. Insumos baixados e estoque do produto final atualizado.");
      setQuantityProduced("");
      setQuantityLost("");
      setLossReasonCode("");
      void queryClient.invalidateQueries({ queryKey: ["production-batches", product?.id] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const producedNumber = parseDecimal(quantityProduced) ?? 0;

  return (
    <Box>
      <Paper sx={{ p: 2, mb: 2 }}>
        <ProductPicker value={product?.id ?? null} onChange={setProduct} label="Produto final a produzir" />

        {product && recipeNotFound && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            Este produto não possui ficha técnica. Cadastre-a na tela "Fichas técnicas" antes de registrar produção.
          </Alert>
        )}

        {product && recipeQuery.data && (
          <>
            <Box sx={{ display: "flex", gap: 2, mt: 2, flexWrap: "wrap" }}>
              <TextField label="Quantidade produzida" value={quantityProduced} onChange={(e) => setQuantityProduced(e.target.value)} sx={{ width: 220 }} />
              <TextField label="Quantidade perdida (opcional)" value={quantityLost} onChange={(e) => setQuantityLost(e.target.value)} sx={{ width: 220 }} />
              <TextField label="Motivo da perda" value={lossReasonCode} onChange={(e) => setLossReasonCode(e.target.value)} sx={{ flex: 1, minWidth: 220 }} disabled={!quantityLost.trim()} />
            </Box>

            {producedNumber > 0 && <IngredientsPreview recipe={recipeQuery.data} quantityProduced={producedNumber} />}

            <Box sx={{ mt: 2, display: "flex", justifyContent: "flex-end" }}>
              <Button variant="contained" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
                Confirmar produção
              </Button>
            </Box>
          </>
        )}
      </Paper>

      {product && (
        <>
          <Typography variant="subtitle1" sx={{ mb: 1 }}>
            Histórico de fornadas
          </Typography>
          <QueryState query={historyQuery} isEmpty={(d) => d.length === 0} emptyMessage="Nenhuma fornada registrada para este produto.">
            {(rows) => (
              <TableContainer component={Paper}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Data</TableCell>
                      <TableCell align="right">Produzido</TableCell>
                      <TableCell align="right">Perdido</TableCell>
                      <TableCell>Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.map((batch) => (
                      <TableRow key={batch.id} hover>
                        <TableCell>{formatDateTime(batch.producedAt)}</TableCell>
                        <TableCell align="right">{qty(batch.quantityProduced)}</TableCell>
                        <TableCell align="right">{qty(batch.quantityLost)}</TableCell>
                        <TableCell>
                          <Chip size="small" label={BATCH_STATUS[batch.status].label} color={BATCH_STATUS[batch.status].color} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </QueryState>
        </>
      )}
    </Box>
  );
}

function LossReportTab() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const query = useQuery({
    queryKey: ["production-loss-report", from, to],
    queryFn: () => productionBatchesApi.lossReport(from || undefined, to || undefined),
  });

  return (
    <Box>
      <Paper sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
          <TextField type="date" label="De" value={from} onChange={(e) => setFrom(e.target.value)} InputLabelProps={{ shrink: true }} />
          <TextField type="date" label="Até" value={to} onChange={(e) => setTo(e.target.value)} InputLabelProps={{ shrink: true }} />
        </Box>
      </Paper>
      <Alert severity="info" sx={{ mb: 2 }}>
        Referência de mercado: perda operacional saudável em padarias/confeitarias fica abaixo de 5%-6% do total produzido.
      </Alert>
      <QueryState query={query} isEmpty={(d) => d.length === 0} emptyMessage="Nenhuma fornada registrada no período.">
        {(rows) => (
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Produto</TableCell>
                  <TableCell align="right">Fornadas</TableCell>
                  <TableCell align="right">Total produzido</TableCell>
                  <TableCell align="right">Total perdido</TableCell>
                  <TableCell align="right">% de perda</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.productId} hover>
                    <TableCell>
                      {row.productName} ({row.sku})
                    </TableCell>
                    <TableCell align="right">{row.batchCount}</TableCell>
                    <TableCell align="right">{qty(row.totalProduced)}</TableCell>
                    <TableCell align="right">{qty(row.totalLost)}</TableCell>
                    <TableCell align="right">
                      <Chip
                        size="small"
                        label={`${row.lossPercentage.toFixed(1)}%`}
                        color={row.lossPercentage > 6 ? "error" : row.lossPercentage > 3 ? "warning" : "success"}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </QueryState>
    </Box>
  );
}

export function ProductionBatchPage() {
  const [tab, setTab] = useState<"register" | "loss-report">("register");
  return (
    <Page>
      <PageHeader title="Produção diária" subtitle="Registre fornadas, acompanhe a baixa de insumos e as perdas/quebras (Capítulo 4.4 — margem real)." />
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab value="register" label="Registrar produção" />
        <Tab value="loss-report" label="Relatório de perdas" />
      </Tabs>
      {tab === "register" ? <RegisterBatchTab /> : <LossReportTab />}
    </Page>
  );
}

// apps/web/src/modules/stock/StockMovementsPage.tsx
// Histórico de StockMovement (a API limita a 200 mais recentes, sem paginação).
import { useMemo } from "react";
import { Box, Chip, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { MOVEMENT_LABEL, stockApi, type StockMovementType } from "./api";
import { Page, PageHeader, QueryState } from "../../shared/ui/PageLayout";
import { ProductPicker, useProductsLookup } from "../../shared/lookups";
import { formatDateTime, qty, toNumber } from "../../shared/ui/format";

export function StockMovementsPage() {
  const [params, setParams] = useSearchParams();
  const productId = params.get("productId");
  const type = params.get("type") ?? "";
  const products = useProductsLookup();
  const productNames = useMemo(() => new Map((products.data ?? []).map((p) => [p.id, p.name])), [products.data]);

  const query = useQuery({
    queryKey: ["stock-movements", productId, type],
    queryFn: () => stockApi.movements({ productId: productId ?? undefined, type: type || undefined }),
  });

  function update(key: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  return (
    <Page>
      <PageHeader title="Movimentações de estoque" subtitle="Até 200 movimentações mais recentes." />
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mb: 2 }}>
        <Box sx={{ flex: 2 }}>
          <ProductPicker value={productId} onChange={(p) => update("productId", p?.id ?? null)} label="Filtrar por produto" />
        </Box>
        <TextField select label="Tipo" value={type} onChange={(e) => update("type", e.target.value || null)} sx={{ flex: 1 }}>
          <MenuItem value="">Todos</MenuItem>
          {(Object.keys(MOVEMENT_LABEL) as StockMovementType[]).map((t) => (
            <MenuItem key={t} value={t}>
              {MOVEMENT_LABEL[t]}
            </MenuItem>
          ))}
        </TextField>
      </Stack>
      <QueryState query={query} isEmpty={(d) => d.length === 0} emptyMessage="Nenhuma movimentação encontrada para o filtro.">
        {(rows) => (
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Data</TableCell>
                  <TableCell>Produto</TableCell>
                  <TableCell>Tipo</TableCell>
                  <TableCell align="right">Quantidade</TableCell>
                  <TableCell>Motivo</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((m) => (
                  <TableRow key={m.id} hover>
                    <TableCell>{formatDateTime(m.createdAt)}</TableCell>
                    <TableCell>{productNames.get(m.productId) ?? m.productId.slice(0, 8)}</TableCell>
                    <TableCell>
                      <Chip size="small" label={MOVEMENT_LABEL[m.type] ?? m.type} variant="outlined" />
                    </TableCell>
                    <TableCell align="right" sx={{ color: toNumber(m.quantity) < 0 ? "error.main" : "success.main" }}>
                      {toNumber(m.quantity) > 0 ? "+" : ""}
                      {qty(m.quantity)}
                    </TableCell>
                    <TableCell>{m.reasonCode ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </QueryState>
    </Page>
  );
}

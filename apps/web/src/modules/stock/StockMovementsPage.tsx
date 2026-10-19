// apps/web/src/modules/stock/StockMovementsPage.tsx
// Histórico de StockMovement, paginado (carregamento incremental).
import { useMemo, useState } from "react";
import { Box, Button, Chip, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { MOVEMENT_LABEL, stockApi, type StockMovementType } from "./api";
import { Page, PageHeader, QueryState } from "../../shared/ui/PageLayout";
import { ProductPicker, useProductsLookup } from "../../shared/lookups";
import { formatDateTime, qty, toNumber } from "../../shared/ui/format";

const PAGE_SIZE = 50;

export function StockMovementsPage() {
  const [params, setParams] = useSearchParams();
  const productId = params.get("productId");
  const type = params.get("type") ?? "";
  const [loadedPages, setLoadedPages] = useState(1);
  const products = useProductsLookup();
  const productNames = useMemo(() => new Map((products.data ?? []).map((p) => [p.id, p.name])), [products.data]);

  const query = useQuery({
    queryKey: ["stock-movements", productId, type, loadedPages],
    queryFn: () =>
      stockApi.movements({ productId: productId ?? undefined, type: type || undefined, page: 1, pageSize: PAGE_SIZE * loadedPages }),
  });

  const rows = query.data?.data ?? [];
  const total = query.data?.meta?.total ?? rows.length;
  const hasMore = rows.length < total;

  function update(key: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
    setLoadedPages(1);
  }

  return (
    <Page>
      <PageHeader title="Movimentações de estoque" subtitle={`Exibindo ${rows.length} de ${total} movimentações.`} />
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
      <QueryState query={query} isEmpty={(d) => d.data.length === 0} emptyMessage="Nenhuma movimentação encontrada para o filtro.">
        {() => (
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
      {hasMore && (
        <Stack direction="row" justifyContent="center" sx={{ mt: 2 }}>
          <Button onClick={() => setLoadedPages((p) => p + 1)} disabled={query.isFetching}>
            {query.isFetching ? "Carregando…" : `Carregar mais (${rows.length} de ${total})`}
          </Button>
        </Stack>
      )}
    </Page>
  );
}


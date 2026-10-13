// apps/web/src/modules/stock/StockPage.tsx
// Saldo de estoque por produto (stockQuantity vem de /products — fonte única de saldo).
import { useMemo, useState } from "react";
import {
  Alert,
  Button,
  Chip,
  InputAdornment,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import TuneIcon from "@mui/icons-material/Tune";
import HistoryIcon from "@mui/icons-material/History";
import { Link as RouterLink } from "react-router-dom";
import { Page, PageHeader, QueryState } from "../../shared/ui/PageLayout";
import { useProductsLookup } from "../../shared/lookups";
import { money, qty, toNumber } from "../../shared/ui/format";

export function StockPage() {
  const query = useProductsLookup();
  const [search, setSearch] = useState("");
  const [onlyLow, setOnlyLow] = useState(false);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (query.data ?? []).filter((p) => {
      if (onlyLow && toNumber(p.stockQuantity) > 0) return false;
      if (!term) return true;
      return p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term) || (p.barcode ?? "").includes(term);
    });
  }, [query.data, search, onlyLow]);

  const totalValue = useMemo(
    () => (query.data ?? []).reduce((sum, p) => sum + toNumber(p.stockQuantity) * toNumber(p.unitPrice), 0),
    [query.data],
  );

  return (
    <Page>
      <PageHeader
        title="Estoque"
        subtitle={query.data ? `${query.data.length} produto(s) ativo(s) · valor de venda em estoque: ${money(totalValue)}` : undefined}
        actions={
          <>
            <Button component={RouterLink} to="/estoque/movimentacoes" startIcon={<HistoryIcon />} variant="outlined">
              Movimentações
            </Button>
            <Button component={RouterLink} to="/estoque/ajuste" startIcon={<TuneIcon />} variant="contained">
              Ajuste manual
            </Button>
          </>
        }
      />
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mb: 2 }}>
        <TextField
          fullWidth
          size="small"
          label="Buscar por nome, SKU ou código de barras"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
        />
        <Chip
          label="Somente zerados/negativos"
          color={onlyLow ? "primary" : "default"}
          onClick={() => {
            setOnlyLow((v) => !v);
            setPage(0);
          }}
          sx={{ alignSelf: "center" }}
        />
      </Stack>
      <QueryState query={query} isEmpty={(d) => d.length === 0} emptyMessage="Nenhum produto cadastrado. Cadastre em Cadastros › Produtos.">
        {() =>
          filtered.length === 0 ? (
            <Alert severity="info">Nenhum produto corresponde ao filtro.</Alert>
          ) : (
            <Paper>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Produto</TableCell>
                      <TableCell>SKU</TableCell>
                      <TableCell>Rastreio</TableCell>
                      <TableCell align="right">Saldo</TableCell>
                      <TableCell align="right">Preço</TableCell>
                      <TableCell align="right">Ações</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filtered.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage).map((p) => {
                      const balance = toNumber(p.stockQuantity);
                      return (
                        <TableRow key={p.id} hover>
                          <TableCell>{p.name}</TableCell>
                          <TableCell>{p.sku}</TableCell>
                          <TableCell>{p.trackingType}</TableCell>
                          <TableCell align="right">
                            <Chip
                              size="small"
                              label={qty(balance)}
                              color={balance < 0 ? "error" : balance === 0 ? "warning" : "success"}
                              variant="outlined"
                            />
                          </TableCell>
                          <TableCell align="right">{money(p.unitPrice)}</TableCell>
                          <TableCell align="right">
                            <Button size="small" component={RouterLink} to={`/estoque/movimentacoes?productId=${p.id}`}>
                              Histórico
                            </Button>
                            <Button size="small" component={RouterLink} to={`/estoque/ajuste?productId=${p.id}`}>
                              Ajustar
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
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
    </Page>
  );
}

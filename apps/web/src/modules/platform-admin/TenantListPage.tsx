// apps/web/src/modules/platform-admin/TenantListPage.tsx
// Capítulo 13.2 — lista de todos os tenants da plataforma, com busca e filtro por
// status. Ponto de entrada para o detalhe (onde ficam suspensão/impersonation).
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Box, Chip, CircularProgress, MenuItem, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, TextField, Typography } from "@mui/material";
import { listTenants, TenantSummary } from "./platform-admin-ops.api";

const STATUS_COLOR: Record<TenantSummary["status"], "success" | "warning" | "error" | "default"> = {
  ACTIVE: "success",
  TRIAL: "default",
  PAST_DUE: "warning",
  SUSPENDED: "error",
  CANCELLED: "error",
};

const PAGE_SIZE = 50;

export function TenantListPage() {
  const navigate = useNavigate();
  const [tenants, setTenants] = useState<TenantSummary[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0); // MUI TablePagination é 0-indexed; backend é 1-indexed
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Volta para a primeira página sempre que o filtro muda — sem isso, uma busca
  // que reduz o total de resultados podia deixar o operador numa página vazia
  // "fantasma" além do novo total.
  useEffect(() => {
    setPage(0);
  }, [status, search]);

  useEffect(() => {
    setLoading(true);
    const handle = setTimeout(() => {
      listTenants({ status: status || undefined, search: search || undefined, page: page + 1, pageSize: PAGE_SIZE })
        .then((result) => {
          setTenants(result.items);
          setTotal(result.total);
        })
        .catch((err) => setError((err as Error).message))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(handle);
  }, [status, search, page]);

  return (
    <Box sx={{ p: 3, maxWidth: 1200, mx: "auto" }}>
      <Typography variant="h5" sx={{ mb: 1 }}>
        Tenants
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Todos os espaços (lojistas) cadastrados na plataforma — abra o detalhe para suspender/reativar ou iniciar uma sessão de suporte (impersonation).
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <Box sx={{ display: "flex", gap: 2, mb: 2, alignItems: "center" }}>
        <TextField
          label="Buscar (razão social, nome fantasia, slug)"
          size="small"
          value={search}
          onChange={(e) => setSearch(e.target.value.slice(0, 200))}
          sx={{ minWidth: 320 }}
        />
        <TextField select label="Status" size="small" value={status} onChange={(e) => setStatus(e.target.value)} sx={{ minWidth: 180 }}>
          <MenuItem value="">Todos</MenuItem>
          <MenuItem value="TRIAL">Trial</MenuItem>
          <MenuItem value="ACTIVE">Ativo</MenuItem>
          <MenuItem value="PAST_DUE">Inadimplente</MenuItem>
          <MenuItem value="SUSPENDED">Suspenso</MenuItem>
          <MenuItem value="CANCELLED">Cancelado</MenuItem>
        </TextField>
        {loading && <CircularProgress size={20} />}
      </Box>
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Nome fantasia</TableCell>
              <TableCell>Slug</TableCell>
              <TableCell>Tipo</TableCell>
              <TableCell>CNPJ</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Criado em</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(tenants ?? []).map((tenant) => (
              <TableRow key={tenant.id} hover sx={{ cursor: "pointer" }} onClick={() => navigate(`/platform-admin/tenants/${tenant.id}`)}>
                <TableCell>{tenant.tradeName}</TableCell>
                <TableCell>{tenant.slug}</TableCell>
                <TableCell>{tenant.tenantType}</TableCell>
                <TableCell>{tenant.cnpj ?? "—"}</TableCell>
                <TableCell><Chip size="small" color={STATUS_COLOR[tenant.status]} label={tenant.status} /></TableCell>
                <TableCell>{new Date(tenant.createdAt).toLocaleDateString("pt-BR")}</TableCell>
              </TableRow>
            ))}
            {/* GAP DE AUDITORIA FECHADO (Rodada 11): antes a tabela renderizava vazia
                (igual ao estado "nenhum tenant encontrado") durante o carregamento
                inicial/após mudar o filtro, levando o operador a concluir
                erroneamente que não havia tenants. */}
            {!loading && tenants && tenants.length === 0 && (
              <TableRow><TableCell colSpan={6}>Nenhum tenant encontrado.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
        <TablePagination
          component="div"
          count={total}
          page={page}
          onPageChange={(_, newPage) => setPage(newPage)}
          rowsPerPage={PAGE_SIZE}
          rowsPerPageOptions={[PAGE_SIZE]}
          labelRowsPerPage=""
        />
      </TableContainer>
    </Box>
  );
}

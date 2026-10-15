// apps/web/src/modules/platform-admin/TenantListPage.tsx
// Capítulo 13.2 — lista de todos os tenants da plataforma, com busca e filtro por
// status. Ponto de entrada para o detalhe (onde ficam suspensão/impersonation).
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Box, Chip, MenuItem, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from "@mui/material";
import { listTenants, TenantSummary } from "./platform-admin-ops.api";

const STATUS_COLOR: Record<TenantSummary["status"], "success" | "warning" | "error" | "default"> = {
  ACTIVE: "success",
  TRIAL: "default",
  PAST_DUE: "warning",
  SUSPENDED: "error",
  CANCELLED: "error",
};

export function TenantListPage() {
  const navigate = useNavigate();
  const [tenants, setTenants] = useState<TenantSummary[] | null>(null);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => {
      listTenants({ status: status || undefined, search: search || undefined })
        .then(setTenants)
        .catch((err) => setError((err as Error).message));
    }, 300);
    return () => clearTimeout(handle);
  }, [status, search]);

  return (
    <Box sx={{ p: 3, maxWidth: 1200, mx: "auto" }}>
      <Typography variant="h5" sx={{ mb: 1 }}>
        Tenants
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Todos os espaços (lojistas) cadastrados na plataforma — abra o detalhe para suspender/reativar ou iniciar uma sessão de suporte (impersonation).
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <Box sx={{ display: "flex", gap: 2, mb: 2 }}>
        <TextField label="Buscar (razão social, nome fantasia, slug)" size="small" value={search} onChange={(e) => setSearch(e.target.value)} sx={{ minWidth: 320 }} />
        <TextField select label="Status" size="small" value={status} onChange={(e) => setStatus(e.target.value)} sx={{ minWidth: 180 }}>
          <MenuItem value="">Todos</MenuItem>
          <MenuItem value="TRIAL">Trial</MenuItem>
          <MenuItem value="ACTIVE">Ativo</MenuItem>
          <MenuItem value="PAST_DUE">Inadimplente</MenuItem>
          <MenuItem value="SUSPENDED">Suspenso</MenuItem>
          <MenuItem value="CANCELLED">Cancelado</MenuItem>
        </TextField>
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
            {tenants && tenants.length === 0 && (
              <TableRow><TableCell colSpan={6}>Nenhum tenant encontrado.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

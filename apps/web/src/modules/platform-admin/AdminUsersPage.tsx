// apps/web/src/modules/platform-admin/AdminUsersPage.tsx
// Capítulo 14 — roster de admins de plataforma (SUPER_ADMIN/SUPPORT_AGENT/
// FINANCE_ANALYST) para auditoria de quem tem acesso ao painel.
// GAP DE AUDITORIA FECHADO (mega-audit rodada 8): `GET /platform-admin/admin-users`
// só era consumido indiretamente (filtro de responsável no audit log) — nenhuma
// tela listava o roster completo de admins de plataforma.
// NOTA DE ESCOPO: o backend hoje só expõe LEITURA deste recurso (não existem
// endpoints de criação/desativação/troca de senha de admin de plataforma — a
// conta inicial é provisionada via seed/migração direta no banco, Capítulo 14.1).
// Criar esse fluxo é uma frente de trabalho própria (convite por e-mail, 2FA
// obrigatório, etc.) e não deve ser simulado aqui com um CRUD que o backend não
// suporta de verdade.
import { useEffect, useState } from "react";
import { Alert, Box, Chip, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from "@mui/material";
import { listPlatformAdminUsers, PlatformAdminUserSummary } from "./platform-admin-ops.api";

export function AdminUsersPage() {
  const [admins, setAdmins] = useState<PlatformAdminUserSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listPlatformAdminUsers().then(setAdmins).catch((err) => setError((err as Error).message));
  }, []);

  return (
    <Box sx={{ p: 3, maxWidth: 1000, mx: "auto" }}>
      <Typography variant="h5" sx={{ mb: 1 }}>Administradores da plataforma</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Roster de contas com acesso ao painel de administração de plataforma. A criação/desativação de contas é
        feita por provisionamento direto (Capítulo 14.1) — esta tela é somente para auditoria de quem tem acesso.
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Nome</TableCell>
              <TableCell>E-mail</TableCell>
              <TableCell>Papel</TableCell>
              <TableCell>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(admins ?? []).map((a) => (
              <TableRow key={a.id}>
                <TableCell>{a.name}</TableCell>
                <TableCell>{a.email}</TableCell>
                <TableCell>{a.role}</TableCell>
                <TableCell><Chip size="small" color={a.active ? "success" : "default"} label={a.active ? "Ativo" : "Inativo"} /></TableCell>
              </TableRow>
            ))}
            {admins && admins.length === 0 && <TableRow><TableCell colSpan={4}>Nenhum administrador cadastrado.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

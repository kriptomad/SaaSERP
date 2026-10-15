// apps/web/src/modules/platform-admin/SecurityPage.tsx
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 14.4/14.5 — GAP DE AUDITORIA FECHADO: a
// allowlist de IP e as sessões ativas já existiam no backend, mas não tinham
// nenhuma tela para o próprio admin gerenciar (apenas checadas implicitamente).
// Cada admin só vê/gerencia a SUA PRÓPRIA conta (sessões e allowlist nunca são de
// outro admin, mesmo para SUPER_ADMIN).
import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import LogoutIcon from "@mui/icons-material/Logout";
import {
  ActiveSessionSummary,
  IpAllowlistEntry,
  createIpAllowlistEntry,
  deleteIpAllowlistEntry,
  fetchActiveSessions,
  fetchIpAllowlist,
  revokeActiveSession,
} from "./security.api";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR");
}

function SessionsSection() {
  const [sessions, setSessions] = useState<ActiveSessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setSessions(await fetchActiveSessions());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleRevoke(session: ActiveSessionSummary) {
    if (session.isCurrent && !window.confirm("Esta é a sua sessão atual. Encerrar vai desconectar você agora. Continuar?")) {
      return;
    }
    try {
      await revokeActiveSession(session.id);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Paper sx={{ p: 3, mb: 3 }}>
      <Typography variant="h6" gutterBottom>
        Sessões ativas
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Dispositivos/navegadores com uma sessão válida atualmente. Encerrar uma sessão a revoga imediatamente, mesmo que o token ainda não tenha expirado.
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {loading ? (
        <CircularProgress size={24} />
      ) : sessions.length === 0 ? (
        <Typography variant="body2" color="text.secondary">Nenhuma sessão ativa.</Typography>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>IP</TableCell>
              <TableCell>Navegador/Dispositivo</TableCell>
              <TableCell>Criada em</TableCell>
              <TableCell>Última atividade</TableCell>
              <TableCell align="right">Ação</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sessions.map((session) => (
              <TableRow key={session.id}>
                <TableCell>{session.ipAddress}</TableCell>
                <TableCell sx={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis" }}>{session.userAgent ?? "—"}</TableCell>
                <TableCell>{formatDate(session.createdAt)}</TableCell>
                <TableCell>{formatDate(session.lastSeenAt)}</TableCell>
                <TableCell align="right">
                  <Stack direction="row" spacing={1} justifyContent="flex-end" alignItems="center">
                    {session.isCurrent && <Chip size="small" color="success" label="Sessão atual" />}
                    <IconButton size="small" color="error" onClick={() => handleRevoke(session)} title="Encerrar sessão">
                      <LogoutIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Paper>
  );
}

function IpAllowlistSection() {
  const [entries, setEntries] = useState<IpAllowlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cidrRange, setCidrRange] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setEntries(await fetchIpAllowlist());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleAdd() {
    if (!cidrRange.trim() || !label.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await createIpAllowlistEntry(cidrRange.trim(), label.trim());
      setCidrRange("");
      setLabel("");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(entry: IpAllowlistEntry) {
    if (!window.confirm(`Remover a entrada "${entry.label}" (${entry.cidrRange})?`)) return;
    try {
      await deleteIpAllowlistEntry(entry.id);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Paper sx={{ p: 3 }}>
      <Typography variant="h6" gutterBottom>
        Allowlist de IP
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Opt-in: sem nenhuma entrada cadastrada, qualquer IP pode acessar sua conta normalmente. Ao cadastrar a primeira
        entrada, o acesso passa a ser restrito aos IPs/faixas listados abaixo — a checagem é feita em toda requisição,
        não apenas no login.
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <Stack direction="row" spacing={2} sx={{ mb: 2 }} alignItems="center">
        <TextField
          size="small"
          label="IP ou CIDR"
          placeholder="203.0.113.5 ou 203.0.113.0/24"
          value={cidrRange}
          onChange={(e) => setCidrRange(e.target.value)}
        />
        <TextField size="small" label="Rótulo" placeholder="Escritório SP" value={label} onChange={(e) => setLabel(e.target.value)} />
        <Button variant="contained" onClick={handleAdd} disabled={saving || !cidrRange.trim() || !label.trim()}>
          Adicionar
        </Button>
      </Stack>
      <Divider sx={{ mb: 2 }} />
      {loading ? (
        <CircularProgress size={24} />
      ) : entries.length === 0 ? (
        <Typography variant="body2" color="text.secondary">Nenhuma entrada cadastrada — acesso liberado de qualquer IP.</Typography>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Faixa (CIDR)</TableCell>
              <TableCell>Rótulo</TableCell>
              <TableCell>Criada em</TableCell>
              <TableCell align="right">Ação</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell>{entry.cidrRange}</TableCell>
                <TableCell>{entry.label}</TableCell>
                <TableCell>{formatDate(entry.createdAt)}</TableCell>
                <TableCell align="right">
                  <IconButton size="small" color="error" onClick={() => handleDelete(entry)} title="Remover">
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Paper>
  );
}

export function SecurityPage() {
  return (
    <Box sx={{ p: 3, maxWidth: 1000 }}>
      <Typography variant="h5" gutterBottom>
        Segurança
      </Typography>
      <SessionsSection />
      <IpAllowlistSection />
    </Box>
  );
}

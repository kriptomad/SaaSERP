// apps/web/src/modules/platform-admin/SupportTicketsAdminPage.tsx
// Capítulo 15.3 — fila de chamados de suporte abertos pelos tenants (helpdesk do
// dono do SaaS): atribuição a um admin de plataforma, troca de status/prioridade e
// thread de mensagens.
// GAP DE AUDITORIA FECHADO (mega-audit rodada 8): o CRUD completo já existia no
// backend (`GET/PATCH /platform-admin/support-tickets`, mensagens), mas o painel
// de plataforma só tinha uma tela de suporte do LADO DO TENANT
// (`modules/support-tickets/SupportTicketsPage.tsx`) — nenhuma fila do lado do
// dono do SaaS para atender esses chamados.
import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { usePlatformAdminAuth } from "./PlatformAdminAuthContext";
import {
  listSupportTickets,
  getSupportTicket,
  updateSupportTicket,
  addSupportTicketMessage,
  SupportTicketSummary,
} from "./platform-admin-ops.api";

const STATUS_LABELS: Record<SupportTicketSummary["status"], string> = {
  OPEN: "Aberto",
  IN_PROGRESS: "Em andamento",
  WAITING_CUSTOMER: "Aguardando cliente",
  RESOLVED: "Resolvido",
  CLOSED: "Fechado",
};

const PRIORITY_COLORS: Record<SupportTicketSummary["priority"], "default" | "info" | "warning" | "error"> = {
  LOW: "default",
  NORMAL: "info",
  HIGH: "warning",
  URGENT: "error",
};

function TicketDialog({ ticketId, onClose, onUpdated }: { ticketId: string; onClose: () => void; onUpdated: (t: SupportTicketSummary) => void }) {
  const { admin } = usePlatformAdminAuth();
  const [ticket, setTicket] = useState<SupportTicketSummary | null>(null);
  const [reply, setReply] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    try {
      setTicket(await getSupportTicket(ticketId));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId]);

  async function handleStatusChange(status: SupportTicketSummary["status"]) {
    if (!ticket) return;
    setSaving(true);
    try {
      const updated = await updateSupportTicket(ticket.id, { status });
      setTicket(updated);
      onUpdated(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handlePriorityChange(priority: SupportTicketSummary["priority"]) {
    if (!ticket) return;
    setSaving(true);
    try {
      const updated = await updateSupportTicket(ticket.id, { priority });
      setTicket(updated);
      onUpdated(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleAssignToMe() {
    if (!ticket || !admin) return;
    setSaving(true);
    try {
      const updated = await updateSupportTicket(ticket.id, { assignedToPlatformAdminUserId: admin.id });
      setTicket(updated);
      onUpdated(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSendReply() {
    if (!ticket || !reply.trim()) return;
    setSaving(true);
    try {
      await addSupportTicketMessage(ticket.id, reply.trim());
      setReply("");
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{ticket?.subject ?? "Carregando…"}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {ticket && (
          <Stack spacing={2}>
            <Stack direction="row" spacing={2}>
              <TextField select size="small" label="Status" value={ticket.status} disabled={saving} onChange={(e) => handleStatusChange(e.target.value as SupportTicketSummary["status"])} sx={{ minWidth: 180 }}>
                {Object.entries(STATUS_LABELS).map(([value, label]) => (
                  <MenuItem key={value} value={value}>{label}</MenuItem>
                ))}
              </TextField>
              <TextField select size="small" label="Prioridade" value={ticket.priority} disabled={saving} onChange={(e) => handlePriorityChange(e.target.value as SupportTicketSummary["priority"])} sx={{ minWidth: 140 }}>
                <MenuItem value="LOW">Baixa</MenuItem>
                <MenuItem value="NORMAL">Normal</MenuItem>
                <MenuItem value="HIGH">Alta</MenuItem>
                <MenuItem value="URGENT">Urgente</MenuItem>
              </TextField>
              {!ticket.assignedToPlatformAdminUserId && (
                <Button size="small" variant="outlined" disabled={saving} onClick={handleAssignToMe}>Atribuir a mim</Button>
              )}
            </Stack>
            <Typography variant="caption" color="text.secondary">
              Categoria: {ticket.category} • Aberto em {new Date(ticket.createdAt).toLocaleString("pt-BR")}
              {ticket.resolvedAt ? ` • Resolvido em ${new Date(ticket.resolvedAt).toLocaleString("pt-BR")}` : ""}
            </Typography>
            <Stack spacing={1} sx={{ maxHeight: 300, overflowY: "auto" }}>
              {(ticket.messages ?? []).map((m) => (
                <Paper key={m.id} variant="outlined" sx={{ p: 1.5, bgcolor: m.authorType === "PLATFORM_ADMIN" ? "action.hover" : "background.paper" }}>
                  <Typography variant="caption" color="text.secondary">
                    {m.authorType === "PLATFORM_ADMIN" ? "Suporte Filitech" : "Cliente"} • {new Date(m.createdAt).toLocaleString("pt-BR")}
                  </Typography>
                  <Typography variant="body2">{m.body}</Typography>
                </Paper>
              ))}
              {ticket.messages && ticket.messages.length === 0 && (
                <Typography variant="body2" color="text.secondary">Nenhuma mensagem ainda.</Typography>
              )}
            </Stack>
            <TextField
              fullWidth
              multiline
              minRows={2}
              label="Responder ao cliente"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              disabled={saving}
            />
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Fechar</Button>
        <Button variant="contained" disabled={saving || !reply.trim()} onClick={handleSendReply}>Enviar resposta</Button>
      </DialogActions>
    </Dialog>
  );
}

export function SupportTicketsAdminPage() {
  const [tickets, setTickets] = useState<SupportTicketSummary[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [openTicketId, setOpenTicketId] = useState<string | null>(null);

  async function reload() {
    try {
      setTickets(await listSupportTickets(statusFilter ? { status: statusFilter } : undefined));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  function applyUpdated(updated: SupportTicketSummary) {
    setTickets((prev) => prev?.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)) ?? null);
  }

  return (
    <Box sx={{ p: 3, maxWidth: 1200, mx: "auto" }}>
      <Typography variant="h5" sx={{ mb: 1 }}>Chamados de suporte</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Fila de chamados abertos pelos tenants. Atribua a um admin de plataforma, acompanhe prioridade/status e
        responda diretamente ao cliente.
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <TextField select size="small" label="Filtrar por status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} sx={{ mb: 2, minWidth: 220 }}>
        <MenuItem value="">Todos</MenuItem>
        {Object.entries(STATUS_LABELS).map(([value, label]) => (
          <MenuItem key={value} value={value}>{label}</MenuItem>
        ))}
      </TextField>
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Assunto</TableCell>
              <TableCell>Categoria</TableCell>
              <TableCell>Prioridade</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Aberto em</TableCell>
              <TableCell>Atribuído</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {(tickets ?? []).map((t) => (
              <TableRow key={t.id} hover>
                <TableCell>{t.subject}</TableCell>
                <TableCell>{t.category}</TableCell>
                <TableCell><Chip size="small" color={PRIORITY_COLORS[t.priority]} label={t.priority} /></TableCell>
                <TableCell>{STATUS_LABELS[t.status]}</TableCell>
                <TableCell>{new Date(t.createdAt).toLocaleString("pt-BR")}</TableCell>
                <TableCell>{t.assignedToPlatformAdminUserId ? "Sim" : "—"}</TableCell>
                <TableCell><Button size="small" onClick={() => setOpenTicketId(t.id)}>Abrir</Button></TableCell>
              </TableRow>
            ))}
            {tickets && tickets.length === 0 && <TableRow><TableCell colSpan={7}>Nenhum chamado encontrado.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </TableContainer>
      {openTicketId && (
        <TicketDialog ticketId={openTicketId} onClose={() => setOpenTicketId(null)} onUpdated={applyUpdated} />
      )}
    </Box>
  );
}

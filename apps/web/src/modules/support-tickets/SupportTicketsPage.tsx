// apps/web/src/modules/support-tickets/SupportTicketsPage.tsx
// Capítulo 15.3 — Helpdesk Interno Vinculado ao Tenant, lado lojista: abrir chamado,
// acompanhar status e conversar com o suporte sem depender de WhatsApp pessoal.
import { useState } from "react";
import {
  Alert,
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
import AddIcon from "@mui/icons-material/Add";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Page, PageHeader, QueryState, errorMessage } from "../../shared/ui/PageLayout";
import { formatDate } from "../../shared/ui/format";
import { uploadFileToStorage, resolveStorageDownloadUrl } from "../../shared/storage/upload";
import {
  supportTicketsApi,
  TICKET_CATEGORY_LABEL,
  TICKET_STATUS_LABEL,
  type SupportTicket,
  type TicketCategory,
  type TicketPriority,
  type TicketStatus,
} from "./api";

function statusColor(status: TicketStatus): "default" | "success" | "warning" | "info" | "error" {
  if (status === "RESOLVED" || status === "CLOSED") return "success";
  if (status === "WAITING_CUSTOMER") return "warning";
  if (status === "OPEN") return "info";
  return "default";
}

function NewTicketDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState<TicketCategory>("HOW_TO");
  const [priority, setPriority] = useState<TicketPriority>("NORMAL");
  const [body, setBody] = useState("");
  const [attachmentKeys, setAttachmentKeys] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => supportTicketsApi.create({ subject: subject.trim(), category, priority, body: body.trim(), attachmentUrls: attachmentKeys }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });

  async function handleAttachmentSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const storageKey = await uploadFileToStorage(file, "support-ticket-attachments");
      setAttachmentKeys((prev) => [...prev, storageKey]);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Abrir chamado de suporte</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="Assunto" value={subject} onChange={(e) => setSubject(e.target.value)} required autoFocus />
          <TextField select label="Categoria" value={category} onChange={(e) => setCategory(e.target.value as TicketCategory)}>
            {Object.entries(TICKET_CATEGORY_LABEL).map(([value, label]) => (
              <MenuItem key={value} value={value}>{label}</MenuItem>
            ))}
          </TextField>
          <TextField select label="Prioridade" value={priority} onChange={(e) => setPriority(e.target.value as TicketPriority)}>
            <MenuItem value="LOW">Baixa</MenuItem>
            <MenuItem value="NORMAL">Normal</MenuItem>
            <MenuItem value="HIGH">Alta</MenuItem>
            <MenuItem value="URGENT">Urgente (sistema fora do ar / venda travada)</MenuItem>
          </TextField>
          <TextField label="Descreva o problema" value={body} onChange={(e) => setBody(e.target.value)} required multiline minRows={4} />
          <Button component="label" variant="outlined" size="small" startIcon={<AttachFileIcon />} disabled={uploading}>
            {uploading ? "Enviando anexo…" : "Anexar foto/print"}
            <input type="file" hidden accept="image/jpeg,image/png,image/webp,application/pdf" onChange={handleAttachmentSelected} />
          </Button>
          {attachmentKeys.length > 0 && (
            <Typography variant="caption" color="text.secondary">
              {attachmentKeys.length} anexo(s) prontos para envio.
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={create.isPending}>Cancelar</Button>
        <Button
          variant="contained"
          disabled={create.isPending || uploading}
          onClick={() => {
            setError(null);
            if (!subject.trim() || !body.trim()) return setError("Assunto e descrição são obrigatórios.");
            create.mutate();
          }}
        >
          {create.isPending ? "Enviando…" : "Abrir chamado"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function TicketDetailDialog({ ticketId, onClose }: { ticketId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [reply, setReply] = useState("");
  const [attachmentKeys, setAttachmentKeys] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const query = useQuery({
    queryKey: ["support-tickets", ticketId],
    queryFn: () => supportTicketsApi.get(ticketId),
    staleTime: 30_000,
  });

  const sendReply = useMutation({
    mutationFn: () => supportTicketsApi.addMessage(ticketId, reply.trim(), attachmentKeys),
    onSuccess: () => {
      setReply("");
      setAttachmentKeys([]);
      void queryClient.invalidateQueries({ queryKey: ["support-tickets", ticketId] });
      void queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
    },
  });

  async function handleAttachmentSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const storageKey = await uploadFileToStorage(file, "support-ticket-attachments");
      setAttachmentKeys((prev) => [...prev, storageKey]);
    } finally {
      setUploading(false);
    }
  }

  async function handleOpenAttachment(storageKey: string) {
    const url = await resolveStorageDownloadUrl(storageKey);
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Chamado de suporte</DialogTitle>
      <DialogContent>
        <QueryState query={query}>
          {(ticket: SupportTicket) => (
            <Stack spacing={2}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="subtitle1">{ticket.subject}</Typography>
                <Chip size="small" color={statusColor(ticket.status)} label={TICKET_STATUS_LABEL[ticket.status]} />
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {TICKET_CATEGORY_LABEL[ticket.category]} · aberto em {formatDate(ticket.createdAt)}
              </Typography>
              <Stack spacing={1.5} sx={{ maxHeight: 320, overflowY: "auto" }}>
                {(ticket.messages ?? []).map((m) => (
                  <Paper
                    key={m.id}
                    variant="outlined"
                    sx={{
                      p: 1.5,
                      alignSelf: m.authorType === "TENANT_USER" ? "flex-end" : "flex-start",
                      bgcolor: m.authorType === "TENANT_USER" ? "action.selected" : "background.paper",
                      maxWidth: "85%",
                    }}
                  >
                    <Typography variant="caption" color="text.secondary">
                      {m.authorType === "TENANT_USER" ? "Você" : "Suporte Filitech"} · {formatDate(m.createdAt)}
                    </Typography>
                    <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>{m.body}</Typography>
                    {m.attachmentUrls.length > 0 && (
                      <Stack direction="row" spacing={1} sx={{ mt: 0.5, flexWrap: "wrap" }}>
                        {m.attachmentUrls.map((key, i) => (
                          <Button key={key} size="small" variant="text" startIcon={<AttachFileIcon fontSize="small" />} onClick={() => handleOpenAttachment(key)}>
                            Anexo {i + 1}
                          </Button>
                        ))}
                      </Stack>
                    )}
                  </Paper>
                ))}
              </Stack>
              {ticket.status !== "CLOSED" && (
                <Stack spacing={1}>
                  <Stack direction="row" spacing={1}>
                    <TextField
                      fullWidth
                      size="small"
                      placeholder="Escreva uma resposta…"
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                      multiline
                      minRows={2}
                    />
                    <Button variant="contained" disabled={!reply.trim() || sendReply.isPending} onClick={() => sendReply.mutate()}>
                      Enviar
                    </Button>
                  </Stack>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Button component="label" size="small" variant="outlined" startIcon={<AttachFileIcon />} disabled={uploading}>
                      {uploading ? "Enviando…" : "Anexar foto/print"}
                      <input type="file" hidden accept="image/jpeg,image/png,image/webp,application/pdf" onChange={handleAttachmentSelected} />
                    </Button>
                    {attachmentKeys.length > 0 && (
                      <Typography variant="caption" color="text.secondary">
                        {attachmentKeys.length} anexo(s) prontos para enviar com a resposta.
                      </Typography>
                    )}
                  </Stack>
                </Stack>
              )}
            </Stack>
          )}
        </QueryState>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Fechar</Button>
      </DialogActions>
    </Dialog>
  );
}

export function SupportTicketsPage() {
  const query = useQuery({ queryKey: ["support-tickets"], queryFn: () => supportTicketsApi.list(), staleTime: 30_000 });
  const [newOpen, setNewOpen] = useState(false);
  const [openTicketId, setOpenTicketId] = useState<string | null>(null);

  return (
    <Page>
      <PageHeader
        title="Suporte / Helpdesk"
        subtitle="Abra chamados para o time Filitech e acompanhe o andamento aqui — sem depender de WhatsApp pessoal do suporte."
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setNewOpen(true)}>
            Abrir chamado
          </Button>
        }
      />
      <QueryState query={query} isEmpty={(d) => d.length === 0} emptyMessage="Nenhum chamado aberto ainda.">
        {(data: SupportTicket[]) => (
          <Paper>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Assunto</TableCell>
                    <TableCell>Categoria</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Aberto em</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.map((t) => (
                    <TableRow key={t.id} hover sx={{ cursor: "pointer" }} onClick={() => setOpenTicketId(t.id)}>
                      <TableCell>{t.subject}</TableCell>
                      <TableCell>{TICKET_CATEGORY_LABEL[t.category]}</TableCell>
                      <TableCell><Chip size="small" color={statusColor(t.status)} label={TICKET_STATUS_LABEL[t.status]} /></TableCell>
                      <TableCell>{formatDate(t.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        )}
      </QueryState>
      {newOpen && <NewTicketDialog onClose={() => setNewOpen(false)} />}
      {openTicketId && <TicketDetailDialog ticketId={openTicketId} onClose={() => setOpenTicketId(null)} />}
    </Page>
  );
}

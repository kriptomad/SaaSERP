// apps/web/src/modules/pharmacy/PrescriptionRecordsPage.tsx
// Capítulo 4.5 — Farmácia/Drogaria. Registro e consulta de retenção de receita
// (Portaria 344/1998 — Lista B/Notificação de Receita Azul; RDC 1.000/2025 — SNCR).
import { useState } from "react";
import {
  Alert,
  Button,
  Chip,
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Page, PageHeader, QueryState, errorMessage } from "../../shared/ui/PageLayout";
import { useToast } from "../../shared/ui/Toast";
import { formatDateTime } from "../../shared/ui/format";
import { pharmacyApi, PRESCRIPTION_TYPE_LABEL, type PrescriptionRecordInput, type PrescriptionType } from "./api";

const PRESCRIPTION_TYPES: PrescriptionType[] = ["NOTIFICACAO_B_AZUL", "RECEITA_A_AMARELA", "RECEITA_ELETRONICA_SNCR"];

function RegisterForm() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<PrescriptionRecordInput>({
    saleItemId: "",
    prescriptionType: "NOTIFICACAO_B_AZUL",
    patientDocument: "",
    electronicPrescriptionNumber: "",
    retainedDocumentStorageKey: "",
  });
  const [formError, setFormError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (input: PrescriptionRecordInput) => pharmacyApi.createPrescriptionRecord(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["prescription-records"] });
      toast.success("Retenção de receita registrada.");
      setForm({ saleItemId: "", prescriptionType: "NOTIFICACAO_B_AZUL", patientDocument: "", electronicPrescriptionNumber: "", retainedDocumentStorageKey: "" });
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  function submit() {
    setFormError(null);
    if (!form.saleItemId.trim()) return setFormError("Informe o ID do item de venda (SaleItem) referente a este medicamento.");
    const cpfDigits = form.patientDocument.replace(/\D/g, "");
    if (cpfDigits.length !== 11) return setFormError("CPF do paciente é obrigatório e deve ter 11 dígitos (exigência SNGPC/RDC 1.000/2025).");
    mutation.mutate({
      ...form,
      patientDocument: cpfDigits,
      electronicPrescriptionNumber: form.electronicPrescriptionNumber?.trim() || undefined,
      retainedDocumentStorageKey: form.retainedDocumentStorageKey?.trim() || undefined,
    });
  }

  return (
    <Paper sx={{ p: 3, maxWidth: 640 }}>
      <Typography variant="subtitle1" sx={{ mb: 2 }}>
        Registrar retenção de receita
      </Typography>
      <Stack spacing={2}>
        {formError && <Alert severity="error">{formError}</Alert>}
        <TextField
          label="ID do item de venda (SaleItem)"
          value={form.saleItemId}
          onChange={(e) => setForm({ ...form, saleItemId: e.target.value })}
          helperText="O item precisa já existir — retenção é vinculada a uma venda concluída ou em finalização."
        />
        <TextField
          select
          label="Tipo de receituário"
          value={form.prescriptionType}
          onChange={(e) => setForm({ ...form, prescriptionType: e.target.value as PrescriptionType })}
        >
          {PRESCRIPTION_TYPES.map((t) => (
            <MenuItem key={t} value={t}>
              {PRESCRIPTION_TYPE_LABEL[t]}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label="CPF do paciente"
          value={form.patientDocument}
          onChange={(e) => setForm({ ...form, patientDocument: e.target.value })}
          helperText="Exigência regulatória a partir de 2026 (RDC 1.000/2025)."
        />
        <TextField
          label="Numeração da receita eletrônica (SNCR, se houver)"
          value={form.electronicPrescriptionNumber}
          onChange={(e) => setForm({ ...form, electronicPrescriptionNumber: e.target.value })}
        />
        <TextField
          label="Referência do documento digitalizado"
          value={form.retainedDocumentStorageKey}
          onChange={(e) => setForm({ ...form, retainedDocumentStorageKey: e.target.value })}
          helperText="Chave/URL do arquivo da receita física digitalizada, quando aplicável."
        />
        <Button variant="contained" onClick={submit} disabled={mutation.isPending}>
          {mutation.isPending ? "Registrando…" : "Registrar retenção"}
        </Button>
      </Stack>
    </Paper>
  );
}

function HistoryTable() {
  const [clientId, setClientId] = useState("");
  const [productId, setProductId] = useState("");
  const query = useQuery({
    queryKey: ["prescription-records", clientId, productId],
    queryFn: () => pharmacyApi.listPrescriptionRecords({ clientId: clientId || undefined, productId: productId || undefined }),
  });

  return (
    <Stack spacing={2}>
      <Paper sx={{ p: 2 }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
          <TextField label="Filtrar por ID do cliente" value={clientId} onChange={(e) => setClientId(e.target.value)} fullWidth />
          <TextField label="Filtrar por ID do produto" value={productId} onChange={(e) => setProductId(e.target.value)} fullWidth />
        </Stack>
      </Paper>
      <QueryState query={query} isEmpty={(d) => d.length === 0} emptyMessage="Nenhuma receita retida registrada para este filtro.">
        {(data) => (
          <Paper>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Data</TableCell>
                    <TableCell>Produto</TableCell>
                    <TableCell>Tipo</TableCell>
                    <TableCell>CPF paciente</TableCell>
                    <TableCell>Nº receita eletrônica</TableCell>
                    <TableCell>Validado por</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.map((r) => (
                    <TableRow key={r.id} hover>
                      <TableCell>{formatDateTime(r.createdAt)}</TableCell>
                      <TableCell>
                        {r.saleItem.product.name} ({r.saleItem.product.sku})
                      </TableCell>
                      <TableCell>
                        <Chip size="small" label={PRESCRIPTION_TYPE_LABEL[r.prescriptionType]} />
                      </TableCell>
                      <TableCell>{r.patientDocument}</TableCell>
                      <TableCell>{r.electronicPrescriptionNumber ?? "—"}</TableCell>
                      <TableCell>{r.validatedByUserName ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        )}
      </QueryState>
    </Stack>
  );
}

export function PrescriptionRecordsPage() {
  return (
    <Page>
      <PageHeader
        title="Retenção de Receita (SNGPC/SNCR)"
        subtitle="Registro e auditoria da retenção obrigatória de receita para medicamentos de Lista B/tarja preta — Portaria 344/1998 e RDC 1.000/2025."
      />
      <Stack spacing={3}>
        <RegisterForm />
        <HistoryTable />
      </Stack>
    </Page>
  );
}

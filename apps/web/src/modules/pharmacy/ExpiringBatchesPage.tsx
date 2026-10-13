// apps/web/src/modules/pharmacy/ExpiringBatchesPage.tsx
// Capítulo 4.5 — Farmácia/Drogaria. Relatório gerencial de validade a vencer
// (ProductBatch.expirationDate), com destaque visual de urgência. Reaproveita o
// mesmo model de lote usado pela baixa FEFO (Capítulo 6) apenas para leitura — não
// altera nenhuma lógica de dedução de estoque.
import { useState } from "react";
import {
  Alert,
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
import { useQuery } from "@tanstack/react-query";
import { Page, PageHeader, QueryState } from "../../shared/ui/PageLayout";
import { formatDate } from "../../shared/ui/format";
import { pharmacyApi, URGENCY_COLOR, URGENCY_LABEL } from "./api";

const DAYS_AHEAD_OPTIONS = [7, 15, 30, 60, 90];

export function ExpiringBatchesPage() {
  const [daysAhead, setDaysAhead] = useState(30);
  const query = useQuery({
    queryKey: ["pharmacy-expiring-batches", daysAhead],
    queryFn: () => pharmacyApi.listExpiringBatches(daysAhead),
  });

  return (
    <Page>
      <PageHeader
        title="Validade a Vencer"
        subtitle="Lotes por data de validade (FEFO) — priorize a dispensação dos itens mais urgentes para evitar perda de estoque."
      />
      <Stack spacing={2}>
        <Paper sx={{ p: 2 }}>
          <TextField
            select
            label="Janela de antecedência"
            value={daysAhead}
            onChange={(e) => setDaysAhead(Number(e.target.value))}
            sx={{ minWidth: 220 }}
          >
            {DAYS_AHEAD_OPTIONS.map((d) => (
              <MenuItem key={d} value={d}>
                Próximos {d} dias
              </MenuItem>
            ))}
          </TextField>
        </Paper>
        <QueryState query={query} isEmpty={(d) => d.length === 0} emptyMessage="Nenhum lote vencendo dentro da janela selecionada.">
          {(data) => {
            const expiredCount = data.filter((b) => b.urgency === "EXPIRED").length;
            const criticalCount = data.filter((b) => b.urgency === "CRITICAL").length;
            return (
              <Stack spacing={2}>
                {(expiredCount > 0 || criticalCount > 0) && (
                  <Alert severity="error">
                    {expiredCount > 0 && `${expiredCount} lote(s) já vencido(s). `}
                    {criticalCount > 0 && `${criticalCount} lote(s) vencendo em até 7 dias.`}
                  </Alert>
                )}
                <Paper>
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Urgência</TableCell>
                          <TableCell>Produto</TableCell>
                          <TableCell>Lote</TableCell>
                          <TableCell align="right">Quantidade</TableCell>
                          <TableCell>Validade</TableCell>
                          <TableCell align="right">Dias restantes</TableCell>
                          <TableCell>Retenção/Controlado</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {data.map((batch) => (
                          <TableRow key={batch.id} hover>
                            <TableCell>
                              <Chip size="small" color={URGENCY_COLOR[batch.urgency]} label={URGENCY_LABEL[batch.urgency]} />
                            </TableCell>
                            <TableCell>
                              <Typography variant="body2">{batch.productName}</Typography>
                              <Typography variant="caption" color="text.secondary">
                                {batch.productSku}
                              </Typography>
                            </TableCell>
                            <TableCell>{batch.batchNumber}</TableCell>
                            <TableCell align="right">{batch.quantity}</TableCell>
                            <TableCell>{formatDate(batch.expirationDate)}</TableCell>
                            <TableCell align="right">{batch.daysUntilExpiration}</TableCell>
                            <TableCell>
                              <Stack direction="row" spacing={0.5}>
                                {batch.requiresPrescriptionRetention && <Chip size="small" label="Retenção" />}
                                {batch.isControlledSubstance && <Chip size="small" label="Controlado" color="secondary" />}
                                {!batch.requiresPrescriptionRetention && !batch.isControlledSubstance && "—"}
                              </Stack>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Paper>
              </Stack>
            );
          }}
        </QueryState>
      </Stack>
    </Page>
  );
}

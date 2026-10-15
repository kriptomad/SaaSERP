// apps/web/src/modules/pharmacy/SngpcLedgerPage.tsx
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 4.5 — GAP DE AUDITORIA (rodada 3) fechado:
// antes desta página, `Product.isControlledSubstance` era só um rótulo visual (chip)
// em outras telas — não existia nenhum lugar onde o farmacêutico responsável tivesse
// o livro de escrituração (entradas/saídas/saldo) exigido para a prestação de contas
// periódica à ANVISA via Portal SNGPC. Consome GET /pharmacy/sngpc-ledger.
import { useMemo, useState } from "react";
import {
  Alert,
  Button,
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
import { formatDateTime } from "../../shared/ui/format";
import { pharmacyApi } from "./api";

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

const MOVEMENT_TYPE_LABEL: Record<string, string> = {
  PURCHASE_IN: "Entrada (compra)",
  SALE_OUT: "Saída (dispensação)",
  ADJUSTMENT: "Ajuste de inventário",
  LOSS: "Perda/quebra",
  RETURN: "Devolução",
  RECIPE_CONSUMPTION: "Consumo (ficha técnica)",
  PRODUCTION_CONSUMPTION: "Consumo (produção)",
};

function toCsv(ledger: NonNullable<ReturnType<typeof useLedgerData>["data"]>): string {
  const header = "Data,Produto,SKU,NCM,Tipo,Quantidade,Saldo após,Documento de origem,CPF do paciente\n";
  const rows = ledger.movements.map((m) =>
    [
      new Date(m.createdAt).toISOString(),
      m.productName,
      m.productSku,
      m.productNcm ?? "",
      MOVEMENT_TYPE_LABEL[m.movementType] ?? m.movementType,
      m.quantity,
      m.balanceAfter,
      m.documentReference ?? "",
      m.patientDocument ?? "",
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(","),
  );
  return header + rows.join("\n");
}

function useLedgerData(month: string, productId: string) {
  return useQuery({
    queryKey: ["pharmacy-sngpc-ledger", month, productId],
    queryFn: () => pharmacyApi.getSngpcLedger(month, productId || undefined),
  });
}

export function SngpcLedgerPage() {
  const [month, setMonth] = useState(currentMonth());
  const [productId, setProductId] = useState("");
  const query = useLedgerData(month, productId);

  const csvHref = useMemo(() => {
    if (!query.data) return null;
    const blob = new Blob([toCsv(query.data)], { type: "text/csv;charset=utf-8" });
    return URL.createObjectURL(blob);
  }, [query.data]);

  return (
    <Page>
      <PageHeader
        title="Livro de Escrituração SNGPC"
        subtitle="Entradas e saídas de substâncias controladas (RDC 1.000/2025), com saldo mensal — base para a prestação de contas periódica à ANVISA via Portal SNGPC."
      />
      <Alert severity="info" sx={{ mb: 2 }}>
        Este relatório reconstrói o livro a partir das movimentações reais de estoque do sistema. A transmissão em si à
        ANVISA é feita pelo Portal SNGPC (processo externo ao ERP); use o CSV exportado aqui como fonte dos dados.
      </Alert>
      <Paper sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ sm: "center" }}>
          <TextField
            label="Mês de referência"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            label="Filtrar por produto (ID — opcional)"
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            sx={{ minWidth: 260 }}
          />
          {csvHref && (
            <Button component="a" href={csvHref} download={`sngpc-${month}.csv`} variant="outlined">
              Exportar CSV
            </Button>
          )}
        </Stack>
      </Paper>
      <QueryState
        query={query}
        isEmpty={(d) => d.summary.length === 0}
        emptyMessage="Nenhuma substância controlada cadastrada (Product.isControlledSubstance) ou nenhuma movimentação no mês."
      >
        {(ledger) => (
          <Stack spacing={2}>
            <Paper>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Produto</TableCell>
                      <TableCell align="right">Saldo anterior</TableCell>
                      <TableCell align="right">Entradas</TableCell>
                      <TableCell align="right">Saídas</TableCell>
                      <TableCell align="right">Saldo atual</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {ledger.summary.map((row) => (
                      <TableRow key={row.productId} hover>
                        <TableCell>
                          <Typography variant="body2">{row.productName}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {row.productSku}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">{row.saldoAnterior}</TableCell>
                        <TableCell align="right">{row.entradas}</TableCell>
                        <TableCell align="right">{row.saidas}</TableCell>
                        <TableCell align="right">
                          <strong>{row.saldoAtual}</strong>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
            <Typography variant="h6">Movimentações do mês</Typography>
            <Paper>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Data</TableCell>
                      <TableCell>Produto</TableCell>
                      <TableCell>Tipo</TableCell>
                      <TableCell align="right">Quantidade</TableCell>
                      <TableCell align="right">Saldo após</TableCell>
                      <TableCell>Documento de origem</TableCell>
                      <TableCell>CPF do paciente</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {ledger.movements.map((m) => (
                      <TableRow key={m.id} hover>
                        <TableCell>{formatDateTime(m.createdAt)}</TableCell>
                        <TableCell>{m.productName}</TableCell>
                        <TableCell>{MOVEMENT_TYPE_LABEL[m.movementType] ?? m.movementType}</TableCell>
                        <TableCell align="right">{m.quantity}</TableCell>
                        <TableCell align="right">{m.balanceAfter}</TableCell>
                        <TableCell>{m.documentReference ?? "—"}</TableCell>
                        <TableCell>{m.patientDocument ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                    {ledger.movements.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7}>
                          <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                            Nenhuma movimentação de substância controlada neste mês.
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          </Stack>
        )}
      </QueryState>
    </Page>
  );
}

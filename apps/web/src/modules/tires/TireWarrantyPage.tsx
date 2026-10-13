// apps/web/src/modules/tires/TireWarrantyPage.tsx
// Capítulo 11.10 — Loja de Pneus: consulta de garantia de fabricante por lote ou
// por item de venda, e relatório de sugestões de rodízio por tempo decorrido
// desde a última venda de pneu (ver limitações documentadas em
// apps/api/src/modules/tires/tire-warranty.routes.ts — não há histórico de
// quilometragem na última troca nem vínculo direto Sale↔Vehicle no schema).
import { useState } from "react";
import {
  Alert,
  Button,
  Chip,
  Paper,
  Stack,
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQuery } from "@tanstack/react-query";
import { tireWarrantyApi, type TireWarrantyResult } from "./api";
import { Page, PageHeader, QueryState, errorMessage } from "../../shared/ui/PageLayout";
import { formatDateTime } from "../../shared/ui/format";

function WarrantyResultCard({ result }: { result: TireWarrantyResult }) {
  return (
    <Paper sx={{ p: 2 }}>
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="subtitle1">Lote {result.batchId}</Typography>
          <Chip
            size="small"
            label={result.stillUnderWarranty ? "Dentro da garantia" : "Fora da garantia"}
            color={result.stillUnderWarranty ? "success" : "error"}
          />
        </Stack>
        <Typography variant="body2">Recebido em: {formatDateTime(result.receivedAt)}</Typography>
        <Typography variant="body2">Garantia do fabricante: {result.manufacturerWarrantyMonths} meses</Typography>
        <Typography variant="body2">Expira em: {formatDateTime(result.warrantyExpiresAt)}</Typography>
      </Stack>
    </Paper>
  );
}

function CheckByBatchTab() {
  const [batchId, setBatchId] = useState("");
  const [result, setResult] = useState<TireWarrantyResult | null>(null);
  const check = useMutation({
    mutationFn: () => tireWarrantyApi.checkByBatch(batchId.trim()),
    onSuccess: (data) => setResult(data),
  });

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} alignItems="flex-start">
        <TextField label="ID do lote (ProductBatch)" value={batchId} onChange={(e) => setBatchId(e.target.value)} sx={{ minWidth: 320 }} />
        <Button variant="contained" disabled={!batchId.trim() || check.isPending} onClick={() => check.mutate()}>
          {check.isPending ? "Consultando…" : "Consultar"}
        </Button>
      </Stack>
      {check.isError && <Alert severity="error">{errorMessage(check.error)}</Alert>}
      {result && <WarrantyResultCard result={result} />}
    </Stack>
  );
}

function CheckBySaleItemTab() {
  const [saleItemId, setSaleItemId] = useState("");
  const [result, setResult] = useState<TireWarrantyResult | null>(null);
  const check = useMutation({
    mutationFn: () => tireWarrantyApi.checkBySaleItem(saleItemId.trim()),
    onSuccess: (data) => setResult(data),
  });

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        Cruza o item de venda com o lote de pneu consumido (FEFO) naquela venda. Se a mesma venda
        tiver dois itens do mesmo produto, o resultado reflete o lote mais antigo consumido — ver
        limitação documentada no backend.
      </Typography>
      <Stack direction="row" spacing={2} alignItems="flex-start">
        <TextField label="ID do item de venda (SaleItem)" value={saleItemId} onChange={(e) => setSaleItemId(e.target.value)} sx={{ minWidth: 320 }} />
        <Button variant="contained" disabled={!saleItemId.trim() || check.isPending} onClick={() => check.mutate()}>
          {check.isPending ? "Consultando…" : "Consultar"}
        </Button>
      </Stack>
      {check.isError && <Alert severity="error">{errorMessage(check.error)}</Alert>}
      {result && <WarrantyResultCard result={result} />}
    </Stack>
  );
}

function RotationSuggestionsTab() {
  const query = useQuery({ queryKey: ["tire-rotation-suggestions"], queryFn: () => tireWarrantyApi.rotationSuggestions() });
  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        Sugestão baseada no tempo decorrido desde a última venda de produto de categoria "Pneus"
        para o cliente dono do veículo (não há histórico de km na última troca no schema atual).
      </Typography>
      <QueryState query={query} isEmpty={(d) => d.length === 0} emptyMessage="Nenhum veículo com venda de pneu registrada.">
        {(data) => (
          <Paper>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Placa</TableCell>
                    <TableCell>Modelo</TableCell>
                    <TableCell>Proprietário</TableCell>
                    <TableCell align="right">KM atual</TableCell>
                    <TableCell>Última venda de pneu</TableCell>
                    <TableCell align="right">Meses decorridos</TableCell>
                    <TableCell>Sugestão</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.map((row) => (
                    <TableRow key={row.vehicleId} hover>
                      <TableCell>{row.licensePlate}</TableCell>
                      <TableCell>{row.model}</TableCell>
                      <TableCell>{row.owner.name}</TableCell>
                      <TableCell align="right">{row.mileageKm ?? "—"}</TableCell>
                      <TableCell>{row.lastTireSale ? formatDateTime(row.lastTireSale.soldAt) : "—"}</TableCell>
                      <TableCell align="right">{row.monthsSinceLastTireSale ?? "—"}</TableCell>
                      <TableCell>
                        {row.suggestsRotation ? <Chip size="small" color="warning" label="Sugerir rodízio" /> : <Chip size="small" label="Em dia" />}
                      </TableCell>
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

export function TireWarrantyPage() {
  const [tab, setTab] = useState(0);
  return (
    <Page>
      <PageHeader
        title="Garantia de Pneus"
        subtitle="Consulta de garantia de fabricante por lote/item de venda e sugestões de rodízio (Loja de Pneus)."
      />
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label="Garantia por lote" />
        <Tab label="Garantia por item de venda" />
        <Tab label="Sugestões de rodízio" />
      </Tabs>
      {tab === 0 && <CheckByBatchTab />}
      {tab === 1 && <CheckBySaleItemTab />}
      {tab === 2 && <RotationSuggestionsTab />}
    </Page>
  );
}

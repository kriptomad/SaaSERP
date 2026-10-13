// apps/web/src/modules/exchanges/ExchangesPage.tsx
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 11.4 (Loja de Roupas/Moda) / 11.7 (Loja de
// Calçados) — "fluxo de troca: reentrada automática no estoque da VARIANTE correta
// (não do produto genérico) e geração de crédito de loja ou nova venda vinculada à
// troca original, com rastreabilidade fiscal." Consome o novo
// product-exchanges.routes.ts (backend desta mesma rodada).
//
// Fluxo da tela: 1) caixa localiza a venda original pelo ID (recibo); 2) escolhe o
// item devolvido e a quantidade; 3) escolhe a resolução — crédito de loja direto, ou
// item novo (busca rápida de variante, Capítulo 11.4/11.7); 4) se sobrar diferença a
// favor da loja, o sistema mostra `amountDue` e instrui a fechar uma venda normal só
// com a diferença, depois vinculável via "Vincular venda da diferença".
import { useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Divider,
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
import { exchangesApi, EXCHANGE_REASON_LABEL, type ExchangeReasonCode, type ExchangeResolutionType, type VariantQuickSearchItem } from "./api";
import { Page, PageHeader, QueryState, errorMessage } from "../../shared/ui/PageLayout";
import { useToast } from "../../shared/ui/Toast";
import { money, qty, formatDateTime } from "../../shared/ui/format";

export function ExchangesPage() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [saleIdInput, setSaleIdInput] = useState("");
  const [searchedSaleId, setSearchedSaleId] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [returnedQuantity, setReturnedQuantity] = useState("1");
  const [reasonCode, setReasonCode] = useState<ExchangeReasonCode>("WRONG_SIZE");
  const [resolutionType, setResolutionType] = useState<ExchangeResolutionType>("STORE_CREDIT");
  const [newVariantQuery, setNewVariantQuery] = useState("");
  const [newVariant, setNewVariant] = useState<VariantQuickSearchItem | null>(null);
  const [newQuantity, setNewQuantity] = useState("1");
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<{ amountDue: number } | null>(null);

  const saleQuery = useQuery({
    queryKey: ["sales", searchedSaleId],
    queryFn: () => exchangesApi.lookupSale(searchedSaleId!),
    enabled: Boolean(searchedSaleId),
  });

  const variantSearch = useQuery({
    queryKey: ["product-variants", "quick-search", newVariantQuery],
    queryFn: () => exchangesApi.quickSearchVariants(newVariantQuery),
    enabled: newVariantQuery.trim().length >= 2 && resolutionType === "NEW_ITEM",
  });

  const exchangesList = useQuery({ queryKey: ["product-exchanges"], queryFn: () => exchangesApi.list() });

  const mutation = useMutation({
    mutationFn: () =>
      exchangesApi.create({
        originalSaleItemId: selectedItemId!,
        returnedQuantity: Number(returnedQuantity),
        reasonCode,
        resolutionType,
        newVariantId: resolutionType === "NEW_ITEM" ? newVariant?.variantId ?? null : null,
        newQuantity: resolutionType === "NEW_ITEM" ? Number(newQuantity) : null,
      }),
    onSuccess: ({ amountDue }) => {
      void queryClient.invalidateQueries({ queryKey: ["product-exchanges"] });
      toast.success(amountDue > 0 ? `Troca registrada. Cobrar diferença de ${money(amountDue)} numa venda separada.` : "Troca registrada com sucesso.");
      setResult({ amountDue });
      setSelectedItemId(null);
      setNewVariant(null);
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  function submit() {
    setFormError(null);
    setResult(null);
    if (!selectedItemId) return setFormError("Localize a venda e selecione o item devolvido.");
    if (!returnedQuantity || Number(returnedQuantity) <= 0) return setFormError("Informe uma quantidade devolvida válida.");
    if (resolutionType === "NEW_ITEM" && (!newVariant || !newQuantity || Number(newQuantity) <= 0)) {
      return setFormError("Selecione a variante e a quantidade do item novo da troca.");
    }
    mutation.mutate();
  }

  return (
    <Page maxWidth={1000}>
      <PageHeader
        title="Trocas de produto"
        subtitle="Capítulo 11.4/11.7 — troca por tamanho/numeração/defeito: reentrada automática no estoque da variante devolvida e crédito de loja ou item novo, com rastreabilidade fiscal."
      />
      <Paper sx={{ p: 3, mb: 3 }}>
        <Stack spacing={2}>
          {formError && <Alert severity="error">{formError}</Alert>}
          {result && (
            <Alert severity={result.amountDue > 0 ? "warning" : "success"}>
              {result.amountDue > 0
                ? `Troca registrada. Falta cobrar ${money(result.amountDue)} do cliente — feche uma venda normal só com essa diferença e depois use "Vincular venda" na lista abaixo.`
                : "Troca registrada e resolvida integralmente (crédito de loja emitido, se aplicável)."}
            </Alert>
          )}

          <Stack direction="row" spacing={2} alignItems="flex-start">
            <TextField label="ID da venda original (recibo)" value={saleIdInput} onChange={(e) => setSaleIdInput(e.target.value)} sx={{ flex: 1 }} />
            <Button variant="outlined" onClick={() => setSearchedSaleId(saleIdInput.trim() || null)}>
              Localizar
            </Button>
          </Stack>

          {searchedSaleId && (
            <QueryState query={saleQuery} isEmpty={(s) => s.items.length === 0} emptyMessage="Venda sem itens.">
              {(sale) => (
                <Box>
                  <Typography variant="body2" color="text.secondary">
                    Status: {sale.status} • Cliente: {sale.client?.name ?? "não identificado"} • {formatDateTime(sale.createdAt)}
                  </Typography>
                  <TableContainer sx={{ mt: 1 }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell />
                          <TableCell>Item</TableCell>
                          <TableCell>Variante</TableCell>
                          <TableCell align="right">Qtd. vendida</TableCell>
                          <TableCell align="right">Valor unit.</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {sale.items.map((item) => (
                          <TableRow key={item.id} hover selected={selectedItemId === item.id} onClick={() => setSelectedItemId(item.id)} sx={{ cursor: "pointer" }}>
                            <TableCell>
                              <input type="radio" checked={selectedItemId === item.id} onChange={() => setSelectedItemId(item.id)} />
                            </TableCell>
                            <TableCell>{item.product?.name ?? "—"}</TableCell>
                            <TableCell>
                              {item.productVariant ? `${item.productVariant.axis.name}: ${item.productVariant.axisValue}` : "—"}
                            </TableCell>
                            <TableCell align="right">{qty(item.quantity)}</TableCell>
                            <TableCell align="right">{money(item.unitPrice)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Box>
              )}
            </QueryState>
          )}

          <Divider />

          <Stack direction="row" spacing={2}>
            <TextField
              label="Quantidade devolvida"
              value={returnedQuantity}
              onChange={(e) => setReturnedQuantity(e.target.value)}
              sx={{ maxWidth: 200 }}
            />
            <TextField select label="Motivo" value={reasonCode} onChange={(e) => setReasonCode(e.target.value as ExchangeReasonCode)} sx={{ minWidth: 220 }}>
              {Object.entries(EXCHANGE_REASON_LABEL).map(([value, label]) => (
                <MenuItem key={value} value={value}>
                  {label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Resolução"
              value={resolutionType}
              onChange={(e) => setResolutionType(e.target.value as ExchangeResolutionType)}
              sx={{ minWidth: 220 }}
            >
              <MenuItem value="STORE_CREDIT">Crédito de loja</MenuItem>
              <MenuItem value="NEW_ITEM">Troca por item novo</MenuItem>
            </TextField>
          </Stack>

          {resolutionType === "NEW_ITEM" && (
            <Stack direction="row" spacing={2}>
              <Autocomplete
                sx={{ flex: 1 }}
                options={variantSearch.data ?? []}
                getOptionLabel={(opt) => `${opt.productName} — ${opt.axis}: ${opt.axisValue} (saldo ${qty(opt.stockQuantity)})`}
                value={newVariant}
                onChange={(_, value) => setNewVariant(value)}
                onInputChange={(_, value) => setNewVariantQuery(value)}
                renderInput={(params) => <TextField {...params} label="Variante do item novo (nome, SKU, cor, tamanho/numeração)" />}
              />
              <TextField label="Quantidade" value={newQuantity} onChange={(e) => setNewQuantity(e.target.value)} sx={{ maxWidth: 160 }} />
            </Stack>
          )}

          <Button variant="contained" onClick={submit} disabled={mutation.isPending}>
            {mutation.isPending ? "Registrando…" : "Registrar troca"}
          </Button>
        </Stack>
      </Paper>

      <Typography variant="h6" sx={{ mb: 1 }}>
        Trocas recentes
      </Typography>
      <QueryState query={exchangesList} isEmpty={(rows) => rows.length === 0} emptyMessage="Nenhuma troca registrada ainda.">
        {(rows) => (
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Data</TableCell>
                  <TableCell>Motivo</TableCell>
                  <TableCell>Resolução</TableCell>
                  <TableCell align="right">Valor devolvido</TableCell>
                  <TableCell align="right">Diferença</TableCell>
                  <TableCell align="right">Crédito emitido</TableCell>
                  <TableCell>Venda vinculada</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} hover>
                    <TableCell>{formatDateTime(row.createdAt)}</TableCell>
                    <TableCell>{EXCHANGE_REASON_LABEL[row.reasonCode as ExchangeReasonCode] ?? row.reasonCode}</TableCell>
                    <TableCell>{row.resolutionType === "NEW_ITEM" ? "Item novo" : "Crédito de loja"}</TableCell>
                    <TableCell align="right">{money(row.refundValue)}</TableCell>
                    <TableCell align="right">{row.priceDifference ? money(row.priceDifference) : "—"}</TableCell>
                    <TableCell align="right">{row.storeCreditIssued ? money(row.storeCreditIssued) : "—"}</TableCell>
                    <TableCell>
                      {row.resultingSaleId ? (
                        <Chip size="small" color="success" label="Vinculada" />
                      ) : row.priceDifference && Number(row.priceDifference) > 0 ? (
                        <LinkSaleButton exchangeId={row.id} />
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </QueryState>
    </Page>
  );
}

function LinkSaleButton({ exchangeId }: { exchangeId: string }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [saleId, setSaleId] = useState("");
  const [open, setOpen] = useState(false);

  const mutation = useMutation({
    mutationFn: () => exchangesApi.linkSale(exchangeId, saleId.trim()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["product-exchanges"] });
      toast.success("Venda da diferença vinculada à troca.");
      setOpen(false);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (!open) {
    return (
      <Button size="small" onClick={() => setOpen(true)}>
        Vincular venda
      </Button>
    );
  }
  return (
    <Stack direction="row" spacing={1}>
      <TextField size="small" placeholder="ID da venda" value={saleId} onChange={(e) => setSaleId(e.target.value)} />
      <Button size="small" variant="contained" onClick={() => mutation.mutate()} disabled={mutation.isPending || !saleId.trim()}>
        OK
      </Button>
    </Stack>
  );
}

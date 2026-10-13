// apps/web/src/modules/product-variants/VariantQuickLookupPage.tsx
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 11.4 (Loja de Roupas/Moda) — "consulta
// rápida de saldo por variante acessível ao vendedor de chão de loja, não só no
// caixa." GAP DE AUDITORIA FECHADO: a única forma de ver saldo por variante era
// abrir o cadastro completo do produto (VariantsDialog em ProductsPage) ou o
// relatório de giro — nenhum dos dois é "rápido" o bastante para um vendedor
// atender um cliente no provador sem precisar de permissão de cadastro. Esta tela
// usa a mesma permissão de leitura de estoque já concedida ao CASHIER
// (stock:product:read) e consome o novo GET /product-variants/quick-search.
import { useState } from "react";
import { Chip, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { exchangesApi } from "../exchanges/api";
import { Page, PageHeader, QueryState } from "../../shared/ui/PageLayout";
import { qty } from "../../shared/ui/format";

export function VariantQuickLookupPage() {
  const [term, setTerm] = useState("");
  const query = useQuery({
    queryKey: ["product-variants", "quick-search", term],
    queryFn: () => exchangesApi.quickSearchVariants(term),
    enabled: term.trim().length >= 2,
  });

  return (
    <Page maxWidth={800}>
      <PageHeader
        title="Consulta rápida de saldo por variante"
        subtitle="Capítulo 11.4/11.7 — digite o nome, SKU, código de barras, cor ou numeração para ver o saldo na hora, sem abrir o cadastro completo do produto."
      />
      <Stack spacing={2}>
        <TextField
          autoFocus
          label="Buscar (ex.: 'camisa azul', '40', código de barras)"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          fullWidth
        />
        {term.trim().length >= 2 ? (
          <QueryState query={query} isEmpty={(rows) => rows.length === 0} emptyMessage="Nenhuma variante encontrada para esta busca.">
            {(rows) => (
              <TableContainer component={Paper}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Produto</TableCell>
                      <TableCell>SKU</TableCell>
                      <TableCell>Eixo</TableCell>
                      <TableCell>Variante</TableCell>
                      <TableCell align="right">Saldo</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.variantId} hover>
                        <TableCell>{row.productName}</TableCell>
                        <TableCell>{row.sku}</TableCell>
                        <TableCell>{row.axis}</TableCell>
                        <TableCell>{row.axisValue}</TableCell>
                        <TableCell align="right">
                          <Chip
                            size="small"
                            color={Number(row.stockQuantity) > 0 ? "success" : "default"}
                            label={qty(row.stockQuantity)}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </QueryState>
        ) : (
          <Typography variant="body2" color="text.secondary">
            Digite ao menos 2 caracteres para buscar.
          </Typography>
        )}
      </Stack>
    </Page>
  );
}

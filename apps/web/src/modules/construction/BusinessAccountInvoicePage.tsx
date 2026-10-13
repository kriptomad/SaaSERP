// apps/web/src/modules/construction/BusinessAccountInvoicePage.tsx
// Capítulo 11.8 — Material de Construção/Ferragens: clientes profissionais
// (construtoras/empreiteiros) com faturamento mensal consolidado em vez de cobrança
// por venda individual.
import { useState } from "react";
import { Alert, Button, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { businessAccountsApi } from "./api";
import { Page, PageHeader, QueryState, errorMessage } from "../../shared/ui/PageLayout";
import { useToast } from "../../shared/ui/Toast";
import { ClientPicker } from "../../shared/lookups";
import type { Client } from "../registrations/api";
import { formatDateTime } from "../../shared/ui/format";

export function BusinessAccountInvoicePage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [client, setClient] = useState<Client | null>(null);

  const statement = useQuery({
    queryKey: ["business-account-statement", client?.id],
    queryFn: () => businessAccountsApi.getMonthlyStatement(client!.id),
    enabled: Boolean(client),
  });

  const generateInvoice = useMutation({
    mutationFn: () => businessAccountsApi.generateMonthlyInvoice(client!.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["business-account-statement", client?.id] });
      toast.success("Fatura mensal consolidada gerada e saldo de crediário zerado.");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Page>
      <PageHeader
        title="Faturamento Mensal — Clientes Profissionais"
        subtitle="Construtoras/empreiteiros (isBusinessAccount=true): extrato mensal de crediário e geração de fatura consolidada."
      />
      <Stack spacing={2}>
        <ClientPicker value={client} onChange={setClient} label="Cliente profissional" />

        {client && !client.isBusinessAccount && (
          <Alert severity="warning">Este cliente não está marcado como conta profissional (isBusinessAccount). Marque-o no cadastro de clientes para habilitar o faturamento consolidado.</Alert>
        )}

        {client && client.isBusinessAccount && (
          <QueryState query={statement} emptyMessage="Nenhum extrato disponível.">
            {(data) => (
              <Stack spacing={2}>
                <Paper sx={{ p: 2 }}>
                  <Typography variant="subtitle1">Resumo — {data.month}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Limite de crédito: R$ {Number(data.client.creditLimit).toFixed(2)} · Saldo utilizado: R${" "}
                    {Number(data.client.creditBalanceUsed).toFixed(2)}
                  </Typography>
                  <Button
                    sx={{ mt: 1 }}
                    variant="contained"
                    onClick={() => generateInvoice.mutate()}
                    disabled={generateInvoice.isPending || Number(data.client.creditBalanceUsed) <= 0}
                  >
                    {generateInvoice.isPending ? "Gerando…" : "Gerar fatura mensal consolidada"}
                  </Button>
                </Paper>
                <Paper>
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Data</TableCell>
                          <TableCell>Status</TableCell>
                          <TableCell align="right">Valor</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {data.sales.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={3}>Nenhuma venda a crediário neste mês.</TableCell>
                          </TableRow>
                        ) : (
                          data.sales.map((sale) => (
                            <TableRow key={sale.id} hover>
                              <TableCell>{formatDateTime(sale.createdAt)}</TableCell>
                              <TableCell>{sale.status}</TableCell>
                              <TableCell align="right">R$ {Number(sale.totalAmount).toFixed(2)}</TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Paper>
              </Stack>
            )}
          </QueryState>
        )}
      </Stack>
    </Page>
  );
}

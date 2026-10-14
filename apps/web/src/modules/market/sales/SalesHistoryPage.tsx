// apps/web/src/modules/market/sales/SalesHistoryPage.tsx
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 21.7/21.19 — "poder imprimir NFe em
// impressora térmica". CORREÇÃO DE AUDITORIA (Rodada 7): o PDV offline-first
// (Capítulo 8.3) imprime o cupom NÃO fiscal no balcão, antes de qualquer sync — é
// arquiteturalmente impossível ter chave de acesso/QR Code reais naquele momento,
// pois a venda ainda nem chegou ao servidor. Esta página fecha o ciclo: assim que o
// Service Worker sincroniza a venda (sync-pending-sales.ts) e o worker real da fila
// `fiscal-emission` autoriza a NFC-e junto à SEFAZ (emit-fiscal-document.service.ts),
// o operador consulta aqui e reimprime o cupom fiscal DE VERDADE, com QR Code/chave
// de acesso reais — nunca inventados.
import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../../auth/AuthContext";
import { salesApi, SaleListRow } from "./api";
import { Page, PageHeader, QueryState } from "../../../shared/ui/PageLayout";
import { money } from "../../../shared/ui/format";
import { loadHardwareConfig } from "../../../shared/hardware/hardware-config";
import { ThermalPrinterService, PRINTER_PROFILES } from "../../../shared/hardware/thermal-printer.service";
import { buildReceipt, translatePaymentMethod } from "../../../shared/hardware/receipt-layout";

const FISCAL_STATUS_LABEL: Record<string, { label: string; color: "success" | "warning" | "error" | "default" }> = {
  AUTHORIZED: { label: "NFC-e autorizada", color: "success" },
  PENDING: { label: "Emissão pendente", color: "warning" },
  REJECTED: { label: "Rejeitada pela SEFAZ", color: "error" },
  CANCELLED: { label: "Cancelada", color: "default" },
};

export function SalesHistoryPage() {
  const { tenant } = useAuth();
  const [reprintMessage, setReprintMessage] = useState<string | null>(null);
  const query = useQuery({ queryKey: ["sales", "history"], queryFn: () => salesApi.list() });

  async function handleReprint(row: SaleListRow) {
    setReprintMessage(null);
    const config = loadHardwareConfig();
    if (!config.printerModel) {
      setReprintMessage("Nenhuma impressora térmica configurada em Configurações > Hardware.");
      return;
    }
    const doc = row.fiscalDocuments[0];
    try {
      const detail = await salesApi.get(row.id);
      const printer = new ThermalPrinterService(PRINTER_PROFILES[config.printerModel]);
      await printer.connect();
      const builder = buildReceipt(
        {
          tenantTradeName: tenant?.tradeName ?? "Loja",
          tenantDocument: tenant?.cnpj ?? "",
          saleId: row.id,
          closedAt: new Date(row.createdAt),
          items: detail.items.map((item) => ({
            description: item.product.name,
            quantity: Number(item.quantity),
            unitPrice: Number(item.unitPrice),
            totalPrice: Number(item.totalPrice),
          })),
          totalAmount: Number(row.totalAmount),
          paymentMethod: row.paymentMethod,
          totalTaxesApprox: doc?.totalTaxesApprox ? Number(doc.totalTaxesApprox) : null,
          fiscalAccessKey: doc?.status === "AUTHORIZED" ? doc.accessKey : null,
          fiscalProtocolNumber: doc?.status === "AUTHORIZED" ? doc.focusNfeNumero ?? null : null,
          fiscalDocumentType: doc?.type === "NFCE" ? "NFCE" : doc?.type ? "NFE" : null,
        },
        PRINTER_PROFILES[config.printerModel].columns,
      );
      await printer.printReceipt(builder);
      await printer.disconnect();
      setReprintMessage(`Cupom da venda ${row.id.slice(0, 8)}… reimpresso.`);
    } catch (error) {
      setReprintMessage(`Falha ao reimprimir: ${(error as Error).message}`);
    }
  }

  return (
    <Page maxWidth={1100}>
      <PageHeader
        title="Histórico de vendas"
        subtitle="Capítulo 21.7 — consulte o status real da emissão fiscal (NFC-e) de cada venda e reimprima o cupom fiscal com QR Code/chave de acesso reais assim que a SEFAZ autorizar."
      />
      {reprintMessage && <Alert severity="info" sx={{ mb: 2 }}>{reprintMessage}</Alert>}
      <QueryState query={query} isEmpty={(rows) => rows.length === 0} emptyMessage="Nenhuma venda registrada ainda.">
        {(rows) => (
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Data</TableCell>
                  <TableCell>Cliente</TableCell>
                  <TableCell align="right">Total</TableCell>
                  <TableCell>Pagamento</TableCell>
                  <TableCell>Documento fiscal</TableCell>
                  <TableCell align="right">Ações</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => {
                  const doc = row.fiscalDocuments[0];
                  const fiscalInfo = doc ? FISCAL_STATUS_LABEL[doc.status] : undefined;
                  return (
                    <TableRow key={row.id}>
                      <TableCell>{new Date(row.createdAt).toLocaleString("pt-BR")}</TableCell>
                      <TableCell>{row.client?.name ?? "Consumidor final"}</TableCell>
                      <TableCell align="right">R$ {money(Number(row.totalAmount))}</TableCell>
                      <TableCell>{translatePaymentMethod(row.paymentMethod)}</TableCell>
                      <TableCell>
                        {fiscalInfo ? (
                          <Chip size="small" label={fiscalInfo.label} color={fiscalInfo.color} />
                        ) : (
                          <Chip size="small" label="Sem documento" variant="outlined" />
                        )}
                      </TableCell>
                      <TableCell align="right">
                        <Button
                          size="small"
                          variant="outlined"
                          disabled={row.status !== "PAID"}
                          onClick={() => handleReprint(row)}
                        >
                          Reimprimir cupom
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </QueryState>
      <Box sx={{ mt: 2 }}>
        <Typography variant="caption" color="text.secondary">
          O cupom reimpresso aqui sempre reflete o status fiscal real consultado no servidor (nunca os dados locais de quando a venda foi fechada no balcão).
        </Typography>
      </Box>
    </Page>
  );
}

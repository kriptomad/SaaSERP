// apps/web/src/modules/purchasing/NfeXmlImportPage.tsx
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 17.8 — frontend do import de XML de NF-e
// de compra (ver nfe-xml-import.service.ts/routes.ts no backend para o racional
// completo). Fluxo em 2 telas: (1) upload do arquivo .xml → preview com cada item já
// casado automaticamente contra o catálogo (ou pendente de seleção manual); (2)
// confirmação cria a PurchaseOrder real, pronta para o fluxo de recebimento já
// existente em /compras/:id.
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
  TextField,
  Typography,
} from "@mui/material";
import UploadFileIcon from "@mui/icons-material/UploadFileOutlined";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { purchaseOrdersApi, type NfeImportPreview } from "./api";
import { Page, PageHeader, errorMessage } from "../../shared/ui/PageLayout";
import { ProductPicker, SupplierPicker } from "../../shared/lookups";
import { useToast } from "../../shared/ui/Toast";
import { money } from "../../shared/ui/format";

interface EditableItem {
  cProd: string;
  description: string;
  ean: string | null;
  quantity: number;
  unitCost: number;
  productId: string | null;
  matchedBy: "BARCODE" | "SKU" | null;
}

export function NfeXmlImportPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [preview, setPreview] = useState<NfeImportPreview | null>(null);
  const [items, setItems] = useState<EditableItem[]>([]);
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const previewMutation = useMutation({
    mutationFn: (xml: string) => purchaseOrdersApi.previewNfeImport(xml),
    onSuccess: (data) => {
      setPreview(data);
      setSupplierId(data.supplierMatch?.id ?? null);
      setItems(
        data.items.map((i) => ({
          cProd: i.cProd,
          description: i.description,
          ean: i.ean,
          quantity: i.quantity,
          unitCost: i.unitCost,
          productId: i.matchedProductId,
          matchedBy: i.matchedBy,
        })),
      );
      setFileError(null);
    },
    onError: (error) => setFileError(errorMessage(error)),
  });

  const confirmMutation = useMutation({
    mutationFn: () => {
      if (!supplierId) throw new Error("Selecione o fornecedor antes de confirmar.");
      if (items.some((i) => !i.productId)) throw new Error("Todo item precisa estar vinculado a um produto do catálogo.");
      return purchaseOrdersApi.confirmNfeImport({
        supplierId,
        items: items.map((i) => ({ cProd: i.cProd, productId: i.productId!, quantity: i.quantity, unitCost: i.unitCost })),
      });
    },
    onSuccess: (order) => {
      toast.success(`Ordem de compra #${order.orderNumber} criada a partir da XML importada.`);
      navigate(`/compras/${order.id}`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => previewMutation.mutate(String(reader.result ?? ""));
    reader.onerror = () => setFileError("Não foi possível ler o arquivo selecionado.");
    reader.readAsText(file);
  }

  const allMatched = items.length > 0 && items.every((i) => i.productId);

  return (
    <Page>
      <PageHeader title="Importar XML de NF-e de compra" subtitle="Envie o XML (não o PDF/DANFE) da nota fiscal recebida do fornecedor para pré-preencher uma ordem de compra." />

      {!preview && (
        <Paper sx={{ p: 4, textAlign: "center" }}>
          <Button component="label" variant="contained" startIcon={<UploadFileIcon />} disabled={previewMutation.isPending}>
            {previewMutation.isPending ? "Lendo XML..." : "Selecionar arquivo .xml"}
            <input
              type="file"
              accept=".xml,text/xml,application/xml"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
                e.target.value = "";
              }}
            />
          </Button>
          {fileError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {fileError}
            </Alert>
          )}
        </Paper>
      )}

      {preview && (
        <Stack spacing={2}>
          <Paper sx={{ p: 2 }}>
            <Stack direction="row" spacing={3} flexWrap="wrap">
              <Typography variant="body2">
                <strong>Nota:</strong> {preview.number ?? "—"} / Série {preview.series ?? "—"}
              </Typography>
              <Typography variant="body2">
                <strong>Emitente:</strong> {preview.supplier.name} ({preview.supplier.cnpj})
              </Typography>
              <Typography variant="body2">
                <strong>Total da nota:</strong> {money(preview.totalValue)}
              </Typography>
            </Stack>
          </Paper>

          <Paper sx={{ p: 2 }}>
            <Box sx={{ maxWidth: 420, mb: 1 }}>
              <SupplierPicker value={supplierId} onChange={setSupplierId} required />
            </Box>
            {!preview.supplierMatch && (
              <Alert severity="warning">
                Nenhum fornecedor cadastrado com o CNPJ {preview.supplier.cnpj} — selecione manualmente ou cadastre-o antes de confirmar.
              </Alert>
            )}
          </Paper>

          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Descrição na nota</TableCell>
                  <TableCell>Cód./EAN</TableCell>
                  <TableCell align="right">Qtd.</TableCell>
                  <TableCell align="right">Custo unit.</TableCell>
                  <TableCell>Casamento</TableCell>
                  <TableCell sx={{ minWidth: 260 }}>Produto no catálogo</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {items.map((item, index) => (
                  <TableRow key={item.cProd + index} hover>
                    <TableCell>{item.description}</TableCell>
                    <TableCell>{item.ean ?? item.cProd}</TableCell>
                    <TableCell align="right">
                      <TextField
                        type="number"
                        size="small"
                        value={item.quantity}
                        onChange={(e) =>
                          setItems((prev) => prev.map((p, i) => (i === index ? { ...p, quantity: Number(e.target.value) } : p)))
                        }
                        sx={{ width: 90 }}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <TextField
                        type="number"
                        size="small"
                        value={item.unitCost}
                        onChange={(e) =>
                          setItems((prev) => prev.map((p, i) => (i === index ? { ...p, unitCost: Number(e.target.value) } : p)))
                        }
                        sx={{ width: 110 }}
                      />
                    </TableCell>
                    <TableCell>
                      {item.matchedBy ? (
                        <Chip size="small" color="success" label={item.matchedBy === "BARCODE" ? "Código de barras" : "SKU"} />
                      ) : (
                        <Chip size="small" color="warning" label="Sem casamento" />
                      )}
                    </TableCell>
                    <TableCell>
                      <ProductPicker
                        value={item.productId}
                        onChange={(product) =>
                          setItems((prev) => prev.map((p, i) => (i === index ? { ...p, productId: product?.id ?? null } : p)))
                        }
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          {!allMatched && (
            <Alert severity="info">Selecione um produto do catálogo para cada item antes de confirmar a importação.</Alert>
          )}

          <Stack direction="row" spacing={2}>
            <Button
              variant="contained"
              disabled={!allMatched || !supplierId || confirmMutation.isPending}
              onClick={() => confirmMutation.mutate()}
            >
              {confirmMutation.isPending ? "Criando ordem..." : "Confirmar e criar ordem de compra"}
            </Button>
            <Button
              color="inherit"
              onClick={() => {
                setPreview(null);
                setItems([]);
              }}
            >
              Cancelar / importar outro arquivo
            </Button>
          </Stack>
        </Stack>
      )}
    </Page>
  );
}

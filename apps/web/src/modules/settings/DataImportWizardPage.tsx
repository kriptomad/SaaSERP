// apps/web/src/modules/settings/DataImportWizardPage.tsx
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 18.5 — Importação Assistida de Dados: a
// tela guia o lojista por um wizard de 4 passos (Upload -> Mapeamento -> Validação ->
// Confirmação) que NUNCA aplica a importação sem confirmação visual prévia.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Step,
  StepLabel,
  Stepper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import { Page, PageHeader, errorMessage } from "../../shared/ui/PageLayout";
import { useToast } from "../../shared/ui/Toast";
import { useSseStream } from "../../shared/useSseStream";
import { dataImportApi, ImportTargetEntity, importTargetFieldsForEntity, uploadImportSourceFile } from "./data-portability-api";

const TARGET_FIELD_LABEL: Record<string, string> = {
  name: "Nome do produto",
  barcodeEan13: "Código de barras (EAN-13)",
  costPrice: "Preço de custo",
  unitPrice: "Preço de venda",
  stockQuantity: "Quantidade em estoque",
  categoryName: "Categoria",
  document: "CPF/CNPJ",
  phone: "Telefone",
  email: "E-mail",
};

const ENTITY_LABEL: Record<ImportTargetEntity, string> = {
  PRODUCT: "Produtos",
  CLIENT: "Clientes",
  SUPPLIER: "Fornecedores",
};

const STEPS = ["Upload", "Mapeamento", "Validação", "Confirmação"];

export function DataImportWizardPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [activeStep, setActiveStep] = useState(0);
  const [targetEntity, setTargetEntity] = useState<ImportTargetEntity>("PRODUCT");
  const [jobId, setJobId] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<{ processedRows: number; totalRows: number } | null>(null);

  const jobDetailQuery = useQuery({
    queryKey: ["data-import", "job", jobId],
    queryFn: () => dataImportApi.detail(jobId!),
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "VALIDATING" || status === "IMPORTING" ? 2_000 : false;
    },
  });

  const suggestMappingMutation = useMutation({
    mutationFn: () => dataImportApi.suggestMapping(jobId!),
    onSuccess: (result) => {
      setMapping(result.suggestedMapping);
      setActiveStep(1);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const storageKey = await uploadImportSourceFile(file);
      return dataImportApi.createJob(storageKey, targetEntity);
    },
    onSuccess: async (job) => {
      setJobId(job.id);
      toast.success("Arquivo enviado. Analisando colunas…");
      await suggestMappingMutation.mutateAsync();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const saveMappingMutation = useMutation({
    mutationFn: () => dataImportApi.updateMapping(jobId!, mapping),
    onSuccess: async () => {
      setActiveStep(2);
      await validateMutation.mutateAsync();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const validateMutation = useMutation({
    mutationFn: () => dataImportApi.validate(jobId!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["data-import", "job", jobId] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const confirmMutation = useMutation({
    mutationFn: () => dataImportApi.confirm(jobId!),
    onSuccess: () => {
      setActiveStep(3);
      void queryClient.invalidateQueries({ queryKey: ["data-import", "job", jobId] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  useSseStream(
    "/notifications/stream",
    (event) => {
      if (event.type !== "data-import-progress") return;
      const data = event.data as { jobId: string; processedRows: number; totalRows: number };
      if (data.jobId !== jobId) return;
      setProgress({ processedRows: data.processedRows, totalRows: data.totalRows });
      void queryClient.invalidateQueries({ queryKey: ["data-import", "job", jobId] });
    },
    Boolean(jobId) && activeStep === 3,
  );

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    uploadMutation.mutate(file);
  }

  const job = jobDetailQuery.data;
  const suggestion = suggestMappingMutation.data;

  return (
    <Page>
      <PageHeader
        title="Importação Assistida de Dados"
        subtitle="Envie um CSV/XLSX de produtos, clientes ou fornecedores, mapeie as colunas, valide sem gravar nada e só então confirme a gravação real, em lotes transacionais."
      />

      <Stepper activeStep={activeStep} sx={{ mb: 3 }}>
        {STEPS.map((label) => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {activeStep === 0 && (
        <Paper sx={{ p: 3 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Selecione o tipo de dado e envie um arquivo CSV ou XLSX. O arquivo é processado no servidor — nunca no seu
            navegador.
          </Typography>
          <Select
            size="small"
            value={targetEntity}
            onChange={(e) => setTargetEntity(e.target.value as ImportTargetEntity)}
            sx={{ minWidth: 220, mb: 2, display: "block" }}
          >
            {(Object.keys(ENTITY_LABEL) as ImportTargetEntity[]).map((entity) => (
              <MenuItem key={entity} value={entity}>
                {ENTITY_LABEL[entity]}
              </MenuItem>
            ))}
          </Select>
          <Button component="label" variant="contained" startIcon={<CloudUploadIcon />} disabled={uploadMutation.isPending || suggestMappingMutation.isPending}>
            {uploadMutation.isPending || suggestMappingMutation.isPending ? "Enviando…" : "Selecionar arquivo"}
            <input type="file" hidden accept=".csv,.xlsx,.xls" onChange={handleFileSelected} />
          </Button>
        </Paper>
      )}

      {activeStep === 1 && suggestion && (
        <Paper sx={{ p: 3 }}>
          <Typography variant="subtitle1" sx={{ mb: 1 }}>
            Mapeie as colunas do arquivo
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Sugerimos um mapeamento automático por similaridade de nome — revise e ajuste antes de prosseguir.
          </Typography>
          <Table size="small" sx={{ mb: 3 }}>
            <TableHead>
              <TableRow>
                <TableCell>Coluna do arquivo</TableCell>
                {suggestion.previewRows.slice(0, 1).length > 0 && <TableCell>Exemplo</TableCell>}
                <TableCell>Campo de destino</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {suggestion.headers.map((header, index) => (
                <TableRow key={header}>
                  <TableCell>{header}</TableCell>
                  <TableCell>{suggestion.previewRows[0]?.[index] ?? ""}</TableCell>
                  <TableCell>
                    <Select
                      size="small"
                      value={mapping[header] ?? ""}
                      onChange={(e) => setMapping((prev) => ({ ...prev, [header]: e.target.value }))}
                      displayEmpty
                      sx={{ minWidth: 220 }}
                    >
                      <MenuItem value="">— Ignorar esta coluna —</MenuItem>
                      {importTargetFieldsForEntity(targetEntity).map((field) => (
                        <MenuItem key={field} value={field}>
                          {TARGET_FIELD_LABEL[field] ?? field}
                        </MenuItem>
                      ))}
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Preview das 5 primeiras linhas
          </Typography>
          <Box sx={{ overflowX: "auto", mb: 3 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  {suggestion.headers.map((h) => (
                    <TableCell key={h}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {suggestion.previewRows.map((row, i) => (
                  <TableRow key={i}>
                    {row.map((cell, j) => (
                      <TableCell key={j}>{cell}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>

          <Button variant="contained" disabled={saveMappingMutation.isPending} onClick={() => saveMappingMutation.mutate()}>
            {saveMappingMutation.isPending ? "Validando…" : "Confirmar mapeamento e validar"}
          </Button>
        </Paper>
      )}

      {activeStep === 2 && (
        <Paper sx={{ p: 3 }}>
          {(!job || job.status === "VALIDATING") && (
            <Stack spacing={2} alignItems="center" sx={{ py: 4 }}>
              <LinearProgress sx={{ width: "100%" }} />
              <Typography variant="body2" color="text.secondary">
                Validando linha a linha contra as regras de negócio (EAN-13, preço positivo etc.)…
              </Typography>
            </Stack>
          )}
          {job?.status === "VALIDATED_CLEAN" && (
            <Stack spacing={2}>
              <Alert severity="success">Todas as {job.totalRows} linhas passaram na validação sem erros.</Alert>
              <Button variant="contained" onClick={() => setActiveStep(3)}>
                Avançar para confirmação
              </Button>
            </Stack>
          )}
          {job?.status === "VALIDATED_WITH_ERRORS" && (
            <Stack spacing={2}>
              <Alert severity="error">
                Foram encontrados erros em uma ou mais linhas de {job.totalRows}. Baixe o relatório, corrija o arquivo e
                envie novamente (volte ao passo 1).
              </Alert>
              {job.errorReportDownloadUrl && (
                <Button variant="outlined" onClick={() => window.open(job.errorReportDownloadUrl!, "_blank", "noopener,noreferrer")}>
                  Baixar relatório de erros (CSV)
                </Button>
              )}
              <Button
                variant="text"
                onClick={() => {
                  setActiveStep(0);
                  setJobId(null);
                  setMapping({});
                }}
              >
                Recomeçar com outro arquivo
              </Button>
            </Stack>
          )}
          {job?.status === "FAILED" && <Alert severity="error">A validação falhou. Tente enviar o arquivo novamente.</Alert>}
        </Paper>
      )}

      {activeStep === 3 && (
        <Paper sx={{ p: 3 }}>
          {job?.status !== "VALIDATED_CLEAN" && job?.status !== "IMPORTING" && job?.status !== "COMPLETED" && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              A importação só pode ser confirmada após a validação sem erros.
            </Alert>
          )}
          {(job?.status === "VALIDATED_CLEAN" || confirmMutation.isIdle) && job?.status === "VALIDATED_CLEAN" && (
            <Button variant="contained" disabled={confirmMutation.isPending} onClick={() => confirmMutation.mutate()} sx={{ mb: 2 }}>
              {confirmMutation.isPending ? "Confirmando…" : "Confirmar Importação"}
            </Button>
          )}
          {(job?.status === "IMPORTING" || job?.status === "COMPLETED") && (
            <Stack spacing={1}>
              <Typography variant="body2">
                {progress?.processedRows ?? job?.processedRows ?? 0} / {progress?.totalRows ?? job?.totalRows ?? 0} linhas gravadas
              </Typography>
              <LinearProgress
                variant="determinate"
                value={job?.totalRows ? (100 * (progress?.processedRows ?? job.processedRows)) / job.totalRows : 0}
              />
              {job?.status === "COMPLETED" && <Alert severity="success">Importação concluída com sucesso!</Alert>}
            </Stack>
          )}
          {job?.status === "FAILED" && <Alert severity="error">A importação falhou em um dos lotes. {job.processedRows} linhas já foram gravadas antes da falha.</Alert>}
        </Paper>
      )}
    </Page>
  );
}

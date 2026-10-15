// apps/web/src/modules/settings/DataExportPage.tsx
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 18.4 — "todo tenant tem acesso, a
// qualquer momento e sem necessidade de abrir chamado de suporte, a um botão
// 'Exportar todos os meus dados'". Disponível em TODOS os planos, inclusive o Tier
// Free — por isso esta tela não checa nenhum módulo/plano contratado.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Chip, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import CloudDownloadIcon from "@mui/icons-material/CloudDownload";
import { Page, PageHeader, QueryState, errorMessage } from "../../shared/ui/PageLayout";
import { useToast } from "../../shared/ui/Toast";
import { dataExportApi, DataExportStatus, TenantDataExportJob } from "./data-portability-api";

const STATUS_LABEL: Record<DataExportStatus, string> = {
  QUEUED: "Na fila",
  GENERATING: "Gerando…",
  COMPLETED: "Concluído",
  FAILED: "Falhou",
};

const STATUS_COLOR: Record<DataExportStatus, "default" | "info" | "success" | "error"> = {
  QUEUED: "default",
  GENERATING: "info",
  COMPLETED: "success",
  FAILED: "error",
};

export function DataExportPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const jobsQuery = useQuery({
    queryKey: ["data-export", "jobs"],
    queryFn: dataExportApi.list,
    refetchInterval: (query) => {
      const jobs = query.state.data as TenantDataExportJob[] | undefined;
      const stillRunning = jobs?.some((j) => j.status === "QUEUED" || j.status === "GENERATING");
      return stillRunning ? 4_000 : false;
    },
  });

  const createExport = useMutation({
    mutationFn: dataExportApi.create,
    onSuccess: () => {
      toast.success("Exportação solicitada. Você será avisado quando o pacote estiver pronto.");
      void queryClient.invalidateQueries({ queryKey: ["data-export", "jobs"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  async function handleDownload(id: string) {
    setDownloadingId(id);
    try {
      const result = await dataExportApi.download(id);
      window.open(result.downloadUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <Page>
      <PageHeader
        title="Exportação de Dados"
        subtitle="Baixe um pacote ZIP com todas as tabelas do seu catálogo/vendas em CSV, documentos fiscais e fotos — disponível em todos os planos, inclusive o gratuito."
      />

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          O pacote inclui um CSV por tabela do seu sistema, os XMLs de documentos fiscais e as fotos de O.S./avaria
          armazenadas, além de um <code>schema-reference.json</code> descrevendo cada CSV — facilitando a importação em
          qualquer outro sistema. A geração roda em segundo plano; você recebe um aviso (in-app e e-mail) assim que o
          download estiver pronto.
        </Typography>
        <Button variant="contained" startIcon={<CloudDownloadIcon />} disabled={createExport.isPending} onClick={() => createExport.mutate()}>
          {createExport.isPending ? "Solicitando…" : "Exportar todos os meus dados"}
        </Button>
      </Paper>

      <Paper sx={{ p: 3 }}>
        <Typography variant="subtitle1" sx={{ mb: 2 }}>
          Exportações solicitadas
        </Typography>
        <QueryState query={jobsQuery} isEmpty={(data) => data.length === 0} emptyMessage="Nenhuma exportação solicitada ainda.">
          {(jobs) => (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Solicitado em</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Concluído em</TableCell>
                  <TableCell align="right">Ação</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {jobs.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell>{new Date(job.createdAt).toLocaleString("pt-BR")}</TableCell>
                    <TableCell>
                      <Chip size="small" label={STATUS_LABEL[job.status]} color={STATUS_COLOR[job.status]} />
                      {job.status === "FAILED" && job.failureReason && (
                        <Typography variant="caption" color="error" display="block">
                          {job.failureReason}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>{job.completedAt ? new Date(job.completedAt).toLocaleString("pt-BR") : "—"}</TableCell>
                    <TableCell align="right">
                      {job.status === "COMPLETED" && (
                        <Button size="small" variant="outlined" disabled={downloadingId === job.id} onClick={() => handleDownload(job.id)}>
                          {downloadingId === job.id ? "Abrindo…" : "Baixar"}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </QueryState>
      </Paper>

      {jobsQuery.isError && <Alert severity="error" sx={{ mt: 2 }}>{errorMessage(jobsQuery.error)}</Alert>}
    </Page>
  );
}

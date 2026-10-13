// apps/web/src/shared/ui/PageLayout.tsx
import type { ReactNode } from "react";
import { Alert, Box, CircularProgress, Stack, Typography } from "@mui/material";
import type { UseQueryResult } from "@tanstack/react-query";

export function Page({ children, maxWidth = 1200 }: { children: ReactNode; maxWidth?: number }) {
  return <Box sx={{ p: { xs: 2, md: 3 }, maxWidth, mx: "auto" }}>{children}</Box>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ sm: "center" }} spacing={1} sx={{ mb: 2 }}>
      <Box>
        <Typography variant="h5">{title}</Typography>
        {subtitle && (
          <Typography variant="body2" color="text.secondary">
            {subtitle}
          </Typography>
        )}
      </Box>
      {actions && (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {actions}
        </Stack>
      )}
    </Stack>
  );
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Erro inesperado.";
}

// Trata loading/erro/vazio de uma query; os filhos só renderizam com dados.
export function QueryState<T>({
  query,
  isEmpty,
  emptyMessage = "Nenhum registro encontrado.",
  children,
}: {
  query: UseQueryResult<T>;
  isEmpty?: (data: T) => boolean;
  emptyMessage?: string;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
        <CircularProgress aria-label="Carregando" />
      </Box>
    );
  }
  if (query.isError) {
    return <Alert severity="error">{errorMessage(query.error)}</Alert>;
  }
  const data = query.data;
  if (data === undefined || (isEmpty && isEmpty(data))) {
    return <Alert severity="info">{emptyMessage}</Alert>;
  }
  return <>{children(data)}</>;
}

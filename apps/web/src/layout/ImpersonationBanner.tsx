// apps/web/src/layout/ImpersonationBanner.tsx
// Capítulo 13.1 — aviso permanente e impossível de ignorar quando a sessão atual
// desta aba foi aberta por impersonation a partir do painel de plataforma. Nunca
// escondido/minimizável: o lojista precisa sempre saber que um administrador da
// plataforma está vendo a tela em seu nome.
import { useEffect, useState } from "react";
import { Alert, Button, Stack, Typography } from "@mui/material";
import { getStoredImpersonation, endImpersonation } from "../api/client";
import { useAuth } from "../auth/AuthContext";

export function ImpersonationBanner() {
  const { clearSession } = useAuth();
  const [impersonation] = useState(() => getStoredImpersonation());
  const [ending, setEnding] = useState(false);

  // Encerramento automático assim que o `expiresAt` (30min) é alcançado — nunca
  // depende só do lojista clicar em "Sair", caso ele apenas feche a aba sem notar.
  useEffect(() => {
    if (!impersonation) return;
    const msRemaining = new Date(impersonation.expiresAt).getTime() - Date.now();
    if (msRemaining <= 0) {
      clearSession();
      return;
    }
    const timer = setTimeout(() => clearSession(), msRemaining);
    return () => clearTimeout(timer);
  }, [impersonation, clearSession]);

  if (!impersonation) return null;

  async function handleEnd() {
    setEnding(true);
    try {
      await endImpersonation();
    } catch {
      // mesmo se a chamada falhar (ex.: já expirado no servidor), a sessão local
      // é encerrada de qualquer forma — o objetivo é sempre sair desta visão.
    } finally {
      clearSession();
    }
  }

  return (
    <Alert
      severity="warning"
      sx={{ borderRadius: 0, justifyContent: "center" }}
      action={
        <Button color="inherit" size="small" variant="outlined" disabled={ending} onClick={handleEnd}>
          Encerrar sessão de suporte
        </Button>
      }
    >
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography variant="body2" fontWeight={600}>
          Sessão de suporte temporária — um administrador da plataforma está visualizando este tenant.
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Expira às {new Date(impersonation.expiresAt).toLocaleTimeString("pt-BR")}
        </Typography>
      </Stack>
    </Alert>
  );
}

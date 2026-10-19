// apps/web/src/modules/platform-admin/PlatformAdminConfirmDialog.tsx
// GAP DE AUDITORIA FECHADO (fa-superadmin-destructive-ui-no-confirmation): várias
// ações do painel de plataforma (backup manual, ativar/desativar plano/módulo/cupom,
// marcar indicação como convertida, aplicar recompensa/crédito de indicação) disparavam
// direto no clique/toggle, sem nenhum resumo de impacto nem confirmação — um clique
// errado tinha efeito imediato e irreversível em produção, afetando potencialmente
// TODOS os tenants (ex.: desativar um módulo de billing). Este modal MUI genérico é
// usado por todas elas: sempre mostra o objeto afetado e o estado antes/depois (ou
// impacto financeiro), e para as ações financeiras/recompensa exige uma justificativa
// obrigatória (mínimo 5 caracteres) antes de habilitar o botão de confirmação.
import { useState } from "react";
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Stack, TextField, Typography } from "@mui/material";

export interface PlatformAdminConfirmImpactItem {
  label: string;
  value: string;
}

export interface PlatformAdminConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  /** Resumo do impacto: objeto/tenant afetado, estado antes/depois, valor financeiro, etc. */
  impact?: PlatformAdminConfirmImpactItem[];
  confirmLabel?: string;
  /** Ações com impacto financeiro/recompensa/suspensão exigem justificativa obrigatória. */
  requireReason?: boolean;
  /** Realça visualmente que a ação é sensível/irreversível. */
  danger?: boolean;
  busy?: boolean;
  onConfirm: (reason?: string) => void;
  onClose: () => void;
}

export function PlatformAdminConfirmDialog({
  open,
  title,
  description,
  impact,
  confirmLabel = "Confirmar",
  requireReason,
  danger,
  busy,
  onConfirm,
  onClose,
}: PlatformAdminConfirmDialogProps) {
  const [reason, setReason] = useState("");
  const canConfirm = !requireReason || reason.trim().length >= 5;

  function handleClose() {
    if (busy) return;
    setReason("");
    onClose();
  }

  function handleConfirm() {
    onConfirm(requireReason ? reason.trim() : undefined);
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: impact?.length ? 2 : 0 }}>{description}</DialogContentText>
        {impact && impact.length > 0 && (
          <Stack spacing={0.5} sx={{ mb: 2, p: 1.5, bgcolor: "action.hover", borderRadius: 1 }}>
            {impact.map((item) => (
              <Typography key={item.label} variant="body2">
                <strong>{item.label}:</strong> {item.value}
              </Typography>
            ))}
          </Stack>
        )}
        {danger && (
          <Alert severity="warning" sx={{ mb: requireReason ? 2 : 0 }}>
            Esta ação é sensível e fica registrada no audit log da plataforma com seu usuário e horário.
          </Alert>
        )}
        {requireReason && (
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={2}
            label="Justificativa (obrigatória, mínimo 5 caracteres)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={busy}
          />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={busy}>
          Cancelar
        </Button>
        <Button onClick={handleConfirm} variant="contained" color={danger ? "error" : "primary"} disabled={busy || !canConfirm}>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

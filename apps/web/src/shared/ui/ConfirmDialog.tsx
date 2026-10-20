// apps/web/src/shared/ui/ConfirmDialog.tsx
import { useEffect, useState } from "react";
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, TextField } from "@mui/material";

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirmar",
  busy,
  requireReason,
  reasonLabel = "Motivo (obrigatório)",
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  busy?: boolean;
  /** Quando true, exige preenchimento de um campo de motivo antes de habilitar a confirmação. */
  requireReason?: boolean;
  reasonLabel?: string;
  onConfirm: (reason?: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");

  // Limpa o motivo digitado sempre que o diálogo é reaberto para uma nova ação.
  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  const canConfirm = !requireReason || reason.trim().length > 0;

  function handleClose() {
    if (busy) return;
    onClose();
  }

  function handleConfirm() {
    if (!canConfirm) return;
    onConfirm(requireReason ? reason.trim() : undefined);
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : handleClose}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: requireReason ? 2 : 0 }}>{message}</DialogContentText>
        {requireReason && (
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={2}
            label={reasonLabel}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={busy}
          />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={busy}>
          Voltar
        </Button>
        <Button onClick={handleConfirm} variant="contained" disabled={busy || !canConfirm}>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

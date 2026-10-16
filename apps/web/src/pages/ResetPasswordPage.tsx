// apps/web/src/pages/ResetPasswordPage.tsx
// GAP DE AUDITORIA FECHADO (Rodada 6) — página que consome o link enviado por
// ForgotPasswordPage (`/redefinir-senha?token=...`). Consome
// POST /auth/password-reset/confirm (auth.routes.ts).
import { useState, FormEvent } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Box, Button, Paper, TextField, Typography, Alert, Stack, Link as MuiLink } from "@mui/material";
import { confirmPasswordReset, ApiError } from "../api/client";
import { ThemeToggleButton } from "../theme/ThemeToggleButton";

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token") ?? "";
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("As senhas não coincidem.");
      return;
    }
    setLoading(true);
    try {
      await confirmPasswordReset({ token, newPassword });
      setDone(true);
      setTimeout(() => navigate("/login"), 2500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao conectar com o servidor.");
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh", bgcolor: "background.default" }}>
        <Paper elevation={2} sx={{ p: 4, width: 380 }}>
          <Alert severity="error">Link de redefinição inválido. Solicite um novo link.</Alert>
          <Box sx={{ mt: 2 }}><MuiLink href="/esqueci-senha">Solicitar novo link</MuiLink></Box>
        </Paper>
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh", bgcolor: "background.default", position: "relative" }}>
      <Box sx={{ position: "absolute", top: 8, right: 8 }}><ThemeToggleButton /></Box>
      <Paper elevation={2} sx={{ p: 4, width: 380 }}>
        <Typography variant="h5" gutterBottom>
          Redefinir senha
        </Typography>
        {done ? (
          <Alert severity="success">Senha redefinida com sucesso! Redirecionando para o login...</Alert>
        ) : (
          <form onSubmit={handleSubmit}>
            <Stack spacing={2}>
              {error && <Alert severity="error">{error}</Alert>}
              <TextField
                label="Nova senha"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                fullWidth
                helperText="Mínimo 8 caracteres, com letras maiúsculas, minúsculas e números."
              />
              <TextField
                label="Confirmar nova senha"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                fullWidth
              />
              <Button type="submit" variant="contained" disabled={loading} fullWidth>
                {loading ? "Salvando..." : "Redefinir senha"}
              </Button>
            </Stack>
          </form>
        )}
      </Paper>
    </Box>
  );
}

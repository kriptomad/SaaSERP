// apps/web/src/pages/ForgotPasswordPage.tsx
// GAP DE AUDITORIA FECHADO (Rodada 6) — só existia tela de "esqueci minha senha"
// para administradores da plataforma (PlatformAdminLoginPage); um usuário comum de
// tenant (OWNER/MANAGER/TECHNICIAN/CASHIER) não tinha NENHUMA UI para recuperar a
// própria conta. Consome POST /auth/password-reset/request (auth.routes.ts).
import { useState, FormEvent } from "react";
import { Box, Button, Paper, TextField, Typography, Alert, Stack, Link as MuiLink } from "@mui/material";
import { requestPasswordReset, ApiError } from "../api/client";
import { ThemeToggleButton } from "../theme/ThemeToggleButton";

export function ForgotPasswordPage() {
  const [tenantSlug, setTenantSlug] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await requestPasswordReset({ tenantSlug, email });
      // Mensagem sempre genérica — o backend nunca revela se o e-mail/tenant existe
      // de fato, para não permitir enumeração de contas.
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao conectar com o servidor.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh", bgcolor: "background.default", position: "relative" }}>
      <Box sx={{ position: "absolute", top: 8, right: 8 }}><ThemeToggleButton /></Box>
      <Paper elevation={2} sx={{ p: 4, width: 380 }}>
        <Typography variant="h5" gutterBottom>
          Esqueci minha senha
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Informe o identificador da sua empresa e o e-mail da sua conta. Se existir, enviaremos um link de redefinição.
        </Typography>
        {submitted ? (
          <Stack spacing={2}>
            <Alert severity="success">
              Se o e-mail existir em nossa base, um link de redefinição foi enviado. Verifique sua caixa de entrada (e o spam).
            </Alert>
            <MuiLink href="/login">Voltar para o login</MuiLink>
          </Stack>
        ) : (
          <form onSubmit={handleSubmit}>
            <Stack spacing={2}>
              {error && <Alert severity="error">{error}</Alert>}
              <TextField
                label="Identificador (slug) da empresa"
                value={tenantSlug}
                onChange={(e) => setTenantSlug(e.target.value)}
                required
                fullWidth
              />
              <TextField
                label="E-mail"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                fullWidth
              />
              <Button type="submit" variant="contained" disabled={loading} fullWidth>
                {loading ? "Enviando..." : "Enviar link de redefinição"}
              </Button>
              <Typography variant="body2" align="center">
                <MuiLink href="/login">Voltar para o login</MuiLink>
              </Typography>
            </Stack>
          </form>
        )}
      </Paper>
    </Box>
  );
}

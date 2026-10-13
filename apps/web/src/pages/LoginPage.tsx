// apps/web/src/pages/LoginPage.tsx
import { useState, FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Button, Paper, TextField, Typography, Alert, Stack, Link as MuiLink } from "@mui/material";
import { login, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { ThemeToggleButton } from "../theme/ThemeToggleButton";

export function LoginPage() {
  const navigate = useNavigate();
  const { setSession } = useAuth();
  const [tenantSlug, setTenantSlug] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const response = await login({ tenantSlug, email, password });
      setSession(response);
      navigate("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao conectar com o servidor.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh", bgcolor: "background.default", position: "relative" }}>
      <Box sx={{ position: "absolute", top: 8, right: 8 }}><ThemeToggleButton /></Box>
      <Paper elevation={2} sx={{ p: 4, width: 360 }}>
        <Typography variant="h5" gutterBottom>
          Filitech ERP
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Entre com o identificador da sua empresa.
        </Typography>
        <form onSubmit={handleSubmit}>
          <Stack spacing={2}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label="Identificador (slug)"
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
            <TextField
              label="Senha"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              fullWidth
            />
            <Button type="submit" variant="contained" disabled={loading} fullWidth>
              {loading ? "Entrando..." : "Entrar"}
            </Button>
            <Typography variant="body2" align="center">
              Não tem conta? <MuiLink href="/signup">Criar empresa</MuiLink>
            </Typography>
          </Stack>
        </form>
      </Paper>
    </Box>
  );
}

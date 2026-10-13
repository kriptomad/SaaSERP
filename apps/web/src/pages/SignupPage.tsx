// apps/web/src/pages/SignupPage.tsx
import { useState, FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Button, Paper, TextField, Typography, Alert, Stack, MenuItem } from "@mui/material";
import { signup, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { ThemeToggleButton } from "../theme/ThemeToggleButton";

const TENANT_TYPES = [
  { value: "BUSINESS", label: "Empresa (loja/comércio)" },
  { value: "PERSONAL", label: "Filitech Pessoal (controle de gastos de casa)" },
  { value: "ACCOUNTING_OFFICE", label: "Escritório de contabilidade" },
];

export function SignupPage() {
  const navigate = useNavigate();
  const { setSession } = useAuth();
  const [form, setForm] = useState({
    legalName: "",
    tradeName: "",
    slug: "",
    cnpj: "",
    tenantType: "BUSINESS" as "BUSINESS" | "PERSONAL" | "ACCOUNTING_OFFICE",
    ownerName: "",
    ownerEmail: "",
    ownerPassword: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const response = await signup({ ...form, cnpj: form.cnpj || undefined });
      setSession(response);
      navigate("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao conectar com o servidor.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh", bgcolor: "background.default", py: 4, position: "relative" }}>
      <Box sx={{ position: "absolute", top: 8, right: 8 }}><ThemeToggleButton /></Box>
      <Paper elevation={2} sx={{ p: 4, width: 420 }}>
        <Typography variant="h5" gutterBottom>
          Criar espaço Filitech
        </Typography>
        <form onSubmit={handleSubmit}>
          <Stack spacing={2}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              select
              label="Tipo de espaço"
              value={form.tenantType}
              onChange={(e) => set("tenantType", e.target.value as typeof form.tenantType)}
              fullWidth
            >
              {TENANT_TYPES.map((opt) => (
                <MenuItem key={opt.value} value={opt.value}>
                  {opt.label}
                </MenuItem>
              ))}
            </TextField>
            <TextField label="Razão social" value={form.legalName} onChange={(e) => set("legalName", e.target.value)} required fullWidth />
            <TextField label="Nome fantasia" value={form.tradeName} onChange={(e) => set("tradeName", e.target.value)} required fullWidth />
            <TextField label="Identificador (slug)" value={form.slug} onChange={(e) => set("slug", e.target.value)} required fullWidth />
            {form.tenantType === "BUSINESS" && (
              <TextField label="CNPJ" value={form.cnpj} onChange={(e) => set("cnpj", e.target.value)} required fullWidth />
            )}
            <TextField label="Seu nome" value={form.ownerName} onChange={(e) => set("ownerName", e.target.value)} required fullWidth />
            <TextField
              label="Seu e-mail"
              type="email"
              value={form.ownerEmail}
              onChange={(e) => set("ownerEmail", e.target.value)}
              required
              fullWidth
            />
            <TextField
              label="Senha"
              type="password"
              value={form.ownerPassword}
              onChange={(e) => set("ownerPassword", e.target.value)}
              required
              fullWidth
              helperText="Mínimo 8 caracteres"
            />
            <Button type="submit" variant="contained" disabled={loading} fullWidth>
              {loading ? "Criando..." : "Criar espaço"}
            </Button>
          </Stack>
        </form>
      </Paper>
    </Box>
  );
}

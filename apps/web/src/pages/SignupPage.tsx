// apps/web/src/pages/SignupPage.tsx
import { useState, FormEvent } from "react";
import { useNavigate, Link as RouterLink } from "react-router-dom";
import { Box, Button, Paper, TextField, Typography, Alert, Stack, MenuItem, FormControlLabel, Checkbox, Link as MuiLink } from "@mui/material";
import { signup, lookupCnpj, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { ThemeToggleButton } from "../theme/ThemeToggleButton";
import { formatCnpjMask, isValidCnpj, normalizeCnpj } from "../shared/validation/br-documents";
import { validatePasswordPolicy } from "../shared/validation/password-strength";
import { PasswordStrengthMeter } from "../shared/validation/PasswordStrengthMeter";

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
  const [cnpjLookupLoading, setCnpjLookupLoading] = useState(false);
  const [cnpjLookupNotice, setCnpjLookupNotice] = useState<string | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  // GAP DE AUDITORIA FECHADO (Mega-Audit Rodada 2, item 10): ao sair do campo CNPJ
  // com um valor numericamente válido, consulta a BrasilAPI (Receita Federal) e
  // autopreenche razão social/nome fantasia SE o usuário ainda não os tiver
  // digitado manualmente — nunca sobrescreve um valor já preenchido pelo usuário.
  // Falha de rede/CNPJ não encontrado nunca bloqueia o cadastro: a consulta é só
  // uma conveniência, o preenchimento manual continua sempre possível.
  async function handleCnpjBlur() {
    const digits = normalizeCnpj(form.cnpj);
    if (form.tenantType !== "BUSINESS" || digits.length !== 14 || !isValidCnpj(form.cnpj)) return;
    setCnpjLookupLoading(true);
    setCnpjLookupNotice(null);
    try {
      const result = await lookupCnpj(digits);
      setForm((prev) => ({
        ...prev,
        legalName: prev.legalName || result.razao_social || prev.legalName,
        tradeName: prev.tradeName || result.nome_fantasia || prev.tradeName,
      }));
      if (result.descricao_situacao_cadastral && result.descricao_situacao_cadastral.toUpperCase() !== "ATIVA") {
        setCnpjLookupNotice(`Atenção: situação cadastral na Receita Federal é "${result.descricao_situacao_cadastral}".`);
      } else {
        setCnpjLookupNotice("Dados preenchidos a partir do CNPJ (Receita Federal).");
      }
    } catch (err) {
      // Silencioso de propósito: CNPJ não encontrado/API fora do ar não deve travar
      // o cadastro, apenas deixar de autopreencher.
      setCnpjLookupNotice(err instanceof ApiError ? null : null);
    } finally {
      setCnpjLookupLoading(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (form.tenantType === "BUSINESS" && !isValidCnpj(form.cnpj)) {
      setError("CNPJ inválido — confira os números digitados.");
      return;
    }
    const passwordPolicy = validatePasswordPolicy(form.ownerPassword);
    if (!passwordPolicy.valid) {
      setError(passwordPolicy.errors.join(" "));
      return;
    }
    if (!termsAccepted) {
      setError("É necessário aceitar os Termos de Uso e a Política de Privacidade para criar uma conta.");
      return;
    }

    setLoading(true);
    try {
      const response = await signup({ ...form, cnpj: form.cnpj ? normalizeCnpj(form.cnpj) : undefined, termsAccepted: true as const });
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
              <TextField
                label="CNPJ"
                value={form.cnpj}
                onChange={(e) => set("cnpj", formatCnpjMask(e.target.value))}
                onBlur={handleCnpjBlur}
                required
                fullWidth
                placeholder="XX.XXX.XXX/XXXX-XX"
                error={form.cnpj.length > 0 && normalizeCnpj(form.cnpj).length === 14 && !isValidCnpj(form.cnpj)}
                helperText={
                  form.cnpj.length > 0 && normalizeCnpj(form.cnpj).length === 14 && !isValidCnpj(form.cnpj)
                    ? "CNPJ inválido — confira os números digitados."
                    : cnpjLookupLoading
                      ? "Consultando Receita Federal..."
                      : cnpjLookupNotice ?? "Aceita CNPJ numérico tradicional ou o novo formato alfanumérico da Receita Federal."
                }
              />
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
              helperText="Mínimo 8 caracteres e 1 caractere especial (ex.: ! @ # $ % & *)"
            />
            <PasswordStrengthMeter password={form.ownerPassword} />
            <FormControlLabel
              control={<Checkbox checked={termsAccepted} onChange={(e) => setTermsAccepted(e.target.checked)} required />}
              label={
                <Typography variant="body2">
                  Li e aceito os{" "}
                  <MuiLink component={RouterLink} to="/termos" target="_blank" rel="noopener">
                    Termos de Uso
                  </MuiLink>{" "}
                  e a{" "}
                  <MuiLink component={RouterLink} to="/privacidade" target="_blank" rel="noopener">
                    Política de Privacidade
                  </MuiLink>
                </Typography>
              }
            />
            <Button type="submit" variant="contained" disabled={loading || !termsAccepted} fullWidth>
              {loading ? "Criando..." : "Criar espaço"}
            </Button>
          </Stack>
        </form>
      </Paper>
    </Box>
  );
}

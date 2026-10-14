// apps/web/src/modules/platform-admin/PlatformAdminLoginPage.tsx
// Fluxo completo de login do painel de administração de plataforma: senha ->
// enrollment de 2FA obrigatório (primeiro acesso) ou verificação de 2FA (acessos
// seguintes) -> sessão. Espelha exatamente os três estágios reais do backend
// (platform-admin-auth.routes.ts): 2FA_ENROLLMENT_REQUIRED, 2FA_VERIFICATION_REQUIRED,
// sessão concluída. Nenhum estágio é pulado ou simulado.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Box, Button, Paper, Stack, TextField, Typography } from "@mui/material";
import { platformAdminRequest } from "./platform-admin-client";
import { usePlatformAdminAuth } from "./PlatformAdminAuthContext";

type Stage =
  | { name: "credentials" }
  | { name: "2fa-enroll"; enrollToken: string; otpAuthUrl: string }
  | { name: "2fa-enroll-confirm"; enrollToken: string }
  | { name: "2fa-verify"; verifyToken: string };

export function PlatformAdminLoginPage() {
  const navigate = useNavigate();
  const { setSession } = usePlatformAdminAuth();
  const [stage, setStage] = useState<Stage>({ name: "credentials" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [backupCode, setBackupCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin() {
    setLoading(true);
    setError(null);
    try {
      const result = await platformAdminRequest<{
        data: { stage: "2FA_ENROLLMENT_REQUIRED" | "2FA_VERIFICATION_REQUIRED"; enrollToken?: string; verifyToken?: string };
      }>("/platform-admin/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });

      if (result.data.stage === "2FA_ENROLLMENT_REQUIRED") {
        const enrollResult = await platformAdminRequest<{ data: { otpAuthUrl: string } }>(
          "/platform-admin/auth/2fa/enroll",
          { method: "POST" },
          result.data.enrollToken,
        );
        setStage({ name: "2fa-enroll", enrollToken: result.data.enrollToken!, otpAuthUrl: enrollResult.data.otpAuthUrl });
      } else {
        setStage({ name: "2fa-verify", verifyToken: result.data.verifyToken! });
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirmEnrollment(enrollToken: string) {
    setLoading(true);
    setError(null);
    try {
      const result = await platformAdminRequest<{ data: { backupCodes: string[] } }>(
        "/platform-admin/auth/2fa/confirm",
        { method: "POST", body: JSON.stringify({ totpCode }) },
        enrollToken,
      );
      setBackupCodes(result.data.backupCodes);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify(verifyToken: string) {
    setLoading(true);
    setError(null);
    try {
      const result = await platformAdminRequest<{
        data: { token: string; admin: { id: string; name: string; email: string; role: "SUPER_ADMIN" | "SUPPORT_AGENT" | "FINANCE_ANALYST" } };
      }>(
        "/platform-admin/auth/2fa/verify",
        { method: "POST", body: JSON.stringify({ totpCode: totpCode || undefined, backupCode: backupCode || undefined }) },
        verifyToken,
      );
      setSession(result.data.token, result.data.admin);
      navigate("/platform-admin/infraestrutura", { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Box sx={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", bgcolor: "background.default" }}>
      <Paper sx={{ p: 4, width: 420 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Painel de Administração de Plataforma
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {stage.name === "credentials" && (
          <Stack spacing={2}>
            <TextField label="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} fullWidth />
            <TextField label="Senha" type="password" value={password} onChange={(e) => setPassword(e.target.value)} fullWidth />
            <Button variant="contained" disabled={loading || !email || !password} onClick={handleLogin}>
              {loading ? "Entrando..." : "Entrar"}
            </Button>
          </Stack>
        )}

        {stage.name === "2fa-enroll" && !backupCodes && (
          <Stack spacing={2}>
            <Alert severity="info">
              Primeiro acesso: configure o aplicativo autenticador (Google Authenticator, Authy etc.) escaneando o QR
              abaixo ou inserindo manualmente a URL de configuração.
            </Alert>
            <Typography variant="body2" sx={{ wordBreak: "break-all" }}>
              {stage.otpAuthUrl}
            </Typography>
            <TextField label="Código de 6 dígitos do app" value={totpCode} onChange={(e) => setTotpCode(e.target.value)} fullWidth />
            <Button variant="contained" disabled={loading || totpCode.length !== 6} onClick={() => handleConfirmEnrollment(stage.enrollToken)}>
              {loading ? "Confirmando..." : "Confirmar 2FA"}
            </Button>
          </Stack>
        )}

        {stage.name === "2fa-enroll" && backupCodes && (
          <Stack spacing={2}>
            <Alert severity="warning">
              Guarde estes códigos de backup em local seguro — cada um pode ser usado apenas uma vez caso perca acesso
              ao aplicativo autenticador. Eles não serão mostrados novamente.
            </Alert>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Stack spacing={0.5}>
                {backupCodes.map((code) => (
                  <Typography key={code} variant="body2" sx={{ fontFamily: "monospace" }}>
                    {code}
                  </Typography>
                ))}
              </Stack>
            </Paper>
            <Button variant="contained" onClick={() => setStage({ name: "credentials" })}>
              Concluir e fazer login
            </Button>
          </Stack>
        )}

        {stage.name === "2fa-verify" && (
          <Stack spacing={2}>
            <TextField label="Código de 6 dígitos do app" value={totpCode} onChange={(e) => setTotpCode(e.target.value)} fullWidth />
            <Typography variant="caption" color="text.secondary">
              Ou, se não tiver acesso ao app, use um código de backup:
            </Typography>
            <TextField label="Código de backup" value={backupCode} onChange={(e) => setBackupCode(e.target.value)} fullWidth />
            <Button variant="contained" disabled={loading || (!totpCode && !backupCode)} onClick={() => handleVerify(stage.verifyToken)}>
              {loading ? "Verificando..." : "Verificar e entrar"}
            </Button>
          </Stack>
        )}
      </Paper>
    </Box>
  );
}

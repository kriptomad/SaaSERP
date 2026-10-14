// apps/desktop/src/screens/LicenseActivation.tsx
// Ativação de licença mestra (Capítulo 2.10). Consome POST /auth/login (mesmo endpoint
// do apps/web — login do usuário de sistema do tenant), POST /licensing/trial e
// POST /licensing/activate de apps/api/src/modules/licensing/. Todas as rotas de
// licenciamento exigem sessão autenticada (`requireAuth`), por isso o onboarding
// sempre pede login ANTES de oferecer trial/ativação — sem isso as chamadas
// retornariam 401. Se o módulo de licenciamento falhar (ex. backend desatualizado),
// mostra o erro real da API e permite seguir mesmo assim, sem travar o onboarding.
import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Alert from "@mui/material/Alert";
import { getDesktopApi, type TenantSessionCache } from "../api/desktopApi";

export function LicenseActivation({ onComplete }: { onComplete: () => void }) {
  const [session, setSession] = useState<TenantSessionCache | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);

  useEffect(() => {
    getDesktopApi()
      .config.get()
      .then((config) => {
        setSession(config.session);
        setLoadingConfig(false);
      });
  }, []);

  if (loadingConfig) return null;

  if (!session) {
    return <LoginStage onLoggedIn={setSession} />;
  }

  return <LicenseStage session={session} onComplete={onComplete} onLogout={() => setSession(null)} />;
}

function LoginStage({ onLoggedIn }: { onLoggedIn: (session: TenantSessionCache) => void }) {
  const [tenantSlug, setTenantSlug] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin() {
    setBusy(true);
    setError(null);
    const result = await getDesktopApi().auth.login({ tenantSlug, email, password });
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    onLoggedIn(result);
  }

  return (
    <Box sx={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", p: 4 }}>
      <Stack spacing={3} sx={{ maxWidth: 420, width: "100%" }}>
        <Typography variant="h5">Entrar com o usuário de sistema</Typography>
        <Typography variant="body2" color="text.secondary">
          Use o mesmo identificador da empresa (slug), e-mail e senha do Filitech ERP web — Owner ou
          qualquer usuário criado por ele (vendedor, estoquista, etc.). A licença mestra deste
          dispositivo é vinculada ao tenant desta conta.
        </Typography>
        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="Identificador da loja (slug)" value={tenantSlug} onChange={(e) => setTenantSlug(e.target.value)} fullWidth />
          <TextField label="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} fullWidth />
          <TextField label="Senha" type="password" value={password} onChange={(e) => setPassword(e.target.value)} fullWidth />
          <Button
            variant="contained"
            size="large"
            onClick={handleLogin}
            disabled={busy || !tenantSlug || !email || !password}
          >
            {busy ? "Entrando..." : "Entrar"}
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
}

function LicenseStage({
  session,
  onComplete,
  onLogout,
}: {
  session: TenantSessionCache;
  onComplete: () => void;
  onLogout: () => void;
}) {
  const [tab, setTab] = useState<"TRIAL" | "ACTIVATE">("TRIAL");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleTrial() {
    setBusy(true);
    setError(null);
    const result = await getDesktopApi().license.trial();
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    onComplete();
  }

  async function handleActivate() {
    setBusy(true);
    setError(null);
    const result = await getDesktopApi().license.activate();
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    onComplete();
  }

  return (
    <Box sx={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", p: 4 }}>
      <Stack spacing={3} sx={{ maxWidth: 480, width: "100%" }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="h5">Ativação de licença</Typography>
          <Button size="small" onClick={() => getDesktopApi().auth.logout().then(onLogout)}>
            Trocar de conta
          </Button>
        </Stack>
        <Typography variant="body2" color="text.secondary">
          Conectado como <strong>{session.user.name}</strong> ({session.user.role}) — loja{" "}
          <strong>{session.tenant.tradeName}</strong>.
        </Typography>
        <Tabs value={tab} onChange={(_e, value) => setTab(value)}>
          <Tab value="TRIAL" label="Testar grátis (15 dias)" />
          <Tab value="ACTIVATE" label="Ativar este dispositivo" />
        </Tabs>

        {tab === "TRIAL" ? (
          <Stack spacing={2}>
            <Typography variant="body2">
              Concede uma licença mestra trial de 15 dias para o tenant <strong>{session.tenant.tradeName}</strong> (uma
              única vez) e já ativa este dispositivo para uso offline dentro da janela de validade.
            </Typography>
            <Button variant="contained" size="large" onClick={handleTrial} disabled={busy}>
              {busy ? "Ativando trial..." : "Iniciar trial de 15 dias"}
            </Button>
          </Stack>
        ) : (
          <Stack spacing={2}>
            <Typography variant="body2">
              Emite um token offline de curta duração para este dispositivo específico, usando a licença
              mestra já ativa/paga do tenant.
            </Typography>
            <Button variant="contained" size="large" onClick={handleActivate} disabled={busy}>
              {busy ? "Ativando..." : "Ativar este dispositivo"}
            </Button>
          </Stack>
        )}

        {error && (
          <Alert severity="warning">
            {error}
            <Box sx={{ mt: 1 }}>
              <Button size="small" onClick={onComplete}>
                Prosseguir mesmo assim
              </Button>
            </Box>
          </Alert>
        )}
      </Stack>
    </Box>
  );
}


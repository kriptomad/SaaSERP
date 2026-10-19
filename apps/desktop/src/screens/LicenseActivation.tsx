// apps/desktop/src/screens/LicenseActivation.tsx
// Ativação de licença mestra (Capítulo 2.10). Consome POST /auth/login (mesmo endpoint
// do apps/web — login do usuário de sistema do tenant), POST /licensing/trial e
// POST /licensing/activate de apps/api/src/modules/licensing/. Todas as rotas de
// licenciamento exigem sessão autenticada (`requireAuth`), por isso o onboarding
// sempre pede login ANTES de oferecer trial/ativação — sem isso as chamadas
// retornariam 401.
//
// CORREÇÃO DE AUDITORIA (fa-desktop-bypass-no-license): o botão "Prosseguir mesmo
// assim" (que chamava `onComplete()` mesmo com erro de licenciamento) foi REMOVIDO.
// Nenhum caminho nesta tela chama `onComplete()` sem uma resposta de sucesso real de
// `license.trial()`/`license.activate()` — o main process (ver `main.ts`,
// `CONFIG_SET_ONBOARDING_COMPLETE`) também rejeita a conclusão do onboarding sem
// `config.license` presente, como defesa em profundidade.
import { useCallback, useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import { getDesktopApi, type TenantSessionCache } from "../api/desktopApi";

type LoadState = "LOADING" | "READY" | "ERROR";

export function LicenseActivation({ onComplete }: { onComplete: () => void }) {
  const [session, setSession] = useState<TenantSessionCache | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("LOADING");
  const [loadError, setLoadError] = useState<string | null>(null);

  // CORREÇÃO DE AUDITORIA (fa-desktop-license-screen-blank-on-error): antes, uma
  // rejeição de `config.get()` deixava a tela em branco para sempre (nenhum catch,
  // `loadingConfig` nunca virava false). Agora qualquer falha leva a um estado de
  // erro explícito com botão de nova tentativa.
  const load = useCallback(() => {
    setLoadState("LOADING");
    setLoadError(null);
    getDesktopApi()
      .config.get()
      .then((config) => {
        setSession(config.session);
        setLoadState("READY");
      })
      .catch((error: unknown) => {
        setLoadError(error instanceof Error ? error.message : "Falha ao carregar configuração.");
        setLoadState("ERROR");
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loadState === "LOADING") {
    return (
      <Box sx={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <CircularProgress />
      </Box>
    );
  }

  if (loadState === "ERROR") {
    return (
      <Box sx={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", p: 4 }}>
        <Stack spacing={2} sx={{ maxWidth: 420, width: "100%" }}>
          <Alert severity="error">{loadError}</Alert>
          <Button variant="contained" onClick={load}>
            Tentar novamente
          </Button>
        </Stack>
      </Box>
    );
  }

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
  // CORREÇÃO DE AUDITORIA (fa-desktop-login-double-submit): guarda síncrona em ref,
  // além do `disabled={busy}` do botão — evita cliques/Enter duplos que disparariam
  // duas chamadas de login antes do primeiro re-render que desabilita o botão. O
  // main process também serializa por chave (`withMutex`), mas a guarda na UI evita
  // round-trips de IPC desnecessários e feedback inconsistente.
  const submittingRef = useRef(false);

  async function handleLogin() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await getDesktopApi().auth.login({ tenantSlug, email, password });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      onLoggedIn(result);
    } catch (err) {
      // CORREÇÃO DE AUDITORIA (fa-desktop-login-trial-stuck-busy): qualquer rejeição
      // de promise (timeout de rede, erro inesperado) agora cai aqui em vez de deixar
      // a exceção não tratada e o estado `busy` travado em `true` para sempre.
      setError(err instanceof Error ? err.message : "Falha ao entrar. Verifique a conexão e tente novamente.");
    } finally {
      setBusy(false);
      submittingRef.current = false;
    }
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
  const submittingRef = useRef(false);

  async function handleTrial() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await getDesktopApi().license.trial();
      if ("error" in result) {
        setError(result.error);
        return;
      }
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao iniciar o trial. Verifique a conexão e tente novamente.");
    } finally {
      setBusy(false);
      submittingRef.current = false;
    }
  }

  async function handleActivate() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await getDesktopApi().license.activate();
      if ("error" in result) {
        setError(result.error);
        return;
      }
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao ativar o dispositivo. Verifique a conexão e tente novamente.");
    } finally {
      setBusy(false);
      submittingRef.current = false;
    }
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

        {error && <Alert severity="error">{error}</Alert>}
      </Stack>
    </Box>
  );
}

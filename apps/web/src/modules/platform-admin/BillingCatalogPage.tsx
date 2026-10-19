// apps/web/src/modules/platform-admin/BillingCatalogPage.tsx
// Capítulo 2.9/13.3 — catálogo de planos de assinatura e módulos à la carte de
// billing (preço/mês, não confundir com o rollout de feature flags gerenciado em
// ModuleCatalogPage.tsx).
// GAP DE AUDITORIA FECHADO (mega-audit rodada 8): o CRUD completo de `Plan`/`Module`
// já existia no backend desde a rodada anterior (substituindo o seed script como
// única forma de criar/editar planos e módulos), mas nenhuma tela do painel de
// plataforma o consumia — o dono do SaaS dependia de acesso direto ao banco para
// lançar um novo plano ou ajustar o preço de um módulo.
import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Paper,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  MenuItem,
} from "@mui/material";
import { usePlatformAdminAuth } from "./PlatformAdminAuthContext";
import { PlatformAdminConfirmDialog } from "./PlatformAdminConfirmDialog";
import {
  listPlans,
  createPlan,
  updatePlan,
  PlanSummary,
  listBillingModules,
  createBillingModule,
  updateBillingModule,
  BillingModuleSummary,
} from "./platform-admin-ops.api";

function money(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function NewPlanForm({ onCreated }: { onCreated: (plan: PlanSummary) => void }) {
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [basePrice, setBasePrice] = useState(0);
  const [audience, setAudience] = useState<PlanSummary["audience"]>("BUSINESS");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setSaving(true);
    setError(null);
    try {
      const plan = await createPlan({
        code,
        label,
        basePrice,
        includedModules: [],
        active: true,
        audience,
        maxConnectedAccounts: null,
        includedUserSeats: null,
        extraUserSeatPrice: null,
      });
      onCreated(plan);
      setCode("");
      setLabel("");
      setBasePrice(0);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Paper sx={{ p: 2, mb: 3 }}>
      <Typography variant="subtitle1" sx={{ mb: 2 }}>Novo plano</Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
        <TextField label="Código (ex.: BUSINESS_PRO)" size="small" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} sx={{ minWidth: 220 }} />
        <TextField label="Nome exibido" size="small" value={label} onChange={(e) => setLabel(e.target.value)} sx={{ minWidth: 220 }} />
        <TextField label="Preço base (R$/mês)" type="number" size="small" value={basePrice} onChange={(e) => setBasePrice(Number(e.target.value))} sx={{ minWidth: 160 }} />
        <TextField select label="Público" size="small" value={audience} onChange={(e) => setAudience(e.target.value as PlanSummary["audience"])} sx={{ minWidth: 160 }}>
          <MenuItem value="BUSINESS">Empresas</MenuItem>
          <MenuItem value="PERSONAL">Pessoa física</MenuItem>
          <MenuItem value="BOTH">Ambos</MenuItem>
        </TextField>
      </Stack>
      <Button variant="contained" sx={{ mt: 2 }} disabled={saving || !code || !label} onClick={handleCreate}>Criar plano</Button>
    </Paper>
  );
}

function PlansSection() {
  const { admin } = usePlatformAdminAuth();
  const canEdit = admin?.role === "SUPER_ADMIN";
  const [plans, setPlans] = useState<PlanSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingToggle, setPendingToggle] = useState<PlanSummary | null>(null);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    listPlans().then(setPlans).catch((err) => setError((err as Error).message));
  }, []);

  function applyUpdated(updated: PlanSummary) {
    setPlans((prev) => prev?.map((p) => (p.id === updated.id ? updated : p)) ?? null);
  }

  async function confirmToggleActive() {
    if (!pendingToggle) return;
    setToggling(true);
    try {
      applyUpdated(await updatePlan(pendingToggle.id, { active: !pendingToggle.active }));
      setPendingToggle(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setToggling(false);
    }
  }

  return (
    <Box sx={{ mb: 5 }}>
      <Typography variant="h6" sx={{ mb: 2 }}>Planos de assinatura</Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {canEdit && <NewPlanForm onCreated={(p) => setPlans((prev) => [p, ...(prev ?? [])])} />}
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Código</TableCell>
              <TableCell>Nome</TableCell>
              <TableCell align="right">Preço base</TableCell>
              <TableCell>Público</TableCell>
              <TableCell align="right">Seats inclusos</TableCell>
              <TableCell align="right">Seat extra</TableCell>
              <TableCell>Ativo</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(plans ?? []).map((plan) => (
              <TableRow key={plan.id}>
                <TableCell>{plan.code}</TableCell>
                <TableCell>{plan.label}</TableCell>
                <TableCell align="right">{money(plan.basePrice)}</TableCell>
                <TableCell>{plan.audience}</TableCell>
                <TableCell align="right">{plan.includedUserSeats ?? "—"}</TableCell>
                <TableCell align="right">{plan.extraUserSeatPrice !== null ? money(plan.extraUserSeatPrice) : "—"}</TableCell>
                <TableCell><Switch size="small" checked={plan.active} disabled={!canEdit} onChange={() => setPendingToggle(plan)} /></TableCell>
              </TableRow>
            ))}
            {plans && plans.length === 0 && <TableRow><TableCell colSpan={7}>Nenhum plano cadastrado.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </TableContainer>
      <PlatformAdminConfirmDialog
        open={pendingToggle != null}
        title={pendingToggle?.active ? "Desativar plano?" : "Ativar plano?"}
        description={
          pendingToggle?.active
            ? "Tenants em assinaturas ACTIVE neste plano continuam cobrados normalmente, mas o plano deixa de poder ser contratado por novos tenants."
            : "O plano volta a ficar disponível para contratação por novos tenants imediatamente."
        }
        impact={pendingToggle ? [
          { label: "Plano", value: `${pendingToggle.code} — ${pendingToggle.label}` },
          { label: "Estado atual", value: pendingToggle.active ? "Ativo" : "Inativo" },
          { label: "Novo estado", value: pendingToggle.active ? "Inativo" : "Ativo" },
          { label: "Preço base", value: money(pendingToggle.basePrice) },
        ] : []}
        confirmLabel={pendingToggle?.active ? "Desativar" : "Ativar"}
        danger={pendingToggle?.active}
        busy={toggling}
        onConfirm={confirmToggleActive}
        onClose={() => setPendingToggle(null)}
      />
    </Box>
  );
}

function NewModuleForm({ onCreated }: { onCreated: (module: BillingModuleSummary) => void }) {
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [monthlyPrice, setMonthlyPrice] = useState(0);
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setSaving(true);
    setError(null);
    try {
      const created = await createBillingModule({ code, label, monthlyPrice, description, active: true });
      onCreated(created);
      setCode("");
      setLabel("");
      setMonthlyPrice(0);
      setDescription("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Paper sx={{ p: 2, mb: 3 }}>
      <Typography variant="subtitle1" sx={{ mb: 2 }}>Novo módulo à la carte</Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
        <TextField label="Código (ex.: WORK_ORDER)" size="small" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} sx={{ minWidth: 220 }} />
        <TextField label="Nome exibido" size="small" value={label} onChange={(e) => setLabel(e.target.value)} sx={{ minWidth: 220 }} />
        <TextField label="Preço (R$/mês)" type="number" size="small" value={monthlyPrice} onChange={(e) => setMonthlyPrice(Number(e.target.value))} sx={{ minWidth: 160 }} />
        <TextField label="Descrição" size="small" value={description} onChange={(e) => setDescription(e.target.value)} sx={{ minWidth: 300 }} />
      </Stack>
      <Button variant="contained" sx={{ mt: 2 }} disabled={saving || !code || !label || !description} onClick={handleCreate}>Criar módulo</Button>
    </Paper>
  );
}

function ModulesSection() {
  const { admin } = usePlatformAdminAuth();
  const canEdit = admin?.role === "SUPER_ADMIN";
  const [modules, setModules] = useState<BillingModuleSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingToggle, setPendingToggle] = useState<BillingModuleSummary | null>(null);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    listBillingModules().then(setModules).catch((err) => setError((err as Error).message));
  }, []);

  function applyUpdated(updated: BillingModuleSummary) {
    setModules((prev) => prev?.map((m) => (m.id === updated.id ? updated : m)) ?? null);
  }

  async function confirmToggleActive() {
    if (!pendingToggle) return;
    setToggling(true);
    try {
      applyUpdated(await updateBillingModule(pendingToggle.id, { active: !pendingToggle.active }));
      setPendingToggle(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setToggling(false);
    }
  }

  return (
    <Box>
      <Typography variant="h6" sx={{ mb: 2 }}>Módulos à la carte (preço/mês)</Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {canEdit && <NewModuleForm onCreated={(m) => setModules((prev) => [m, ...(prev ?? [])])} />}
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Código</TableCell>
              <TableCell>Nome</TableCell>
              <TableCell>Descrição</TableCell>
              <TableCell align="right">Preço/mês</TableCell>
              <TableCell>Ativo</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(modules ?? []).map((module) => (
              <TableRow key={module.id}>
                <TableCell>{module.code}</TableCell>
                <TableCell>{module.label}</TableCell>
                <TableCell>{module.description}</TableCell>
                <TableCell align="right">{money(module.monthlyPrice)}</TableCell>
                <TableCell><Switch size="small" checked={module.active} disabled={!canEdit} onChange={() => setPendingToggle(module)} /></TableCell>
              </TableRow>
            ))}
            {modules && modules.length === 0 && <TableRow><TableCell colSpan={5}>Nenhum módulo de billing cadastrado.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </TableContainer>
      <PlatformAdminConfirmDialog
        open={pendingToggle != null}
        title={pendingToggle?.active ? "Desativar módulo do catálogo?" : "Ativar módulo do catálogo?"}
        description={
          pendingToggle?.active
            ? "Esta ação invalida IMEDIATAMENTE o cache Redis de todos os tenants que contratam este módulo, revogando o acesso na hora (não espera o TTL de 60s)."
            : "O módulo volta a ficar disponível para contratação por tenants imediatamente."
        }
        impact={pendingToggle ? [
          { label: "Módulo", value: `${pendingToggle.code} — ${pendingToggle.label}` },
          { label: "Estado atual", value: pendingToggle.active ? "Ativo" : "Inativo" },
          { label: "Novo estado", value: pendingToggle.active ? "Inativo" : "Ativo" },
          { label: "Preço/mês", value: money(pendingToggle.monthlyPrice) },
        ] : []}
        confirmLabel={pendingToggle?.active ? "Desativar" : "Ativar"}
        danger={pendingToggle?.active}
        busy={toggling}
        onConfirm={confirmToggleActive}
        onClose={() => setPendingToggle(null)}
      />
    </Box>
  );
}

export function BillingCatalogPage() {
  return (
    <Box sx={{ p: 3, maxWidth: 1200, mx: "auto" }}>
      <Typography variant="h5" sx={{ mb: 1 }}>Catálogo de planos e módulos de billing</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Fonte única de verdade de preços cobrados dos tenants. Desativar um módulo aqui invalida imediatamente o
        cache de todos os tenants que o contratam — não espera o TTL de 60s do gatekeeper expirar sozinho.
      </Typography>
      <PlansSection />
      <ModulesSection />
    </Box>
  );
}

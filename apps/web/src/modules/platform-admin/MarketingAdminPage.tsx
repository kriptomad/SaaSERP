// apps/web/src/modules/platform-admin/MarketingAdminPage.tsx
// Fonte: BIBLE_ENGINEERING_V2.md — Capítulo 20 (cupons de desconto globais + programa
// de indicações). GAP DE AUDITORIA ENCONTRADO E CORRIGIDO: `marketing.routes.ts` já
// implementava o CRUD completo (cupons/indicações) desde uma rodada anterior, mas
// nenhuma tela de administração de plataforma o consumia — o SUPER_ADMIN só
// conseguia operar via chamada HTTP direta. Esta tela fecha o ciclo com UI real.
import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { usePlatformAdminAuth } from "./PlatformAdminAuthContext";
import { PlatformAdminConfirmDialog } from "./PlatformAdminConfirmDialog";
import { marketingAdminApi, DiscountCoupon, DiscountCouponInput, Referral } from "./marketing.api";

const REFERRAL_STATUS_COLOR: Record<Referral["status"], "success" | "warning" | "default"> = {
  CONVERTED: "success",
  PENDING: "warning",
  EXPIRED: "default",
};

function CouponForm({ onCreated }: { onCreated: (coupon: DiscountCoupon) => void }) {
  const [form, setForm] = useState<DiscountCouponInput>({
    code: "",
    discountType: "PERCENTAGE",
    discountValue: 10,
    scopeType: "GLOBAL",
    scopeReferenceId: null,
    maxRedemptions: null,
    validFrom: new Date().toISOString().slice(0, 10),
    validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    active: true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // CORREÇÃO DE AUDITORIA (mega-audit rodada 7): espelha no cliente as mesmas
  // regras de negócio do zod/couponRules em marketing.routes.ts — sem isso, o
  // operador só descobria um erro óbvio (ex.: desconto de 150%, data de término
  // antes da de início, código com espaço) depois de uma viagem de rede inteira
  // ao backend, com uma mensagem genérica. Não substitui a validação do backend
  // (que continua sendo a fonte da verdade), só dá feedback imediato.
  function validateClientSide(): string | null {
    const code = form.code.trim();
    if (code.length < 3 || code.length > 40) return "Código deve ter entre 3 e 40 caracteres.";
    if (!/^[A-Za-z0-9_-]+$/.test(code)) return "Código deve conter apenas letras, números, - e _.";
    if (!(form.discountValue > 0)) return "Valor do desconto deve ser maior que zero.";
    if (form.discountType === "PERCENTAGE" && form.discountValue > 100) return "Desconto percentual não pode passar de 100.";
    if (form.maxRedemptions != null && (!Number.isInteger(form.maxRedemptions) || form.maxRedemptions <= 0)) {
      return "Máx. resgates deve ser um número inteiro maior que zero (ou em branco para ilimitado).";
    }
    if (new Date(form.validUntil) <= new Date(form.validFrom)) return "A data de término deve ser posterior à data de início.";
    if (form.scopeType !== "GLOBAL" && !form.scopeReferenceId?.trim()) {
      return "Informe o code do plano/módulo para escopos PLAN ou MODULE.";
    }
    return null;
  }

  async function handleSubmit() {
    const validationError = validateClientSide();
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await marketingAdminApi.createCoupon({
        ...form,
        scopeReferenceId: form.scopeType === "GLOBAL" ? null : form.scopeReferenceId,
        validFrom: new Date(form.validFrom).toISOString(),
        validUntil: new Date(form.validUntil).toISOString(),
      });
      onCreated(created);
      setForm((f) => ({ ...f, code: "" }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Paper sx={{ p: 2, mb: 3 }}>
      <Typography variant="subtitle1" sx={{ mb: 2 }}>
        Novo cupom de desconto
      </Typography>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
        <TextField
          label="Código"
          size="small"
          value={form.code}
          onChange={(e) => setForm({ ...form, code: e.target.value })}
          sx={{ minWidth: 160 }}
        />
        <TextField
          select
          label="Tipo"
          size="small"
          value={form.discountType}
          onChange={(e) => setForm({ ...form, discountType: e.target.value as DiscountCouponInput["discountType"] })}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="PERCENTAGE">Percentual</MenuItem>
          <MenuItem value="FIXED_AMOUNT">Valor fixo</MenuItem>
        </TextField>
        <TextField
          label="Valor"
          type="number"
          size="small"
          value={form.discountValue}
          onChange={(e) => setForm({ ...form, discountValue: Number(e.target.value) })}
          sx={{ minWidth: 120 }}
        />
        <TextField
          select
          label="Escopo"
          size="small"
          value={form.scopeType}
          onChange={(e) => setForm({ ...form, scopeType: e.target.value as DiscountCouponInput["scopeType"] })}
          sx={{ minWidth: 140 }}
        >
          <MenuItem value="GLOBAL">Global</MenuItem>
          <MenuItem value="PLAN">Plano</MenuItem>
          <MenuItem value="MODULE">Módulo</MenuItem>
        </TextField>
        {form.scopeType !== "GLOBAL" && (
          <TextField
            label="Code do plano/módulo"
            size="small"
            value={form.scopeReferenceId ?? ""}
            onChange={(e) => setForm({ ...form, scopeReferenceId: e.target.value })}
            sx={{ minWidth: 160 }}
          />
        )}
        <TextField
          label="Válido de"
          type="date"
          size="small"
          value={form.validFrom}
          onChange={(e) => setForm({ ...form, validFrom: e.target.value })}
          InputLabelProps={{ shrink: true }}
          sx={{ minWidth: 160 }}
        />
        <TextField
          label="Válido até"
          type="date"
          size="small"
          value={form.validUntil}
          onChange={(e) => setForm({ ...form, validUntil: e.target.value })}
          InputLabelProps={{ shrink: true }}
          sx={{ minWidth: 160 }}
        />
        <TextField
          label="Máx. resgates"
          type="number"
          size="small"
          value={form.maxRedemptions ?? ""}
          onChange={(e) => setForm({ ...form, maxRedemptions: e.target.value ? Number(e.target.value) : null })}
          sx={{ minWidth: 140 }}
        />
      </Stack>
      <Button variant="contained" sx={{ mt: 2 }} disabled={saving || !form.code} onClick={handleSubmit}>
        Criar cupom
      </Button>
    </Paper>
  );
}

function CouponsSection({ canEdit }: { canEdit: boolean }) {
  const [coupons, setCoupons] = useState<DiscountCoupon[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingToggle, setPendingToggle] = useState<DiscountCoupon | null>(null);
  const [toggling, setToggling] = useState(false);

  async function reload() {
    try {
      setCoupons(await marketingAdminApi.listCoupons());
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function confirmToggleActive() {
    if (!pendingToggle) return;
    setToggling(true);
    try {
      const updated = await marketingAdminApi.updateCoupon(pendingToggle.id, { active: !pendingToggle.active });
      setCoupons((prev) => prev?.map((c) => (c.id === updated.id ? updated : c)) ?? null);
      setPendingToggle(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setToggling(false);
    }
  }

  return (
    <Box sx={{ mb: 4 }}>
      <Typography variant="h6" sx={{ mb: 2 }}>
        Cupons de desconto (globais)
      </Typography>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {canEdit && <CouponForm onCreated={(c) => setCoupons((prev) => [c, ...(prev ?? [])])} />}
      {coupons && (
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Código</TableCell>
                <TableCell>Desconto</TableCell>
                <TableCell>Escopo</TableCell>
                <TableCell align="right">Resgates</TableCell>
                <TableCell>Validade</TableCell>
                <TableCell>Status</TableCell>
                {canEdit && <TableCell align="right">Ações</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {coupons.map((coupon) => (
                <TableRow key={coupon.id}>
                  <TableCell>{coupon.code}</TableCell>
                  <TableCell>
                    {coupon.discountType === "PERCENTAGE" ? `${coupon.discountValue}%` : `R$ ${coupon.discountValue}`}
                  </TableCell>
                  <TableCell>
                    {coupon.scopeType}
                    {coupon.scopeReferenceId ? ` (${coupon.scopeReferenceId})` : ""}
                  </TableCell>
                  <TableCell align="right">
                    {coupon.redemptionCount}
                    {coupon.maxRedemptions ? ` / ${coupon.maxRedemptions}` : ""}
                  </TableCell>
                  <TableCell>
                    {new Date(coupon.validFrom).toLocaleDateString("pt-BR")} — {new Date(coupon.validUntil).toLocaleDateString("pt-BR")}
                  </TableCell>
                  <TableCell>
                    <Chip size="small" color={coupon.active ? "success" : "default"} label={coupon.active ? "Ativo" : "Inativo"} />
                  </TableCell>
                  {canEdit && (
                    <TableCell align="right">
                      <Button size="small" onClick={() => setPendingToggle(coupon)}>
                        {coupon.active ? "Desativar" : "Ativar"}
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {coupons.length === 0 && (
                <TableRow>
                  <TableCell colSpan={canEdit ? 7 : 6}>Nenhum cupom cadastrado.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      <PlatformAdminConfirmDialog
        open={pendingToggle != null}
        title={pendingToggle?.active ? "Desativar cupom?" : "Ativar cupom?"}
        description={
          pendingToggle?.active
            ? "O cupom deixa de poder ser resgatado por novos tenants imediatamente. Resgates já aplicados não são revertidos."
            : "O cupom volta a ficar disponível para resgate imediatamente."
        }
        impact={pendingToggle ? [
          { label: "Código", value: pendingToggle.code },
          { label: "Desconto", value: pendingToggle.discountType === "PERCENTAGE" ? `${pendingToggle.discountValue}%` : `R$ ${pendingToggle.discountValue}` },
          { label: "Resgates já aplicados", value: String(pendingToggle.redemptionCount) },
          { label: "Novo estado", value: pendingToggle.active ? "Inativo" : "Ativo" },
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

function ReferralsSection({ canEdit }: { canEdit: boolean }) {
  const [referrals, setReferrals] = useState<Referral[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<{ type: "convert" | "reward"; referral: Referral } | null>(null);
  const [acting, setActing] = useState(false);

  async function reload() {
    try {
      setReferrals(await marketingAdminApi.listReferrals());
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function confirmPendingAction() {
    if (!pendingAction) return;
    setActing(true);
    try {
      const updated =
        pendingAction.type === "convert"
          ? await marketingAdminApi.convertReferral(pendingAction.referral.id)
          : await marketingAdminApi.applyReferralReward(pendingAction.referral.id);
      setReferrals((prev) => prev?.map((r) => (r.id === updated.id ? updated : r)) ?? null);
      setPendingAction(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActing(false);
    }
  }

  return (
    <Box>
      <Typography variant="h6" sx={{ mb: 2 }}>
        Indicações (programa de referral)
      </Typography>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {referrals && (
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Indicado por</TableCell>
                <TableCell>Tenant indicado</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Expira em</TableCell>
                <TableCell>Recompensa</TableCell>
                {canEdit && <TableCell align="right">Ações</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {referrals.map((referral) => (
                <TableRow key={referral.id}>
                  <TableCell>{referral.referralCode.tenant.tradeName} ({referral.referralCode.code})</TableCell>
                  <TableCell>{referral.referredTenant?.tradeName ?? "—"}</TableCell>
                  <TableCell>
                    <Chip size="small" color={REFERRAL_STATUS_COLOR[referral.status]} label={referral.status} />
                  </TableCell>
                  <TableCell>{new Date(referral.expiresAt).toLocaleDateString("pt-BR")}</TableCell>
                  <TableCell>{referral.rewardAppliedAt ? new Date(referral.rewardAppliedAt).toLocaleDateString("pt-BR") : "—"}</TableCell>
                  {canEdit && (
                    <TableCell align="right">
                      {referral.status === "PENDING" && (
                        <Button size="small" onClick={() => setPendingAction({ type: "convert", referral })}>
                          Marcar convertida
                        </Button>
                      )}
                      {referral.status === "CONVERTED" && !referral.rewardAppliedAt && (
                        <Button size="small" onClick={() => setPendingAction({ type: "reward", referral })}>
                          Aplicar recompensa
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {referrals.length === 0 && (
                <TableRow>
                  <TableCell colSpan={canEdit ? 6 : 5}>Nenhuma indicação registrada.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      <PlatformAdminConfirmDialog
        open={pendingAction != null}
        title={pendingAction?.type === "convert" ? "Marcar indicação como convertida?" : "Aplicar recompensa de indicação?"}
        description={
          pendingAction?.type === "convert"
            ? "Confirma que o tenant indicado efetivamente assinou um plano pago? Esta ação atesta a conversão e habilita a aplicação da recompensa financeira em seguida."
            : "Isto aplica crédito de assinatura ao indicador e desconto no primeiro ciclo ao indicado — impacto financeiro real e irreversível em billing."
        }
        impact={pendingAction ? [
          { label: "Indicado por", value: `${pendingAction.referral.referralCode.tenant.tradeName} (${pendingAction.referral.referralCode.code})` },
          { label: "Tenant indicado", value: pendingAction.referral.referredTenant?.tradeName ?? "—" },
          { label: "Status atual", value: pendingAction.referral.status },
        ] : []}
        confirmLabel={pendingAction?.type === "convert" ? "Marcar convertida" : "Aplicar recompensa"}
        requireReason={pendingAction?.type === "reward"}
        danger={pendingAction?.type === "reward"}
        busy={acting}
        onConfirm={confirmPendingAction}
        onClose={() => setPendingAction(null)}
      />
    </Box>
  );
}

export function MarketingAdminPage() {
  const { admin } = usePlatformAdminAuth();
  // requireSuperAdmin no backend é a garantia real; a UI só esconde ações de
  // escrita para quem sabidamente não tem a role (mesmo padrão de InfrastructureSettingsPage).
  const canEdit = admin?.role === "SUPER_ADMIN";

  return (
    <Box sx={{ p: 3, maxWidth: 1200, mx: "auto" }}>
      <Typography variant="h5" sx={{ mb: 1 }}>
        Marketing
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Cupons de desconto globais e conversão/recompensa do programa de indicação entre tenants.
      </Typography>
      <CouponsSection canEdit={canEdit} />
      <ReferralsSection canEdit={canEdit} />
    </Box>
  );
}

// apps/web/src/modules/platform-admin/PlatformAdminShell.tsx
// Layout do painel de administração de plataforma — sessão/visual inteiramente
// separados do AppShell de tenant (Capítulo 14.2).
import { Outlet, useNavigate, Link, useLocation } from "react-router-dom";
import { AppBar, Box, Button, Tab, Tabs, Toolbar, Typography } from "@mui/material";
import { usePlatformAdminAuth } from "./PlatformAdminAuthContext";

const TABS = [
  { path: "/platform-admin/tenants", label: "Tenants" },
  { path: "/platform-admin/receita", label: "Receita (MRR)" },
  { path: "/platform-admin/planos", label: "Planos & Módulos" },
  { path: "/platform-admin/modulos", label: "Feature Flags" },
  { path: "/platform-admin/integracoes", label: "Integrações" },
  { path: "/platform-admin/suporte", label: "Suporte" },
  { path: "/platform-admin/admins", label: "Admins" },
  { path: "/platform-admin/parametros", label: "Parâmetros" },
  { path: "/platform-admin/audit-log", label: "Audit Log" },
  { path: "/platform-admin/backups", label: "Backups" },
  { path: "/platform-admin/infraestrutura", label: "Infraestrutura & Credenciais" },
  { path: "/platform-admin/seguranca", label: "Segurança" },
  { path: "/platform-admin/status", label: "Status do Sistema" },
  { path: "/platform-admin/marketing", label: "Marketing" },
];

export function PlatformAdminShell() {
  const { admin, clearSession } = usePlatformAdminAuth();
  const navigate = useNavigate();
  const location = useLocation();

  function handleLogout() {
    clearSession();
    navigate("/platform-admin/login", { replace: true });
  }

  const currentTab = TABS.find((tab) => location.pathname.startsWith(tab.path))?.path ?? TABS[0].path;

  return (
    <Box sx={{ minHeight: "100vh" }}>
      <AppBar position="static" color="transparent" elevation={1}>
        <Toolbar sx={{ gap: 2 }}>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            Filitech ERP — Administração de Plataforma
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {admin?.name} ({admin?.role})
          </Typography>
          <Button size="small" onClick={handleLogout}>
            Sair
          </Button>
        </Toolbar>
        <Tabs value={currentTab} sx={{ px: 2 }}>
          {TABS.map((tab) => (
            <Tab key={tab.path} value={tab.path} label={tab.label} component={Link} to={tab.path} />
          ))}
        </Tabs>
      </AppBar>
      <Outlet />
    </Box>
  );
}

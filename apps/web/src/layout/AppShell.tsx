// apps/web/src/layout/AppShell.tsx
import { useEffect, useState } from "react";
import { Outlet, NavLink, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AppBar,
  Box,
  Button,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Toolbar,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import MenuIcon from "@mui/icons-material/Menu";
import LogoutIcon from "@mui/icons-material/Logout";
import SearchIcon from "@mui/icons-material/Search";
import { useAuth } from "../auth/AuthContext";
import { ThemeToggleButton } from "../theme/ThemeToggleButton";
import { fetchActiveModules } from "../api/client";
import { NAV_GROUPS } from "./navigation";
import { NotificationBell } from "../modules/notifications/NotificationBell";
import { CommandPalette } from "../shared/CommandPalette";
import { ImpersonationBanner } from "./ImpersonationBanner";

const DRAWER_WIDTH = 248;

export function AppShell() {
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up("md"));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { pathname } = useLocation();
  const { tenant, user, clearSession } = useAuth();

  // Capítulo 4/11 — feature-flipping por nicho: NavItems com `moduleCode`/`moduleCodes`
  // só aparecem se o(s) módulo(s) correspondente(s) estiver(em) ativo(s) para o tenant
  // (ex.: WORK_ORDER, OPTICAL_LAB, FASHION_VARIANTS). `moduleCodes` casa por "QUALQUER
  // UM" (item compartilhado por mais de um nicho). Itens sem `moduleCode`/`moduleCodes`
  // (Geral, Mercado, Varejo Geral etc.) ficam sempre visíveis — não há módulo pago
  // dedicado para esses dois nichos (Capítulo 2.6). GAP DE AUDITORIA FECHADO: antes
  // desta correção, vários NavItems de nicho (Ótica, Moda, Papelaria, Construção,
  // Setor Automotivo, Prontuários, O.S./Agenda) não tinham `moduleCode` nenhum e por
  // isso apareciam para QUALQUER tenant, mesmo sem o módulo contratado.
  const activeModulesQuery = useQuery({
    queryKey: ["billing", "active-modules"],
    queryFn: fetchActiveModules,
    enabled: Boolean(user),
    staleTime: 60_000,
  });
  const activeModuleCodes = activeModulesQuery.data?.moduleCodes ?? [];

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // GAP DE AUDITORIA FECHADO (Capítulo 21.18.6/22.1): filtro por Tenant.tenantType —
  // aplicado ANTES de montar os itens do grupo, pois grupos inteiros de varejo (PDV,
  // Estoque, nichos) não fazem sentido para um escritório de contabilidade
  // (ACCOUNTING_OFFICE) nem para uma residência (PERSONAL), e vice-versa (o grupo
  // "Minha Carteira" só existe para ACCOUNTING_OFFICE).
  const tenantType = (tenant?.tenantType as "BUSINESS" | "PERSONAL" | "ACCOUNTING_OFFICE" | undefined) ?? "BUSINESS";
  const groups = NAV_GROUPS.filter((g) => !g.tenantTypes || g.tenantTypes.includes(tenantType))
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => !i.tenantTypes || i.tenantTypes.includes(tenantType)),
    }))
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => !i.roles || (user && i.roles.includes(user.role))),
    }))
    .map((g) => ({
      ...g,
      items: g.items.filter(
        (i) =>
          (!i.moduleCode || activeModuleCodes.includes(i.moduleCode)) &&
          (!i.moduleCodes || i.moduleCodes.some((code) => activeModuleCodes.includes(code))),
      ),
    }))
    .filter((g) => g.items.length > 0);
  // Seleciona apenas o item com o caminho correspondente mais longo (ex.: /estoque vs /estoque/contagens)
  const activePath = groups
    .flatMap((g) => g.items)
    .filter((i) => pathname === i.path || pathname.startsWith(`${i.path}/`))
    .reduce<string>((best, i) => (i.path.length > best.length ? i.path : best), "");

  const drawerContent = (
    <Box sx={{ overflowY: "auto" }}>
      <Toolbar />
      {groups.map((group, idx) => (
        <Box key={group.id}>
          {idx > 0 && <Divider />}
          <List
            dense
            subheader={<ListSubheader sx={{ bgcolor: "transparent", lineHeight: "32px" }}>{group.label}</ListSubheader>}
          >
            {group.items.map((item) => (
              <ListItemButton
                key={item.id}
                component={NavLink}
                to={item.path}
                selected={item.path === activePath}
                onClick={() => setMobileOpen(false)}
                sx={{ mx: 1, borderRadius: 1 }}
              >
                <ListItemIcon sx={{ minWidth: 40 }}>{item.icon}</ListItemIcon>
                <ListItemText primary={item.label} />
              </ListItemButton>
            ))}
          </List>
        </Box>
      ))}
    </Box>
  );

  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      <Box sx={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: theme.zIndex.drawer + 2 }}>
        <ImpersonationBanner />
      </Box>
      <AppBar
        position="fixed"
        color="inherit"
        sx={{
          zIndex: theme.zIndex.drawer + 1,
          bgcolor: "background.paper",
          color: "text.primary",
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <Toolbar>
          {!isDesktop && (
            <IconButton edge="start" aria-label="Abrir menu" onClick={() => setMobileOpen(true)} sx={{ mr: 1 }}>
              <MenuIcon />
            </IconButton>
          )}
          <Typography variant="h6" noWrap sx={{ flexGrow: 1 }}>
            Filitech <Box component="span" sx={{ color: "primary.main" }}>ERP</Box>
            {tenant && isDesktop && (
              <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 2 }}>
                {tenant.tradeName ?? tenant.slug}
              </Typography>
            )}
          </Typography>
          <ThemeToggleButton />
          <IconButton color="inherit" aria-label="Busca global (Ctrl+K)" onClick={() => setPaletteOpen(true)}>
            <SearchIcon />
          </IconButton>
          <NotificationBell />
          {isDesktop ? (
            <Button color="inherit" startIcon={<LogoutIcon />} onClick={clearSession} sx={{ ml: 1 }}>
              Sair
            </Button>
          ) : (
            <IconButton color="inherit" aria-label="Sair" onClick={clearSession}>
              <LogoutIcon />
            </IconButton>
          )}
        </Toolbar>
      </AppBar>

      <Box component="nav" sx={{ width: { md: DRAWER_WIDTH }, flexShrink: { md: 0 } }} aria-label="Navegação principal">
        {isDesktop ? (
          <Drawer
            variant="permanent"
            open
            sx={{ "& .MuiDrawer-paper": { width: DRAWER_WIDTH, boxSizing: "border-box", borderRight: 1, borderColor: "divider" } }}
          >
            {drawerContent}
          </Drawer>
        ) : (
          <Drawer
            variant="temporary"
            open={mobileOpen}
            onClose={() => setMobileOpen(false)}
            ModalProps={{ keepMounted: true }}
            sx={{ "& .MuiDrawer-paper": { width: DRAWER_WIDTH, boxSizing: "border-box" } }}
          >
            {drawerContent}
          </Drawer>
        )}
      </Box>

      <Box component="main" sx={{ flexGrow: 1, minWidth: 0, bgcolor: "background.default" }}>
        <Toolbar />
        <Outlet />
      </Box>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} navGroups={groups} />
    </Box>
  );
}

// apps/web/src/modules/notifications/NotificationBell.tsx
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 8.4 — sininho de notificações ao vivo.
// GAP DE AUDITORIA ENCONTRADO E CORRIGIDO: o backend (notifyTenant, rotas REST,
// agora também SSE) sempre existiu, mas nenhum componente frontend jamais o
// consumia — o sininho nunca existiu na UI.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Box,
  Button,
  Divider,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Menu,
  Typography,
} from "@mui/material";
import NotificationsIcon from "@mui/icons-material/Notifications";
import { useNavigate } from "react-router-dom";
import { notificationFeedApi } from "./api";
import { useSseStream } from "../../shared/useSseStream";
import { useAuth } from "../../auth/AuthContext";

const SEVERITY_COLOR: Record<string, string> = {
  INFO: "info.main",
  WARNING: "warning.main",
  CRITICAL: "error.main",
};

export function NotificationBell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  const feedQuery = useQuery({
    queryKey: ["notifications", "feed"],
    queryFn: () => notificationFeedApi.list(false),
    enabled: Boolean(user),
    refetchInterval: 60_000, // fallback caso o SSE caia e o reconnect ainda não tenha disparado
  });

  useSseStream(
    "/notifications/stream",
    (event) => {
      if (event.type === "notification") {
        queryClient.invalidateQueries({ queryKey: ["notifications", "feed"] });
      }
    },
    Boolean(user),
  );

  const notifications = feedQuery.data?.notifications ?? [];
  const unreadCount = feedQuery.data?.unreadCount ?? 0;

  async function handleItemClick(id: string, linkRoute: string | null) {
    await notificationFeedApi.markRead(id);
    queryClient.invalidateQueries({ queryKey: ["notifications", "feed"] });
    setAnchorEl(null);
    if (linkRoute) navigate(linkRoute);
  }

  async function handleMarkAllRead() {
    await notificationFeedApi.markAllRead();
    queryClient.invalidateQueries({ queryKey: ["notifications", "feed"] });
  }

  return (
    <>
      <IconButton color="inherit" aria-label="Notificações" onClick={(e) => setAnchorEl(e.currentTarget)}>
        <Badge badgeContent={unreadCount} color="error" max={99}>
          <NotificationsIcon />
        </Badge>
      </IconButton>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)} PaperProps={{ sx: { width: 360, maxHeight: 480 } }}>
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", px: 2, py: 1 }}>
          <Typography variant="subtitle1">Notificações</Typography>
          <Button size="small" onClick={handleMarkAllRead} disabled={unreadCount === 0}>
            Marcar todas como lidas
          </Button>
        </Box>
        <Divider />
        {notifications.length === 0 ? (
          <Box sx={{ p: 3, textAlign: "center" }}>
            <Typography variant="body2" color="text.secondary">
              Nenhuma notificação.
            </Typography>
          </Box>
        ) : (
          <List dense disablePadding>
            {notifications.map((n) => (
              <ListItemButton
                key={n.id}
                onClick={() => handleItemClick(n.id, n.linkRoute)}
                sx={{ opacity: n.readAt ? 0.6 : 1, borderLeft: 3, borderColor: SEVERITY_COLOR[n.severity] ?? "divider" }}
              >
                <ListItemText
                  primary={n.title}
                  secondary={n.body}
                  primaryTypographyProps={{ fontWeight: n.readAt ? 400 : 600 }}
                  secondaryTypographyProps={{ noWrap: true }}
                />
              </ListItemButton>
            ))}
          </List>
        )}
      </Menu>
    </>
  );
}

// apps/web/src/pages/DashboardPage.tsx
import { useEffect, useState } from "react";
import { Box, Typography, Paper, Button, Chip } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { checkHealth } from "../api/client";

export function DashboardPage() {
  const { tenant, user } = useAuth();
  const [health, setHealth] = useState<string>("verificando...");

  useEffect(() => {
    checkHealth()
      .then((res) => setHealth(`${res.status} (db: ${res.database})`))
      .catch(() => setHealth("indisponível"));
  }, []);

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 720, mx: "auto" }}>
      <Typography variant="h5" sx={{ mb: 3 }}>Dashboard</Typography>
      <Paper sx={{ p: 3 }} variant="outlined">
        <Typography variant="subtitle1">Tenant: {tenant?.tradeName ?? tenant?.slug ?? "—"}</Typography>
        <Typography variant="body2" color="text.secondary">
          Status: <Chip size="small" label={tenant?.status ?? "—"} />
        </Typography>
        <Typography variant="body2" sx={{ mt: 2 }}>
          Usuário: {user?.name} ({user?.role})
        </Typography>
        <Typography variant="body2" sx={{ mt: 2 }}>
          Saúde da API: {health}
        </Typography>
        <Button component={RouterLink} to="/pdv" variant="contained" sx={{ mt: 3 }}>
          Abrir PDV
        </Button>
      </Paper>
    </Box>
  );
}

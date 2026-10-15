// apps/web/src/shared/validation/PasswordStrengthMeter.tsx
// Barra de progresso de força de senha reutilizável — usada no cadastro do
// tenant (SignupPage) e na criação de usuário (UsersPage), para manter o mesmo
// feedback visual em qualquer tela que define uma senha nova.
import { Box, LinearProgress, Typography } from "@mui/material";
import { computePasswordStrength } from "./password-strength";

export function PasswordStrengthMeter({ password }: { password: string }) {
  if (!password) return null;

  const { percent, label, color } = computePasswordStrength(password);

  return (
    <Box sx={{ mt: -1 }}>
      <LinearProgress variant="determinate" value={percent} color={color} sx={{ height: 6, borderRadius: 3 }} />
      <Typography variant="caption" color={`${color}.main`}>
        Força da senha: {label}
      </Typography>
    </Box>
  );
}

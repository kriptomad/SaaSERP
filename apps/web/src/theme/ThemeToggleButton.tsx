// apps/web/src/theme/ThemeToggleButton.tsx
import { IconButton, Tooltip } from "@mui/material";
import LightModeIcon from "@mui/icons-material/LightMode";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import SettingsBrightnessIcon from "@mui/icons-material/SettingsBrightness";
import { useThemeMode, type ThemeMode } from "./ThemeModeProvider";

// Ciclo: light → dark → system → light
const NEXT_MODE: Record<ThemeMode, ThemeMode> = { light: "dark", dark: "system", system: "light" };
const MODE_LABEL: Record<ThemeMode, string> = { light: "claro", dark: "escuro", system: "do sistema" };

export function ThemeToggleButton() {
  const { mode, setMode } = useThemeMode();
  const next = NEXT_MODE[mode];
  const label = `Tema ${MODE_LABEL[mode]} — clique para mudar para ${MODE_LABEL[next]}`;

  return (
    <Tooltip title={label}>
      <IconButton color="inherit" onClick={() => setMode(next)} aria-label={label} data-testid="theme-toggle">
        {mode === "light" ? <LightModeIcon /> : mode === "dark" ? <DarkModeIcon /> : <SettingsBrightnessIcon />}
      </IconButton>
    </Tooltip>
  );
}

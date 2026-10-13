// apps/web/src/theme/ThemeModeProvider.tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { CssBaseline, ThemeProvider } from "@mui/material";
import { darkTheme, lightTheme } from "@filitech/design-tokens";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedThemeMode = "light" | "dark";

export const THEME_MODE_STORAGE_KEY = "filitech:theme-mode";
const DARK_QUERY = "(prefers-color-scheme: dark)";

interface ThemeModeContextValue {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  resolvedMode: ResolvedThemeMode;
}

const ThemeModeContext = createContext<ThemeModeContextValue | undefined>(undefined);

function readStoredMode(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(THEME_MODE_STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    // localStorage indisponível (modo privado/bloqueado): cai no padrão
  }
  return "system";
}

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(DARK_QUERY).matches;
}

export function ThemeModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readStoredMode);
  const [systemDark, setSystemDark] = useState<boolean>(systemPrefersDark);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(DARK_QUERY);
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  // Sincroniza entre abas
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_MODE_STORAGE_KEY) setModeState(readStoredMode());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    try {
      window.localStorage.setItem(THEME_MODE_STORAGE_KEY, next);
    } catch {
      // preferência vale apenas para a sessão atual
    }
  }, []);

  const resolvedMode: ResolvedThemeMode = mode === "system" ? (systemDark ? "dark" : "light") : mode;

  const value = useMemo(() => ({ mode, setMode, resolvedMode }), [mode, setMode, resolvedMode]);

  return (
    <ThemeModeContext.Provider value={value}>
      <ThemeProvider theme={resolvedMode === "dark" ? darkTheme : lightTheme}>
        <CssBaseline enableColorScheme />
        {children}
      </ThemeProvider>
    </ThemeModeContext.Provider>
  );
}

export function useThemeMode(): ThemeModeContextValue {
  const ctx = useContext(ThemeModeContext);
  if (!ctx) throw new Error("useThemeMode deve ser usado dentro de um ThemeModeProvider.");
  return ctx;
}

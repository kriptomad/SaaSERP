import { createTheme, type Theme } from "@mui/material/styles";
import type { PaletteMode } from "@mui/material";
import { colorTokens as c, typographyTokens, spacingTokens, shapeTokens } from "./tokens";

export function createAppTheme(mode: PaletteMode): Theme {
  const dark = mode === "dark";
  return createTheme({
    palette: {
      mode,
      primary: dark
        ? { main: c.brand.indigo400, light: c.brand.indigo300, dark: c.brand.indigo600, contrastText: c.surface.darkBase }
        : { main: c.brand.indigo600, light: c.brand.indigo500, dark: c.brand.indigo700, contrastText: "#FFFFFF" },
      secondary: dark
        ? { main: c.brand.cyan400, dark: c.brand.cyan600, contrastText: c.surface.darkBase }
        : { main: c.brand.cyan700, dark: "#155e75", contrastText: "#FFFFFF" },
      success: { main: c.semantic.success },
      warning: { main: c.semantic.warning },
      error: { main: c.semantic.danger },
      info: { main: c.semantic.info },
      background: dark
        ? { default: c.surface.darkBase, paper: c.surface.darkElevated }
        : { default: c.surface.lightBase, paper: c.surface.lightElevated },
      text: dark
        ? { primary: c.neutral.darkText, secondary: c.neutral.darkTextSecondary }
        : { primary: c.neutral.lightText, secondary: c.neutral.lightTextSecondary },
      divider: dark ? c.neutral.darkDivider : c.neutral.lightDivider,
    },
    typography: {
      fontFamily: typographyTokens.fontFamily,
      fontSize: 14,
      h1: { fontWeight: 800, letterSpacing: "-0.02em" },
      h2: { fontWeight: 800, letterSpacing: "-0.02em" },
      h3: { fontWeight: 700, letterSpacing: "-0.01em" },
      h4: { fontWeight: 700, letterSpacing: "-0.01em" },
      h5: { fontWeight: 700 },
      h6: { fontWeight: 700 },
      subtitle1: { fontWeight: 600 },
      subtitle2: { fontWeight: 600 },
      button: { textTransform: "none", fontWeight: 600 },
    },
    shape: { borderRadius: shapeTokens.borderRadius },
    spacing: spacingTokens.unit,
    components: {
      MuiCssBaseline: {
        styleOverrides: { body: { transition: "background-color 0.2s ease, color 0.2s ease" } },
      },
      MuiButton: { defaultProps: { disableElevation: true } },
      MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } } },
      MuiAppBar: { defaultProps: { elevation: 0 } },
      MuiDrawer: { styleOverrides: { paper: { backgroundImage: "none" } } },
    },
  });
}

export const lightTheme: Theme = createAppTheme("light");
export const darkTheme: Theme = createAppTheme("dark");

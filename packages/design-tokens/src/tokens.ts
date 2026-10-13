// Tokens puros (sem React/MUI) — Bible 8.4.1. Fonte única de cor/tipografia/espaçamento.
export const colorTokens = {
  brand: {
    indigo50: "#eef0ff",
    indigo100: "#e0e3ff",
    indigo300: "#a5a8fb",
    indigo400: "#818cf8",
    indigo500: "#6366F1",
    indigo600: "#4F46E5",
    indigo700: "#4338ca",
    indigo900: "#1e1b4b",
    cyan400: "#22d3ee",
    cyan600: "#0891b2",
    cyan700: "#0e7490",
  },
  surface: {
    darkBase: "#05060A",
    darkElevated: "#0D0E14",
    darkRaised: "#151722",
    lightBase: "#F4F6FA",
    lightElevated: "#FFFFFF",
  },
  neutral: {
    lightText: "#111827",
    lightTextSecondary: "#4B5563",
    lightDivider: "#E5E7EB",
    darkText: "#F3F4F6",
    darkTextSecondary: "#9CA3AF",
    darkDivider: "#242636",
  },
  semantic: {
    success: "#16A34A",
    warning: "#D97706",
    danger: "#DC2626",
    info: "#2563EB",
  },
} as const;

export const typographyTokens = {
  fontFamily: "'Inter', 'Roboto', 'Helvetica Neue', Arial, sans-serif",
  scale: { xs: 12, sm: 14, base: 16, lg: 18, xl: 24, "2xl": 32, "3xl": 48 },
} as const;

export const spacingTokens = {
  unit: 8,
  scale: [0, 4, 8, 12, 16, 24, 32, 48, 64],
} as const;

export const shapeTokens = { borderRadius: 10 } as const;

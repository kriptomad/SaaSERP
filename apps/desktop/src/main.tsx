// apps/desktop/src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import { createAppTheme } from "@filitech/design-tokens";
import { App } from "./App";

// Reaproveita o mesmo motor de tema (tokens de marca) do produto web — não um tema
// desktop paralelo — via @filitech/design-tokens (pacote compartilhado do monorepo).
const theme = createAppTheme("light");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);

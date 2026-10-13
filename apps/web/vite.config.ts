import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Frontend React 18 / Vite / MUI v5 (Capítulo 8). Deploy no Vercel aponta direto
// para apps/web como root do projeto (ver vercel.json na raiz do monorepo).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
});

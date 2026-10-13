import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Renderer do shell Electron (telas de onboarding/config/dashboard). A UI de negócio
// do ERP em si NÃO é duplicada aqui — este renderer só cobre o "chrome" de instalação
// (escolha HOST/USUÁRIO, config de rede, licenciamento, dashboard de saúde). A
// aplicação real (apps/web) é carregada em uma BrowserWindow própria pelo processo
// principal (electron/main.ts), apontando para a API local (HOST) ou remota (USUÁRIO).
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});

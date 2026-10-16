import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import obfuscatorPlugin from "vite-plugin-javascript-obfuscator";

// Frontend React 18 / Vite / MUI v5 (Capítulo 8). Deploy no Vercel aponta direto
// para apps/web como root do projeto (ver vercel.json na raiz do monorepo).
//
// Blindagem de build (Capítulo 3/9 — nunca vazar lógica de negócio/segredos no F12):
// 1. Sourcemaps desabilitados em produção — sem eles o navegador não reconstrói o
//    arquivo-fonte original, só o bundle minificado/ofuscado.
// 2. `console.*`/`debugger` são removidos do bundle de produção pelo esbuild
//    (minify padrão do Vite) — nenhum `console.log` de diagnóstico sobrevive ao build,
//    mesmo que algum tenha escapado de code review.
// 3. `vite-plugin-javascript-obfuscator` roda como passo final, SOMENTE em build de
//    produção (nunca em dev), renomeando identificadores, achatando o fluxo de
//    controle, injetando código morto e cifrando o array de strings literais —
//    eleva o custo de engenharia reversa via F12 bem acima do minify padrão do esbuild.
//    `debugProtection`/`selfDefending` foram testados e DESCARTADOS DE PROPÓSITO:
//    ambos derrubam a página (loop infinito) em qualquer navegador que mantenha uma
//    sessão CDP ativa (Playwright/Puppeteer, extensões de QA, ferramentas corporativas
//    de monitoramento/RMM e alguns leitores de tela) — risco de indisponibilidade real
//    para usuários legítimos supera o ganho marginal de anti-debug, então fica de fora.
export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    command === "build" &&
      obfuscatorPlugin({
        options: {
          compact: true,
          controlFlowFlattening: true,
          controlFlowFlatteningThreshold: 0.75,
          deadCodeInjection: true,
          deadCodeInjectionThreshold: 0.3,
          debugProtection: false,
          disableConsoleOutput: true,
          identifierNamesGenerator: "hexadecimal",
          numbersToExpressions: true,
          renameGlobals: false,
          rotateStringArray: true,
          selfDefending: false,
          splitStrings: true,
          splitStringsChunkLength: 8,
          stringArray: true,
          stringArrayEncoding: ["base64"],
          stringArrayThreshold: 0.75,
          transformObjectKeys: true,
          unicodeEscapeSequence: false,
        },
      }),
  ],
  server: {
    port: 5173,
  },
  esbuild: {
    drop: command === "build" ? ["console", "debugger"] : [],
  },
  build: {
    sourcemap: false,
  },
}));

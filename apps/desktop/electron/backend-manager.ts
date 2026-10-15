// apps/desktop/electron/backend-manager.ts
// Gerencia o child_process do backend (apps/api) quando o shell está em modo HOST.
// IMPORTANTE: isto reaproveita apps/api tal como está — não existe reimplementação
// do servidor Express aqui. Em dev, roda `tsx watch src/server.ts` dentro do próprio
// workspace do monorepo. Em produção (app empacotado), o backend real (dist/server.cjs
// + node_modules de produção + cliente Prisma gerado) é montado em `resources/api` pelo
// script `scripts/prepare-api-resources.mjs` ANTES do `electron-builder` rodar (ver
// `package:win` em package.json e `extraResources` abaixo) — gap da Rodada 4 fechado.
//
// NODE-API em vez de Electron GUI: em app empacotado, `process.execPath` aponta para o
// binário do próprio Electron, não para um Node.js "puro". Para rodá-lo como um
// interpretador Node comum (em vez de abrir uma segunda janela do Chromium), é
// obrigatório setar `ELECTRON_RUN_AS_NODE=1` no ambiente do child_process — sem essa
// variável o spawn abaixo falharia silenciosamente em produção. Módulos nativos N-API
// (ex. `argon2`, via prebuild-install) continuam funcionando normalmente sob esse modo,
// pois N-API é estável entre o Node embutido no Electron e builds "puras" do Node.
import { ChildProcess, spawn } from "node:child_process";
import path from "node:path";
import { app } from "electron";
import type { BackendState, NetworkConfig } from "./ipc-contract";

let child: ChildProcess | null = null;
let state: BackendState = { status: "STOPPED", pid: null, lastError: null, apiBaseUrl: null };
type Listener = (state: BackendState) => void;
const listeners = new Set<Listener>();

function setState(next: Partial<BackendState>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener(state);
}

export function onBackendStateChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getBackendState(): BackendState {
  return state;
}

function resolveApiEntry(): { command: string; args: string[]; cwd: string } {
  if (app.isPackaged) {
    const apiRoot = path.join(process.resourcesPath, "api");
    return { command: process.execPath, args: [path.join(apiRoot, "dist", "server.cjs")], cwd: apiRoot };
  }
  // Dev: reaproveita o workspace apps/api do monorepo via tsx watch (mesmo comando de
  // `npm run api:dev` na raiz), para ter hot-reload igual ao dev web-only.
  const monorepoRoot = path.resolve(__dirname, "..", "..", "..");
  const apiRoot = path.join(monorepoRoot, "apps", "api");
  const tsxBin = path.join(monorepoRoot, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
  return { command: tsxBin, args: ["watch", "src/server.ts"], cwd: apiRoot };
}

export function startBackend(network: NetworkConfig): BackendState {
  if (child) {
    return state;
  }
  setState({ status: "STARTING", lastError: null });
  const { command, args, cwd } = resolveApiEntry();

  try {
    child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        // Obrigatório em produção (ver comentário de topo do arquivo): faz o binário do
        // Electron se comportar como um interpretador Node puro para este child_process,
        // em vez de tentar abrir uma segunda janela do Chromium. Inofensivo em dev
        // (`command` já é o binário `tsx`, não o Electron, então a env é ignorada por ele).
        ELECTRON_RUN_AS_NODE: "1",
        PORT: String(network.port),
        HOST: network.bindAddress,
        DATABASE_URL: network.databaseUrl,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch (error) {
    setState({ status: "ERROR", lastError: (error as Error).message });
    return state;
  }

  const apiBaseUrl = `http://${network.bindAddress === "0.0.0.0" ? "127.0.0.1" : network.bindAddress}:${network.port}`;

  child.stdout?.on("data", (chunk) => {
    const text = chunk.toString();
    console.log("[filitech-api]", text.trim());
    if (text.includes("ouvindo na porta")) {
      setState({ status: "RUNNING", pid: child?.pid ?? null, apiBaseUrl });
    }
  });
  child.stderr?.on("data", (chunk) => {
    console.error("[filitech-api:stderr]", chunk.toString().trim());
  });
  child.on("exit", (code) => {
    setState({
      status: code === 0 ? "STOPPED" : "ERROR",
      pid: null,
      lastError: code === 0 ? null : `Backend encerrou com código ${code}`,
    });
    child = null;
  });
  child.on("error", (error) => {
    setState({ status: "ERROR", lastError: error.message });
    child = null;
  });

  // Fallback: considera "RUNNING" após um pequeno delay mesmo sem detectar a linha de
  // log exata (ex. variações de wording), evitando prender a UI em "STARTING" para sempre.
  setTimeout(() => {
    if (state.status === "STARTING" && child) {
      setState({ status: "RUNNING", pid: child.pid ?? null, apiBaseUrl });
    }
  }, 4000);

  return state;
}

export function stopBackend(): void {
  if (child) {
    child.kill();
    child = null;
  }
  setState({ status: "STOPPED", pid: null, apiBaseUrl: null });
}

app.on("before-quit", () => {
  stopBackend();
});

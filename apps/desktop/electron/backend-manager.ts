// apps/desktop/electron/backend-manager.ts
// Gerencia o child_process do backend (apps/api) quando o shell está em modo HOST.
// IMPORTANTE: isto reaproveita apps/api tal como está — não existe reimplementação
// do servidor Express aqui. Em dev, roda `tsx watch src/server.ts` dentro do próprio
// workspace do monorepo. Em produção (app empacotado), espera encontrar um build de
// apps/api copiado para `resources/api` pelo processo de empacotamento (ver
// `extraResources` em package.json) — documentado como pendência em README.md,
// pois empacotar o Node + node_modules nativos (argon2, etc.) de um segundo processo
// dentro de um instalador Electron exige um passo de "sidecar" dedicado que não foi
// validado neste ambiente sandbox.
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
    // Pendência documentada: build de produção depende de `resources/api/dist/server.cjs`
    // existir (copiado via extraResources no empacotamento do apps/api). Ver README.md.
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

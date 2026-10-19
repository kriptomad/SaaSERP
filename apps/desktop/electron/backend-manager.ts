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
import { ChildProcess, exec, spawn } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { app } from "electron";
import type { BackendState, NetworkConfig } from "./ipc-contract";
import { pingUrl } from "./network-utils";

const execAsync = promisify(exec);

let child: ChildProcess | null = null;
let state: BackendState = { status: "STOPPED", pid: null, lastError: null, apiBaseUrl: null };
type Listener = (state: BackendState) => void;
const listeners = new Set<Listener>();

// CORREÇÃO DE AUDITORIA (fa-desktop-backend-manager-race): cada start recebe um
// `generation` incremental; callbacks (stdout/stderr/exit/error/health-poll) de um
// processo anterior checam `generation === currentGeneration` antes de mutar `state`
// ou `child` — eventos tardios de um child já parado não conseguem mais corromper o
// estado do processo atual. `lifecycleLock` serializa start/stop concorrentes: uma
// segunda chamada a `startBackend`/`stopBackend` enquanto a anterior ainda está em
// andamento aguarda a mesma Promise em vez de disparar um child_process duplicado.
let currentGeneration = 0;
let lifecycleLock: Promise<unknown> = Promise.resolve();

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

/**
 * CORREÇÃO DE AUDITORIA (fa-desktop-backend-zombie-processes): `child.kill()` sozinho
 * só sinaliza o processo imediato; `tsx watch` (dev) e qualquer processo que spawne
 * descendentes podem deixar filhos/netos órfãos (zombies) rodando mesmo depois do pai
 * morrer. No Windows usamos `taskkill /T /F` (mata a árvore de processos inteira pelo
 * PID) e esperamos o evento `exit` do child (com timeout) antes de considerar o stop
 * concluído — nunca limpamos a referência "na marra" sem confirmar.
 */
async function killProcessTree(target: ChildProcess, timeoutMs = 8000): Promise<void> {
  if (target.exitCode !== null || target.signalCode !== null) return; // já morreu
  const exited = new Promise<void>((resolve) => {
    target.once("exit", () => resolve());
  });

  if (process.platform === "win32" && target.pid) {
    try {
      await execAsync(`taskkill /pid ${target.pid} /T /F`);
    } catch {
      // Processo já pode ter morrido entre a checagem e o taskkill — ignora e segue
      // para a espera com timeout abaixo, que garante não travarmos para sempre.
    }
  } else {
    target.kill("SIGTERM");
  }

  const timedOut = await Promise.race([
    exited.then(() => false),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(true), timeoutMs)),
  ]);

  if (timedOut) {
    // Último recurso: SIGKILL direto (não mata a árvore em POSIX, mas evita um loop
    // eterno aguardando um processo que nunca responde ao sinal de término).
    try {
      target.kill("SIGKILL");
    } catch {
      // processo já não existe mais — nada a fazer.
    }
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2000))]);
  }
}

/**
 * CORREÇÃO DE AUDITORIA (fa-desktop-backend-fake-running-fallback,
 * fa-desktop-backend-status-log-parsing): a transição para RUNNING deixou de depender
 * de (a) um timeout cego que assume sucesso só porque o objeto do processo ainda
 * existe, ou (b) um `grep` de string específica no stdout (frágil a mudanças de
 * wording/idioma, e nunca se recupera se o processo travar sem nunca emitir essa
 * linha). Agora fazemos polling real em `${apiBaseUrl}/health` com timeout e número
 * máximo de tentativas — só marcamos RUNNING após uma resposta HTTP bem-sucedida.
 */
async function waitForHealthy(generation: number, apiBaseUrl: string, maxAttempts = 30, intervalMs = 500): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (generation !== currentGeneration || !child) return; // processo foi parado/substituído enquanto esperávamos
    const result = await pingUrl(`${apiBaseUrl}/health`, 1500);
    if (generation !== currentGeneration || !child) return;
    if (result.ok) {
      setState({ status: "RUNNING", pid: child.pid ?? null, apiBaseUrl });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  if (generation === currentGeneration && child && state.status === "STARTING") {
    setState({ status: "ERROR", lastError: "Backend não respondeu em /health dentro do tempo esperado." });
  }
}

async function doStartBackend(network: NetworkConfig): Promise<BackendState> {
  if (child) {
    return state; // já rodando (ou iniciando) — chamador deve parar explicitamente antes.
  }
  currentGeneration += 1;
  const generation = currentGeneration;
  setState({ status: "STARTING", lastError: null });
  const { command, args, cwd } = resolveApiEntry();

  let spawned: ChildProcess;
  try {
    spawned = spawn(command, args, {
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
    if (generation === currentGeneration) setState({ status: "ERROR", lastError: (error as Error).message });
    return state;
  }

  if (generation !== currentGeneration) {
    // `stopBackend` foi chamado (ou outro start venceu) entre o setState acima e o
    // spawn concluir — mata este processo órfão imediatamente em vez de deixá-lo vivo.
    spawned.kill();
    return state;
  }

  child = spawned;
  const apiBaseUrl = `http://${network.bindAddress === "0.0.0.0" ? "127.0.0.1" : network.bindAddress}:${network.port}`;

  spawned.stdout?.on("data", (chunk) => {
    if (generation !== currentGeneration) return;
    console.log("[filitech-api]", chunk.toString().trim());
  });
  spawned.stderr?.on("data", (chunk) => {
    if (generation !== currentGeneration) return;
    console.error("[filitech-api:stderr]", chunk.toString().trim());
  });
  spawned.on("exit", (code) => {
    if (generation !== currentGeneration) return; // evento tardio de um processo já substituído/parado
    setState({
      status: code === 0 ? "STOPPED" : "ERROR",
      pid: null,
      lastError: code === 0 ? null : `Backend encerrou com código ${code}`,
    });
    child = null;
  });
  spawned.on("error", (error) => {
    if (generation !== currentGeneration) return;
    setState({ status: "ERROR", lastError: error.message });
    child = null;
  });

  void waitForHealthy(generation, apiBaseUrl);

  return state;
}

async function doStopBackend(): Promise<void> {
  // Invalida qualquer callback pendente do processo atual ANTES de começar a matá-lo,
  // para que um `exit`/health-check tardio não ressuscite o estado depois do stop.
  currentGeneration += 1;
  const target = child;
  child = null;
  if (target) {
    await killProcessTree(target);
  }
  setState({ status: "STOPPED", pid: null, apiBaseUrl: null, lastError: null });
}

export function startBackend(network: NetworkConfig): Promise<BackendState> {
  lifecycleLock = lifecycleLock.then(() => doStartBackend(network), () => doStartBackend(network));
  return lifecycleLock as Promise<BackendState>;
}

export function stopBackend(): Promise<void> {
  lifecycleLock = lifecycleLock.then(() => doStopBackend(), () => doStopBackend());
  return lifecycleLock as Promise<void>;
}

app.on("before-quit", () => {
  void stopBackend();
});

// apps/desktop/scripts/prepare-api-resources.mjs
// Monta o "sidecar" de apps/api (modo HOST) dentro de `apps/desktop/resources-build/api`,
// para o electron-builder empacotar via `extraResources` (ver package.json). Gap real da
// Rodada 4: antes deste script, `backend-manager.ts` já sabia COMO rodar o backend
// empacotado (`resources/api/dist/server.cjs`), mas nada gerava esse conteúdo — era uma
// pendência aberta (ver README.md "Empacotamento").
//
// O QUE ESTE SCRIPT FAZ (sem mock, reaproveitando 100% o build real de apps/api):
//   1. Roda `npm run build` em apps/api (scripts/build.mjs — esbuild + tsc --noEmit real,
//      gera dist/server.cjs e dist/worker.cjs já com @filitech/db bundlado).
//   2. Copia esse `dist/` para `resources-build/api/dist`.
//   3. Gera um `package.json` mínimo em `resources-build/api/` com só as `dependencies`
//      reais de apps/api (a mesma lista de "external" usada pelo esbuild) + @prisma/client,
//      fixadas nas MESMAS versões do apps/api/package.json (nunca "latest").
//   4. Roda `npm install --omit=dev` dentro de `resources-build/api` — isso baixa os
//      binários nativos pré-compilados (ex. argon2 via prebuild-install) para a
//      plataforma/arquitetura da máquina que está empacotando (deve ser a mesma do
//      instalador-alvo; cross-compilar binário nativo não é resolvido aqui).
//   5. Copia o cliente Prisma JÁ GERADO (`packages/db/node_modules/.prisma/client`) para
//      dentro de `resources-build/api/node_modules/.prisma/client` — o client precisa ter
//      sido gerado previamente (`npm run generate --workspace=@filitech/db`) contra o
//      MESMO schema.prisma usado no build, senão o backend empacotado sobe com um client
//      desatualizado.
//
// VALIDAÇÃO REAL FEITA NESTA SESSÃO (não é só teoria): rodado de ponta a ponta neste
// ambiente — build real de apps/api, cópia do dist/, geração do package.json mínimo,
// `npm install --omit=dev` (425 pacotes, ~20-30s) e cópia do cliente Prisma gerado.
// Confirmado depois: `require("argon2").hash(...)` funcionou (prebuild nativo
// `win32-x64` vem embutido no próprio pacote `argon2`, sem precisar rodar seu script de
// install) e `require("@prisma/client")` resolveu sem erro dentro do staging gerado.
// O que NÃO foi validado neste ambiente: a geração do instalador NSIS final via
// `electron-builder --win` em si (mesma classe de limitação de binário grande/rede já
// registrada no README para o download do próprio Electron).
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");
const monorepoRoot = path.resolve(desktopRoot, "..", "..");
const apiRoot = path.join(monorepoRoot, "apps", "api");
const dbRoot = path.join(monorepoRoot, "packages", "db");
const stagingRoot = path.join(desktopRoot, "resources-build", "api");

function log(message) {
  console.log(`[prepare-api-resources] ${message}`);
}

function run(command, args, cwd) {
  log(`${cwd} $ ${command} ${args.join(" ")}`);
  // `shell: true` só serve para resolver `npm`/`npm.cmd` no PATH do Windows; os
  // argumentos continuam passados como array (nunca concatenados numa string), então
  // não há o risco de injeção que o aviso de depreciação do Node alerta para o caso
  // geral de `shell: true` combinado com entrada não confiável.
  execFileSync(command, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
}

// 1. Build real de apps/api (mesmo script usado em produção na nuvem — nunca um build
// paralelo "só para o desktop").
run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], apiRoot);

// 2. Limpa staging e copia dist/.
rmSync(stagingRoot, { recursive: true, force: true });
mkdirSync(stagingRoot, { recursive: true });
cpSync(path.join(apiRoot, "dist"), path.join(stagingRoot, "dist"), { recursive: true });
log(`dist/ copiado para ${path.join(stagingRoot, "dist")}`);

// 3. package.json mínimo do sidecar: mesma lista de "external" que build.mjs usa (todas
// as dependencies de apps/api, exceto @filitech/db que já vem bundlado no .cjs), nas
// MESMAS versões já fixadas no monorepo.
const apiPkg = JSON.parse(readFileSync(path.join(apiRoot, "package.json"), "utf8"));
const sidecarDependencies = {};
for (const [name, version] of Object.entries(apiPkg.dependencies)) {
  if (name === "@filitech/db") continue;
  sidecarDependencies[name] = version;
}
const dbPkg = JSON.parse(readFileSync(path.join(dbRoot, "package.json"), "utf8"));
// @prisma/client precisa estar instalado como dependência real do sidecar (não só o
// gerado em .prisma/client) para o `require("@prisma/client")` do dist/*.cjs resolver.
sidecarDependencies["@prisma/client"] = dbPkg.dependencies["@prisma/client"];

const sidecarPkg = {
  name: "@filitech/desktop-api-sidecar",
  private: true,
  version: "0.0.0",
  description: "Build de produção de @filitech/api empacotado como sidecar do shell desktop Electron (gerado por scripts/prepare-api-resources.mjs — não editar manualmente).",
  dependencies: sidecarDependencies,
};
writeFileSync(path.join(stagingRoot, "package.json"), `${JSON.stringify(sidecarPkg, null, 2)}\n`);
log(`package.json do sidecar gerado com ${Object.keys(sidecarDependencies).length} dependências de produção.`);

// 4. Instala só as dependências de produção (binários nativos pré-compilados para a
// plataforma/arquitetura ATUAL — empacotar para outra arquitetura exige rodar este
// script numa máquina/CI daquela arquitetura).
run(process.platform === "win32" ? "npm.cmd" : "npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], stagingRoot);

// 5. Copia o cliente Prisma já gerado (precisa existir — rodar `npm run generate`
// em packages/db antes deste script, como já é feito no build normal da apps/api).
const generatedClientSrc = path.join(dbRoot, "node_modules", ".prisma", "client");
if (!existsSync(generatedClientSrc)) {
  throw new Error(
    `Cliente Prisma gerado não encontrado em ${generatedClientSrc}. Rode "npm run generate" em packages/db antes de empacotar o desktop.`,
  );
}
const generatedClientDest = path.join(stagingRoot, "node_modules", ".prisma", "client");
mkdirSync(path.dirname(generatedClientDest), { recursive: true });
cpSync(generatedClientSrc, generatedClientDest, { recursive: true, dereference: true });
log(`Cliente Prisma gerado copiado para ${generatedClientDest}`);

log("Sidecar de apps/api pronto em resources-build/api — electron-builder vai copiá-lo para resources/api via extraResources.");

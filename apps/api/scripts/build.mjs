// Build de produção da API: `tsc` sozinho emite imports sem extensão (moduleResolution
// "Bundler") e deixa `@filitech/db` apontando para código-fonte .ts, o que o Node não
// executa. Este script faz o type-check com tsc e empacota server.ts/worker.ts em CJS
// com esbuild, mantendo as dependências npm externas (resolvidas via node_modules/
// NODE_PATH em runtime) e embutindo apenas o pacote de workspace @filitech/db.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { build } from "esbuild";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const external = Object.keys(pkg.dependencies).filter((name) => name !== "@filitech/db");
external.push("@prisma/client", ".prisma/client");

const tscBin = createRequire(import.meta.url).resolve("typescript/bin/tsc");
execFileSync(process.execPath, [tscBin, "-p", "tsconfig.json", "--noEmit"], { stdio: "inherit" });

rmSync("dist", { recursive: true, force: true });
await build({
  entryPoints: { server: "src/server.ts", worker: "src/worker.ts" },
  outdir: "dist",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outExtension: { ".js": ".cjs" }, // o package.json do api é "type": "module"
  sourcemap: true,
  external,
  logLevel: "info",
});

// Launcher único para plataformas que só permitem um CMD por imagem (ex.: Railway):
// APP_ROLE=worker inicia o worker BullMQ; qualquer outro valor inicia a API HTTP.
//
// fa-w5-boot-migration-not-applied: Railway não tem um "release phase"/pre-deploy
// hook equivalente ao `heroku run` ou a um init-container do Kubernetes — o
// `railway.toml` só aceita `[build]`/`[deploy]` (healthcheck, restart policy), sem
// nenhum campo de comando executado antes do processo principal subir (confirmado
// contra o schema público de config-as-code do Railway). Por isso o gate de
// migration é feito aqui, dentro do próprio launcher: a réplica que inicia a API
// HTTP (`APP_ROLE` != "worker") roda `prisma migrate deploy` SINCRONAMENTE antes de
// `require("./server.cjs")` — nenhuma requisição é aceita (nem o healthcheck fica
// verde) enquanto o schema não estiver em dia. O worker NÃO roda migration (evita
// toda réplica de worker competir pela mesma corrida de lock no boot; a API já é a
// única responsável por manter o schema em dia).
//
// Múltiplas réplicas da API subindo ao mesmo tempo (deploy com >1 réplica, ou um
// rolling restart) rodam `migrate deploy` concorrentemente — isso é seguro por
// design: o Prisma Migrate adquire um advisory lock do Postgres internamente
// durante `migrate deploy`, então só uma réplica aplica as migrations pendentes
// por vez; as demais aguardam o lock e, ao adquiri-lo em seguida, não encontram
// mais nada pendente (no-op) — nenhuma migration é aplicada duas vezes nem hà
// corrida destrutiva. Caso uma réplica perca a espera do lock (timeout), o retry
// com backoff abaixo absorve isso antes de desistir.
writeFileSync(
  "dist/start.cjs",
  `"use strict";
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const isWorker = process.env.APP_ROLE === "worker";

// Sleep síncrono e bloqueante (sem await de topo em CJS) — aceitável aqui porque
// este launcher não atende requisições; é só o passo de boot antes de delegar
// para server.cjs/worker.cjs.
function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function runMigrateDeploy() {
  // Caminhos resolvidos a partir de __dirname (não de process.cwd()) para funcionar
  // independente do diretório de onde o CMD da imagem distroless invoca este
  // arquivo — espelha o layout copiado pelo Dockerfile (apps/api/dist, packages/db/
  // prisma e packages/db/node_modules ficam todos sob /app).
  const schemaPath = path.join(__dirname, "..", "..", "..", "packages", "db", "prisma", "schema.prisma");
  const prismaCliPath = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "packages",
    "db",
    "node_modules",
    "prisma",
    "build",
    "index.js",
  );

  const MAX_ATTEMPTS = 3;
  const BASE_DELAY_MS = 5000;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      console.log(\`[start] prisma migrate deploy — tentativa \${attempt}/\${MAX_ATTEMPTS}\`);
      execFileSync(process.execPath, [prismaCliPath, "migrate", "deploy", "--schema", schemaPath], {
        stdio: "inherit",
        env: process.env,
      });
      console.log("[start] migrations do Prisma aplicadas com sucesso (ou já estavam em dia).");
      return;
    } catch (err) {
      if (attempt === MAX_ATTEMPTS) {
        console.error(
          \`[start] FALHA DEFINITIVA ao aplicar migrations do Prisma após \${MAX_ATTEMPTS} tentativas — abortando boot da API. \` +
            "Verifique DATABASE_URL e o estado de packages/db/prisma/migrations.",
        );
        throw err;
      }
      // Tentativa perdeu a corrida pelo advisory lock do Postgres (outra réplica
      // está aplicando migrations neste exato momento) ou houve instabilidade
      // transitória de rede/banco — espera com backoff e tenta de novo antes de
      // desistir e deixar o restart policy da plataforma assumir.
      const delayMs = BASE_DELAY_MS * attempt;
      console.error(
        \`[start] prisma migrate deploy falhou (tentativa \${attempt}/\${MAX_ATTEMPTS}); tentando novamente em \${delayMs}ms.\`,
        err && err.message ? err.message : err,
      );
      sleepMs(delayMs);
    }
  }
}

if (!isWorker) {
  try {
    runMigrateDeploy();
  } catch (err) {
    console.error("[start] boot abortado: migrations do Prisma não puderam ser aplicadas.", err);
    process.exit(1);
  }
}

require(isWorker ? "./worker.cjs" : "./server.cjs");
`,
);

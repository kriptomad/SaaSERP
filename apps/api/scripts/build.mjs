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
writeFileSync(
  "dist/start.cjs",
  'require(process.env.APP_ROLE === "worker" ? "./worker.cjs" : "./server.cjs");\n',
);

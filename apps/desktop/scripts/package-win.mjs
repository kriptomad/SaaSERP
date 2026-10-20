// apps/desktop/scripts/package-win.mjs
// CORREÇÃO DE AUDITORIA (fa-w5-desktop-code-signing-not-configured,
// fa-w5-desktop-update-trust-incomplete): o script anterior chamava
// `electron-builder --win --publish=never` HARDCODED — mesmo em CI com secrets de
// assinatura/feed de atualização reais configurados, o instalador nunca seria
// publicado. Este wrapper decide a política de publicação EM TEMPO DE BUILD, a partir
// de variáveis de ambiente, seguindo o mesmo padrão "opcional via env var, sem quebrar
// localmente sem elas" já usado para SENTRY_DSN/VITE_SENTRY_DSN (ver
// apps/api/src/lib/sentry.ts, apps/web/src/lib/sentry.ts):
//
//   - Sem nenhuma variável de produção configurada (ambiente de dev local/este
//     sandbox): publica "never" — gera só o instalador local em `release/`, igual ao
//     comportamento anterior. Nenhuma mudança de comportamento para quem não configurou
//     nada.
//   - Com `DESKTOP_UPDATE_FEED_URL` definida (feed real de atualização, ex. um bucket
//     R2/S3 ou servidor "generic" do electron-updater) E/OU `CSC_LINK`+`CSC_KEY_PASSWORD`
//     definidos (certificado Authenticode real, mecanismo PADRÃO do electron-builder —
//     NÃO reimplementado aqui, só não impedido): publica "always".
//
// Assinatura de código em si: NÃO precisa de nenhuma config adicional além de
// `CSC_LINK`/`CSC_KEY_PASSWORD` no ambiente — o electron-builder já detecta essas
// variáveis automaticamente para o target `win`. Este script só garante que nada aqui
// as sobrescreve nem desativa a detecção (não passamos `--sign` nem setamos `sign:
// null`/`forceCodeSigning` em nenhum lugar da config).
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");

const hasUpdateFeed = Boolean(process.env.DESKTOP_UPDATE_FEED_URL);
const hasSigningCert = Boolean(process.env.CSC_LINK && process.env.CSC_KEY_PASSWORD);
const explicitPolicy = process.env.DESKTOP_PUBLISH_POLICY; // override manual opcional: "always" | "never" | "onTag" | "onTagOrDraft"

const publishPolicy = explicitPolicy ?? (hasUpdateFeed || hasSigningCert ? "always" : "never");

if (publishPolicy === "never") {
  console.log(
    "[package-win] DESKTOP_UPDATE_FEED_URL/CSC_LINK+CSC_KEY_PASSWORD não configurados — " +
      "gerando apenas instalador local (publish=never), sem assinatura de código real. " +
      "Isso é esperado em dev local; configure essas variáveis em CI para builds de produção " +
      "assinados e publicados (ver apps/desktop/.env.example e README.md).",
  );
} else {
  console.log(
    `[package-win] publicando com política "${publishPolicy}" ` +
      `(feed de atualização: ${hasUpdateFeed ? "configurado" : "ausente"}, ` +
      `certificado de assinatura: ${hasSigningCert ? "configurado" : "ausente"}).`,
  );
}

const result = spawnSync(
  "npx",
  ["--no-install", "electron-builder", "--win", "--publish", publishPolicy],
  { cwd: desktopRoot, stdio: "inherit", shell: process.platform === "win32" },
);

if (result.error) {
  console.error("[package-win] falha ao executar electron-builder:", result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);

// apps/api/scripts/generate-jwt-keys.js
// Gera o par de chaves RS256 exigido pelo Capítulo 3.5 (JWT custom, não Auth0/Keycloak).
// Uso: node scripts/generate-jwt-keys.js
// Gera keys/jwt-private.pem e keys/jwt-public.pem (NUNCA versionar keys/ — ver .gitignore).
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const keysDir = join(__dirname, "..", "keys");

if (!existsSync(keysDir)) {
  mkdirSync(keysDir, { recursive: true });
}

const privatePath = join(keysDir, "jwt-private.pem");
const publicPath = join(keysDir, "jwt-public.pem");

if (existsSync(privatePath) || existsSync(publicPath)) {
  console.error("Chaves já existem em apps/api/keys/. Remova-as manualmente antes de gerar novas (isso invalida todas as sessões ativas).");
  process.exit(1);
}

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "pkcs1", format: "pem" },
});

writeFileSync(privatePath, privateKey, { mode: 0o600 });
writeFileSync(publicPath, publicKey, { mode: 0o644 });

console.log(`Par de chaves RS256 gerado:\n  ${privatePath}\n  ${publicPath}`);
console.log("Defina JWT_PRIVATE_KEY_PATH e JWT_PUBLIC_KEY_PATH no .env apontando para esses arquivos.");

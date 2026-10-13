// Carrega o par RS256 (Capítulo 3.5). Aceita o PEM direto em variável de ambiente
// (JWT_PRIVATE_KEY / JWT_PUBLIC_KEY — necessário no Railway, que não monta arquivos
// secretos e cuja imagem distroless não tem shell para gravá-los no boot) ou, como
// antes, o caminho de um arquivo (JWT_PRIVATE_KEY_PATH / JWT_PUBLIC_KEY_PATH).
import { readFileSync } from "node:fs";

function loadKey(inlineVar: string, pathVar: string): string {
  const inline = process.env[inlineVar];
  if (inline) return inline.replace(/\\n/g, "\n");
  const path = process.env[pathVar];
  if (!path) throw new Error(`Defina ${inlineVar} (conteúdo PEM) ou ${pathVar} (caminho do arquivo).`);
  return readFileSync(path, "utf8");
}

export const JWT_PRIVATE_KEY = loadKey("JWT_PRIVATE_KEY", "JWT_PRIVATE_KEY_PATH");
export const JWT_PUBLIC_KEY = loadKey("JWT_PUBLIC_KEY", "JWT_PUBLIC_KEY_PATH");

// apps/desktop/electron/config-store.ts
// Persistência local do estado de instalação do shell desktop: modo (HOST/CLIENT),
// config de rede, host configurado (modo CLIENT) e cache do token de licença.
// Usa electron-store (JSON em app.getPath("userData")), não um banco — é configuração
// de MÁQUINA, não dado de negócio (esse vive no Postgres via apps/api).
import Store from "electron-store";
import { safeStorage } from "electron";
import type { DesktopConfig } from "./ipc-contract";

// CORREÇÃO DE AUDITORIA (fa-desktop-host-backend-bind-all): o bind default deixou de
// ser "0.0.0.0" (todas as interfaces, exposto silenciosamente para qualquer coisa na
// LAN/Wi-Fi sem o lojista perceber) — agora o default é loopback puro (127.0.0.1, só
// este PC) até o usuário escolher EXPLICITAMENTE um IP de rede na tela
// `HostNetworkConfig.tsx` (que agora exige confirmação e exibe aviso de firewall/TLS).
// Expor em todas as interfaces continua possível, mas deixou de ser o default mudo.
const DEFAULT_CONFIG: DesktopConfig = {
  installMode: null,
  network: {
    bindAddress: "127.0.0.1",
    port: 3333,
    backupFolderPath: null,
    backupSchedule: "DAILY",
    databaseUrl: "postgresql://postgres:postgres@localhost:5432/filitech?schema=public",
  },
  clientHost: null,
  session: null,
  deviceId: null,
  license: null,
  onboardingComplete: false,
};

// electron-store tipa o schema via genérico; cada chave de DesktopConfig vira uma raiz
// própria no JSON para permitir leituras/escritas parciais (store.get("network")).
export const configStore = new Store<DesktopConfig>({
  name: "filitech-desktop-config",
  defaults: DEFAULT_CONFIG,
  clearInvalidConfig: true,
});

// CORREÇÃO DE AUDITORIA (fa-desktop-plaintext-secrets): `electron-store` grava JSON em
// texto puro em disco. Tokens (sessão, licença) e a connection string do Postgres
// (pode conter senha) são segredos reais e não devem ficar legíveis por qualquer
// processo/usuário com acesso ao arquivo. Usamos `safeStorage` do Electron (DPAPI no
// Windows, Keychain no macOS, libsecret no Linux) para cifrar essas strings antes de
// persistir, e decifrar na leitura — nunca ficam em claro em
// `filitech-desktop-config.json`. Prefixo `enc:v1:` versiona o formato e permite
// detectar valores legados já gravados em claro (instalações anteriores a esta correção).
const ENC_PREFIX = "enc:v1:";

function encryptSecret(plain: string | null): string | null {
  if (plain === null) return null;
  if (!safeStorage.isEncryptionAvailable()) {
    // Sem backend de criptografia do SO disponível (ex. CI headless/Linux sem
    // keyring) — mantém em claro em vez de falhar o app inteiro, mas nunca finge
    // estar cifrado adicionando o prefixo sem realmente cifrar.
    return plain;
  }
  return ENC_PREFIX + safeStorage.encryptString(plain).toString("base64");
}

function decryptSecret(stored: string | null): string | null {
  if (stored === null) return null;
  if (!stored.startsWith(ENC_PREFIX)) return stored; // valor legado em claro ou sem criptografia disponível
  if (!safeStorage.isEncryptionAvailable()) return null; // não é possível decifrar nesta máquina/sessão
  try {
    return safeStorage.decryptString(Buffer.from(stored.slice(ENC_PREFIX.length), "base64"));
  } catch {
    return null;
  }
}

export function getFullConfig(): DesktopConfig {
  const network = configStore.get("network");
  const session = configStore.get("session");
  const license = configStore.get("license");
  return {
    installMode: configStore.get("installMode"),
    network: { ...network, databaseUrl: decryptSecret(network.databaseUrl) ?? "" },
    clientHost: configStore.get("clientHost"),
    session: session ? { ...session, token: decryptSecret(session.token) ?? "" } : null,
    deviceId: configStore.get("deviceId"),
    license: license ? { ...license, token: license.token ? decryptSecret(license.token) : null } : null,
    onboardingComplete: configStore.get("onboardingComplete"),
  };
}

/**
 * Uso interno apenas (chamado pelo próprio main.ts após validar/autenticar — NUNCA
 * exposto diretamente como IPC genérico para o renderer, ver fa-desktop-config-patch-bypass).
 */
export function patchConfig(patch: Partial<DesktopConfig>): DesktopConfig {
  const encrypted: Partial<DesktopConfig> = { ...patch };
  if (patch.network) {
    encrypted.network = { ...patch.network, databaseUrl: encryptSecret(patch.network.databaseUrl) ?? "" };
  }
  if ("session" in patch) {
    encrypted.session = patch.session ? { ...patch.session, token: encryptSecret(patch.session.token) ?? "" } : null;
  }
  if ("license" in patch) {
    encrypted.license = patch.license
      ? { ...patch.license, token: patch.license.token ? encryptSecret(patch.license.token) : null }
      : null;
  }
  for (const [key, value] of Object.entries(encrypted)) {
    configStore.set(key as keyof DesktopConfig, value as never);
  }
  return getFullConfig();
}

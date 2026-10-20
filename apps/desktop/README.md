# @filitech/desktop — Filitech ERP Desktop (Electron)

Shell Electron standalone para instalação on-premise do Filitech ERP no PC/servidor do
lojista. Não duplica a UI de negócio: reaproveita `apps/web` (carregado em sua própria
`BrowserWindow`) e `apps/api` (gerenciado como child_process quando em modo HOST).

## Arquitetura

```
apps/desktop/
  electron/           # processo principal (Node) — compilado via tsc -> dist-electron/
    main.ts             janelas, IPC, orquestração geral
    preload.ts           contextBridge (window.filitech) — único ponto de acesso do renderer ao main
    erp-preload.ts        preload dedicado da janela do apps/web (ERP) — expõe só
                          `window.filitech.{apiBaseUrl,sso}`, entregues via IPC síncrono
                          (`ERP_BOOTSTRAP`), nunca por query string da URL
    backend-manager.ts   spawn/stop do child_process de apps/api (modo HOST)
    config-store.ts      electron-store — config de máquina (modo, rede, host, licença)
    network-utils.ts     ping HTTP/TCP, listagem de IPs locais da LAN
    validation.ts         schemas zod — todo payload de IPC é validado antes de tocar o config-store
    license-keys.ts/license-verify.ts  verificação de assinatura RS256 do token offline de licença
    ipc-contract.ts      tipos e nomes de canal IPC compartilhados main/renderer
  src/                # renderer PRÓPRIO deste shell (onboarding/config/dashboard) — bundlado via Vite
    screens/             WelcomeModeSelect, HostNetworkConfig, ClientHostConfig,
                          LicenseActivation, HostDashboard, ClientLauncher
    api/desktopApi.ts    tipagem do bridge exposto no preload
```

A UI de negócio real (PDV, vendas, estoque, financeiro, etc.) **não é reimplementada
aqui** — é a própria `apps/web`, carregada por `main.ts` em uma segunda `BrowserWindow`
(`window:open-erp`), usando um preload dedicado (`erp-preload.ts`) que recebe a API base
URL e a sessão de SSO via um canal IPC síncrono (`ERP_BOOTSTRAP`), lido ANTES de
qualquer script da página rodar — **nunca via query string da URL** (ver seção
"Correções de auditoria de segurança" abaixo). Isso exigiu uma pequena extensão em
`apps/web/src/api/client.ts` (`resolveApiBaseUrl()`), que passou a aceitar esse override
em runtime (lendo `window.filitech.apiBaseUrl`) antes de cair no `VITE_API_BASE_URL` de
build — sem quebrar o uso normal do `apps/web` como SPA web puro (a propriedade só
existe dentro do shell Electron; na web pública o comportamento é inalterado).

## Dois modos de instalação

- **HOST**: o shell sobe `apps/api` localmente via `child_process` (dev: `tsx watch
  src/server.ts`, igual ao `npm run api:dev` da raiz; produção: binário buildado +
  `node_modules` de produção empacotados como sidecar, ver "Empacotamento" abaixo), com
  IP de bind/porta configuráveis, e serve os demais PCs da loja na rede local. Abre um dashboard com ping periódico em `/health` e nas rotas
  críticas (`/auth`, `/sales`, `/cash-registers/current`), status do child_process e
  configuração de pasta/agendamento de backup.
- **CLIENT (usuário)**: não sobe nada localmente — só pergunta IP:porta do PC HOST,
  testa conectividade (`GET /health`) e abre a janela do `apps/web` apontando para lá.
  Pode reconfigurar o host a qualquer momento (ex. PC central mudou de IP).

## Banco de dados em modo HOST — decisão honesta sobre Postgres embutido

**Não embutimos um PostgreSQL completo dentro do instalador.** Pesquisamos as opções:

- `embedded-postgres` (npm): baixa um binário standalone do Postgres por plataforma e o
  gerencia via child_process, de forma parecida com o que fazemos com `apps/api`. É
  **tecnicamente viável**, mas adiciona ~150-200MB ao instalador, exige lidar com
  versionamento/patches de segurança do binário embutido separadamente do resto do
  sistema, e não foi validada neste ambiente (sandbox sem download de binários
  grandes — ver seção de limitações). Fica documentada como caminho futuro real, não
  fantasiado.
- **Caminho adotado na v1**: a tela de configuração de rede (`HostNetworkConfig.tsx`)
  pede a connection string de um PostgreSQL já instalado no PC (local ou acessível na
  rede) — a mesma abordagem usada em produção (Railway) hoje. É a opção honesta e
  comprovadamente estável; o README de instalação deve linkar o instalador oficial do
  PostgreSQL para Windows.

Redis (BullMQ) segue a mesma lógica: requer uma instância acessível via `REDIS_URL`
(local via WSL/Memurai no Windows, ou remota). Não foi embutido nesta versão.

## Licenciamento (login + ativação + trial + cache offline)

Consome o contrato REAL de `apps/api/src/modules/licensing/licensing.routes.ts`
(`POST /licensing/trial`, `POST /licensing/activate`, `GET /licensing/status`), que
exige sessão autenticada (`requireAuth`) — a licença mestra é sempre consultada no
contexto de um usuário de sistema já logado do tenant (Capítulo 2.10). Por isso a tela
de licenciamento (`LicenseActivation.tsx`) tem dois estágios reais:

1. **Login** (`POST /auth/login`, o MESMO endpoint usado pelo `apps/web`): slug + e-mail
   + senha de qualquer usuário do tenant (Owner ou funcionário criado por ele). O JWT
   retornado é cacheado em `electron-store` (`config-store.ts`, chave `session`).
2. **Trial ou Ativação**: com a sessão já autenticada, `POST /licensing/trial` concede o
   trial de 15 dias (uma única vez por tenant) e, em seguida, já chama
   `POST /licensing/activate` automaticamente para emitir o token offline deste
   dispositivo (`deviceFingerprint` = UUID estável gerado e persistido localmente,
   `config-store.ts` chave `deviceId`). "Ativar este dispositivo" chama
   `/licensing/activate` diretamente (licença mestra já paga/ativa).

O token offline é cacheado via `electron-store` (chave `license`), nunca em
`localStorage` do renderer. `checkLicenseStatus` tenta revalidar contra
`GET /licensing/status` (com o JWT de sessão) quando há rede; se falhar (offline, sem
sessão, ou backend fora do ar), cai para validação 100% local comparando
`license.offlineTokenExpiresAt` com a data atual.

**SSO para a janela do ERP:** a mesma sessão (`TenantSessionCache`, shape idêntico ao
`AuthResponse` de `apps/web/src/api/client.ts`) é repassada para a `BrowserWindow` do
`apps/web` via o canal IPC síncrono `ERP_BOOTSTRAP` quando `window:open-erp` é chamado —
o usuário loga uma única vez no shell desktop e nunca precisa logar de novo na janela do
ERP. `erp-preload.ts` lê esse canal (`ipcRenderer.sendSync`) ANTES de qualquer script da
página rodar e expõe `window.filitech.sso`; `apps/web/src/api/client.ts`
(`consumeSsoFromBridge`) lê essa propriedade no boot e grava o token/tenant/user. O
registro é apagado no main após a primeira leitura de cada janela (uso único) — o token
nunca passa pela URL, histórico de navegação ou cabeçalho `Referer`.

Fluxo de resolução da API alvo para login/licenciamento/ERP (todas as chamadas):
1. Modo HOST → backend local (`http://127.0.0.1:<porta>`).
2. Modo CLIENT → o host configurado pelo usuário.
3. Nenhum modo ainda escolhido → API central na nuvem (`FILITECH_CLOUD_API_URL`, default
   `https://api.filitech.com.br` — ajustar para o domínio real de produção).

## Contingência de venda offline

Confirmado por leitura de `apps/web/src/shared/offline/sync-pending-sales.ts`: o sync
de vendas pendentes chama `POST /sales` — **a mesma rota usada no fluxo online normal**,
que já aciona o orquestrador de venda (`apps/api/src/modules/sales/close-sale.service.ts`)
e, por consequência, as integrações de estoque/financeiro/fiscal/fidelidade associadas a
toda venda. **Não foi necessário completar nada aqui** — o sync já não grava "venda
crua", ele reaproveita o mesmo caminho transacional de uma venda online. O shell desktop
não precisa (e não deve) reimplementar essa lógica: tanto modo HOST (se o Postgres/Redis
caírem) quanto modo CLIENT (se o PC HOST ficar inacessível) continuam vendendo via Dexie
+ Service Worker + Background Sync já existentes, e sincronizam pelo mesmo mecanismo
assim que a rede volta.

## Pequenas mudanças feitas em outros pacotes (tightly-coupled a esta feature)

- `apps/web/src/api/client.ts`: `resolveApiBaseUrl()` passou a aceitar override via
  `?apiBaseUrl=` (usado pelo Electron); exportada e reaproveitada por
  `sync-pending-sales.ts` e `sync-catalog.ts` para não duplicar a lógica.
- `apps/api/src/server.ts`: `/health` agora também reporta status do Redis (usado pelo
  dashboard HOST) e o bind de rede passou a respeitar `process.env.HOST` (default
  `0.0.0.0`), necessário para a tela de config de rede do modo HOST escolher um IP
  específico da LAN em vez de todas as interfaces.

## Empacotamento (.exe)

`npm run package:win` roda, em sequência: `npm run build` (renderer Vite + main process
`tsc`) → `npm run prepare:api-resources` → `node scripts/package-win.mjs` (wrapper que
chama `electron-builder --win --publish <política>`, política decidida em tempo de
build — ver seção "Assinatura de código e auto-update" abaixo).

O passo `prepare:api-resources` (`scripts/prepare-api-resources.mjs`) é o que fecha o
gap que antes era pendência (Rodada 4 do mega-audit): ele builda `apps/api` de verdade
(`npm run build`, o MESMO script usado no deploy em nuvem), copia o `dist/` gerado para
`apps/desktop/resources-build/api/dist`, gera ali um `package.json` mínimo só com as
`dependencies` reais de produção de `apps/api` (as mesmas marcadas como `external` pelo
esbuild) + `@prisma/client`, roda `npm install --omit=dev` nesse diretório (baixando os
binários nativos pré-compilados, ex. `argon2` via `prebuild-install`, para a
plataforma/arquitetura da máquina que está empacotando) e copia o cliente Prisma já
gerado (`packages/db/node_modules/.prisma/client`) para dentro desse `node_modules`. O
`package.json` do desktop então empacota esse diretório inteiro via `extraResources`
(`resources-build/api` → `resources/api`), exatamente onde `backend-manager.ts` já
esperava encontrá-lo (`resources/api/dist/server.cjs`).

Também foi corrigido um bug real em `backend-manager.ts`: em produção, `process.execPath`
aponta para o binário do PRÓPRIO Electron (não um Node.js "puro"), então o spawn do
backend agora passa `ELECTRON_RUN_AS_NODE=1` no ambiente do child_process — sem essa
variável o Electron tentaria abrir uma segunda janela do Chromium em vez de rodar
`server.cjs` como script Node. Módulos nativos N-API (`argon2`) continuam funcionando
nesse modo normalmente, pois N-API é estável entre o Node embutido no Electron e um Node
"puro" de mesma plataforma/arquitetura.

**Limitação honesta que permanece** (não validável neste ambiente sandbox, requer
hardware real): o passo `prepare:api-resources` em si FOI validado de ponta a ponta
nesta sessão (build real + `npm install --omit=dev` de 425 pacotes de produção,
incluindo `argon2` — confirmado `require("argon2").hash(...)` funcionando via prebuild
nativo embutido no próprio pacote, e `require("@prisma/client")` resolvendo contra o
cliente copiado). O que NÃO foi rodado aqui é a geração efetiva do instalador NSIS via
`electron-builder --win` (mesma classe de limitação de rede/proxy já documentada abaixo
para o download do binário do Electron). Empacotar para uma arquitetura diferente da
máquina que roda o script (ex. gerar instalador ARM64 numa máquina x64) também não é
resolvido por este script — exige rodá-lo numa máquina/CI daquela arquitetura.

## Correções de auditoria de segurança/robustez (30 findings `fa-desktop-*`)

Esta seção documenta, em alto nível, as correções aplicadas a partir da auditoria do
app Electron. Detalhes linha-a-linha estão nos comentários `CORREÇÃO DE AUDITORIA
(fa-desktop-<id>)` espalhados pelo código.

- **IPC/config**: o antigo canal genérico `CONFIG_SET` (aceitava `Partial<DesktopConfig>`
  arbitrário, incluindo `license`/`session`) foi removido; cada campo tem um canal
  próprio (`CONFIG_SET_INSTALL_MODE`/`_NETWORK`/`_CLIENT_HOST`/`_ONBOARDING_COMPLETE`),
  todos validados por schema zod (`validation.ts`) e restritos à janela do launcher
  (`assertTrustedSender`). `license`/`session`/`deviceId` só são gravados pelo próprio
  main, nunca a partir de payload do renderer.
- **Segredos em disco**: `databaseUrl`, `session.token` e `license.token` são
  criptografados em repouso via `safeStorage` (DPAPI no Windows) antes de irem para o
  `electron-store`; cai para texto plano apenas se `safeStorage` não estiver disponível
  na máquina (indisponibilidade de DPAPI), caso documentado em comentário no
  `config-store.ts`.
- **Bind de rede padrão**: o padrão para instalações novas passou de `0.0.0.0` para
  `127.0.0.1`; `0.0.0.0` continua disponível na tela de config de rede para quem
  precisa servir a LAN, agora com um aviso explícito sobre expor a porta sem TLS/sem
  firewall.
- **Navegação/janelas**: `webSecurity: true` em ambas as janelas; `sandbox: true` em
  ambas (fa-w5-desktop-sandbox-disabled — os dois preloads só usam `contextBridge`/
  `ipcRenderer`, 100% sandbox-compatível no Electron 33, nenhuma funcionalidade
  perdida); `will-navigate` e `setWindowOpenHandler` restringem navegação/popups a uma
  allowlist; downloads vão para diálogo "Salvar como" em vez de navegar embutido.
- **CSP (fa-w5-desktop-csp-overbroad)**: a CSP de `index.html` (janela launcher) foi
  restrita de `default-src 'self' 'unsafe-inline' data: http: https: ws:` (praticamente
  qualquer origem/script inline) para diretivas explícitas (`script-src 'self'`,
  `connect-src 'self'`, `object-src 'none'`, etc.) — esta janela nunca faz fetch/XHR
  direto (toda chamada de rede passa pelo processo main via IPC) e não tem nenhum
  `<script>` inline, então não há perda de funcionalidade. `style-src` mantém
  `'unsafe-inline'` porque Emotion/MUI injeta `<style>` em runtime.
- **Crash reporting (fa-w5-desktop-crash-reporting-missing)**: `@sentry/electron`
  integrado no processo main (`electron/sentry.ts`) e no renderer do launcher
  (`src/main.tsx`), opcional via `DESKTOP_SENTRY_DSN`/`VITE_DESKTOP_SENTRY_DSN` (mesmo
  padrão no-op de `apps/api/src/lib/sentry.ts`/`apps/web/src/lib/sentry.ts` — sem DSN,
  zero overhead e zero dependência de rede). Captura crashes nativos das janelas e
  exceções não tratadas do processo main automaticamente ao inicializar.
- **Segredos — fallback sem criptografia (fa-w5-desktop-secret-plaintext-fallback)**:
  quando `safeStorage` não está disponível, `config-store.ts` continua gravando em
  texto puro (necessário para não quebrar instalações headless/Linux sem keyring), mas
  agora loga um `console.error`/`console.warn` explícito (visível em diagnóstico/crash
  reports) toda vez que isso acontece, em vez de degradar silenciosamente.
- **Licença offline**: o token offline agora é validado criptograficamente (RS256,
  `license-verify.ts`) — emissor, expiração, `deviceFingerprint` e `tenantId` são
  conferidos contra o estado local antes de considerar a licença válida; o preload
  apenas repassa o resultado já validado pelo main (nenhuma lógica de confiança no
  renderer).
- **Backend local (modo HOST)**: início/parada agora são serializados (sem condição de
  corrida entre cliques rápidos), o status "rodando" é confirmado por polling real em
  `/health` (não mais por parse de linhas de log nem timeout fixo "otimista"), e o
  processo filho é encerrado via árvore de processos (`taskkill /T /F` no Windows) com
  espera pela saída real antes de liberar o estado — elimina processos zumbi.
- **SSRF**: `pingUrl` usa `redirect: "error"` (bloqueia redirecionamento para
  IP/host não autorizado) e o canal `NETWORK_PING_URL` só aceita origens já presentes na
  config salva; o teste de conectividade de um host **ainda não salvo** (tela
  "Configurar PC servidor") usa um canal dedicado (`NETWORK_TEST_CANDIDATE_HOST`),
  validado por schema estrutural (host/porta), nunca por URL livre.
- **Auto-update**: `electron-updater` foi integrado (`autoUpdater.checkForUpdatesAndNotify()`,
  guardado por `app.isPackaged`).
- **Assinatura de código e auto-update — status atual (fa-w5-desktop-code-signing-not-configured,
  fa-w5-desktop-update-trust-incomplete)**: o gap aqui NÃO é mais de código, é só de
  **secrets de CI pendentes**. A configuração já está totalmente wired:
  - `package.json#build.publish[0].url` usa interpolação `${env.DESKTOP_UPDATE_FEED_URL}`
    do electron-builder — nunca mais uma URL placeholder hardcoded.
  - `scripts/package-win.mjs` (chamado por `npm run package:win`) decide a política de
    publicação em tempo de build: sem `DESKTOP_UPDATE_FEED_URL`/`CSC_LINK`+
    `CSC_KEY_PASSWORD` configurados, força `--publish never` automaticamente (gera só
    o instalador local, igual ao comportamento anterior); com qualquer um definido,
    publica (`--publish always`).
  - Assinatura Authenticode em si usa a convenção PADRÃO do electron-builder
    (`CSC_LINK`/`CSC_KEY_PASSWORD` no ambiente) — nada na config do `package.json` a
    desativa ou sobrescreve.
  - **O que falta de verdade para builds de release assinados/publicados**: um
    certificado Authenticode real (`CSC_LINK`/`CSC_KEY_PASSWORD`) e um domínio HTTPS
    real servindo o feed de updates (`DESKTOP_UPDATE_FEED_URL`), ambos configurados
    como secrets no CI — **não é alcançável neste ambiente sandbox** (não é possível
    obter/validar um certificado de assinatura de código real aqui). Ver
    `apps/desktop/.env.example` para a lista completa de variáveis e
    `scripts/package-win.mjs` para a lógica.
- **TEF/pinpad — gap de escopo conhecido, documentado e não implementado**: a auditoria
  apontou corretamente que não existe nenhuma ponte TEF/pinpad (nenhum módulo, IPC ou
  bridge nativa) neste app, apesar de ser um requisito de MVP para o PDV físico.
  **Esta correção pontual NÃO implementa TEF/pinpad** — é um item de escopo maior que
  exige um esforço dedicado próprio: bridge nativa para o driver/protocolo oficial do
  fabricante do pinpad, validação estrita de comandos (nunca aceitar comandos brutos
  vindos do renderer sem whitelist), timeouts, correlação de transação,
  idempotência e proteção contra replay. Ver também o marcador em
  `electron/main.ts` (busque por `fa-desktop-no-tef-pinpad`) e o item correspondente de
  licenciamento/compliance de PDV físico para planejamento futuro.



- O download do binário do Electron (~110MB, GitHub Releases) sofria `ECONNRESET`
  repetido via `npm install` normal neste ambiente. Contornado baixando manualmente via
  `curl.exe` (que lidou melhor com o proxy corporativo configurado) para o cache local
  esperado por `@electron/get`
  (`%LOCALAPPDATA%\electron\Cache\<hash>\electron-v33.4.11-win32-x64.zip` +
  `SHASUMS256.txt`) e então rodando `node node_modules/electron/install.js` — depois
  disso `npm install` normal funciona. **Em um ambiente de desenvolvimento real (sem essa
  restrição de rede), `npm install` sozinho já resolve tudo.**
- Validado nesta sessão: `npm run build:electron` + `npm run build:renderer` + lançar
  `electron apps/desktop` abriu de fato uma janela "Filitech ERP Desktop" (confirmado via
  `Get-Process | Select MainWindowTitle`), sem erros no stderr.
- **Não validado neste ambiente** (requer hardware/ambiente real): instalação de um
  PostgreSQL real e o `/health` reportando `database: up`; duas instâncias reais numa
  mesma LAN (HOST + CLIENT); o fluxo completo de licenciamento contra o módulo
  `license-system` (ainda não publicado); geração do instalador `.exe` via
  `electron-builder --win` (depende de binários adicionais do `electron-builder`,
  ex. NSIS, que teriam o mesmo problema de download de binário grande visto acima —
  contornável com a mesma técnica de `curl.exe` manual se necessário).

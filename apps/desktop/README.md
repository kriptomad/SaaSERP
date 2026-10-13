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
    backend-manager.ts   spawn/stop do child_process de apps/api (modo HOST)
    config-store.ts      electron-store — config de máquina (modo, rede, host, licença)
    network-utils.ts     ping HTTP/TCP, listagem de IPs locais da LAN
    ipc-contract.ts      tipos e nomes de canal IPC compartilhados main/renderer
  src/                # renderer PRÓPRIO deste shell (onboarding/config/dashboard) — bundlado via Vite
    screens/             WelcomeModeSelect, HostNetworkConfig, ClientHostConfig,
                          LicenseActivation, HostDashboard, ClientLauncher
    api/desktopApi.ts    tipagem do bridge exposto no preload
```

A UI de negócio real (PDV, vendas, estoque, financeiro, etc.) **não é reimplementada
aqui** — é a própria `apps/web`, carregada por `main.ts` em uma segunda `BrowserWindow`
(`window:open-erp`), recebendo a API base URL via query string (`?apiBaseUrl=...`).
Isso exigiu uma pequena extensão em `apps/web/src/api/client.ts`
(`resolveApiBaseUrl()`), que passou a aceitar esse override em runtime antes de cair no
`VITE_API_BASE_URL` de build — sem quebrar o uso normal do `apps/web` como SPA web puro
(o parâmetro é opcional e ignorado fora do contexto Electron).

## Dois modos de instalação

- **HOST**: o shell sobe `apps/api` localmente via `child_process` (dev: `tsx watch
  src/server.ts`, igual ao `npm run api:dev` da raiz; produção: pendência, ver
  "Limitações" abaixo), com IP de bind/porta configuráveis, e serve os demais PCs da
  loja na rede local. Abre um dashboard com ping periódico em `/health` e nas rotas
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

## Licenciamento (ativação + trial + cache offline)

Consome o contrato de `apps/api/src/modules/licensing/`
(`POST /licensing/activate`, `POST /licensing/trial`, `GET /licensing/status`),
construído em paralelo por outro agente ("license-system"). **Na data desta
implementação essas rotas ainda não existem no backend** — `main.ts` já está preparado
para consumi-las (`activateLicense`/`startTrial`/`checkLicenseStatus`), mas qualquer
chamada hoje retorna 404, e a tela de licenciamento mostra esse aviso com um botão
"Prosseguir mesmo assim" para não travar o onboarding (`onboardingComplete` é marcado
verdadeiro mesmo sem uma licença real cacheada). Assim que o módulo `license-system`
publicar as rotas, o fluxo passa a funcionar sem nenhuma mudança de código aqui.

Fluxo de resolução da API alvo para a chamada de licenciamento:
1. Modo HOST → backend local (`http://127.0.0.1:<porta>`).
2. Modo CLIENT → o host configurado pelo usuário.
3. Nenhum modo ainda escolhido → API central na nuvem (`FILITECH_CLOUD_API_URL`, default
   `https://api.filitech.com.br` — ajustar para o domínio real de produção).

O token retornado é cacheado via `electron-store` (`config-store.ts`, chave `license`),
nunca em `localStorage` do renderer. `checkLicenseStatus` tenta revalidar contra
`GET /licensing/status` quando há rede; se falhar (offline ou backend fora do ar), cai
para validação 100% local comparando `license.expiresAt` com a data atual — exatamente o
"uso offline dentro da janela de validade do token" pedido.

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

`npm run package:win` usa `electron-builder` (NSIS) — integra bem com Vite porque o
renderer já é um build Vite padrão (`dist/`) e o electron-builder só precisa apontar
para essa pasta mais o `dist-electron/` compilado via `tsc`. **Não foi gerado o `.exe`
final neste ambiente** (ver limitações abaixo) — o `package.json` já declara
`extraResources` copiando `apps/web/dist` para `resources/web` no pacote final, mas o
empacotamento de `apps/api` (incluindo seus `node_modules` nativos, ex. `argon2`) como um
processo "sidecar" dentro do instalador **ainda é uma pendência real**: hoje
`backend-manager.ts` sabe rodar `apps/api` em dev (via `tsx watch` dentro do próprio
monorepo) e já tem o caminho de produção esperado (`resources/api/dist/server.cjs`), mas
falta o passo de build que efetivamente copia `apps/api` + seus `node_modules` para lá
no empacotamento — não implementado nesta versão por exigir validação em ambiente real
(módulos nativos compilados para Windows), documentado aqui para a próxima iteração.

## Limitações conhecidas deste ambiente sandbox

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

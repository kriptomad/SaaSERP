// apps/desktop/electron/erp-preload.ts
// Preload DEDICADO da janela do apps/web (erpWindow) — nunca o mesmo preload.ts do
// launcher (que expõe config/backend/license/auth — superfície de ataque
// desnecessária para a janela de negócio real).
//
// CORREÇÃO DE AUDITORIA (fa-desktop-sso-in-url, fa-desktop-arbitrary-erp-url,
// fa-desktop-apibaseurl-override-web): antes, `apiBaseUrl` e o AuthResponse de SSO
// eram serializados na própria URL (`?apiBaseUrl=...&sso=<base64>`), ficando expostos
// em logs do Electron, histórico de navegação e no `Referer` de qualquer requisição
// subsequente feita pela página. Agora o bootstrap é entregue por um canal IPC
// síncrono dedicado (`ERP_BOOTSTRAP`), lido pelo preload ANTES de qualquer script da
// página rodar, nunca aparece na barra de endereço, e o main apaga o registro depois
// da primeira leitura (uso único por janela).
import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS, type ErpBootstrapPayload } from "./ipc-contract";

const bootstrap = ipcRenderer.sendSync(IPC_CHANNELS.ERP_BOOTSTRAP) as ErpBootstrapPayload;

contextBridge.exposeInMainWorld("filitech", {
  apiBaseUrl: bootstrap.apiBaseUrl,
  sso: bootstrap.sso,
});

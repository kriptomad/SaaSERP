// apps/web/src/shared/useSseStream.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 8.2 — SSE sem memory leaks no frontend.
// GAP DE AUDITORIA ENCONTRADO E CORRIGIDO: nenhum consumidor de EventSource existia.
// Usa `fetch` + ReadableStream (em vez do EventSource nativo) porque o backend
// exige um cabeçalho Authorization customizado e EventSource não permite headers
// customizados. O AbortController garante que a conexão é fechada e nenhum
// listener/timer sobrevive ao unmount do componente (useEffect cleanup).
// GAP DE AUDITORIA FECHADO (mega-audit round 3, r3-health-dashboard-realtime):
// `getToken` agora é parametrizável (antes hardcoded no token de sessão de
// tenant) — o painel de administração de plataforma usa uma sessão
// completamente separada (`getStoredPlatformAdminToken`, nunca o token de
// tenant) e precisava do mesmo hook sem duplicar toda a lógica de parsing/
// reconexão.
import { useEffect, useRef } from "react";
import { resolveApiBaseUrl, getStoredToken } from "../api/client";

export interface SseEvent {
  type: string;
  data: unknown;
}

/**
 * Conecta ao endpoint SSE informado (path relativo, ex.: "/notifications/stream")
 * e chama `onEvent` para cada evento `event: <tipo>\ndata: <json>` recebido.
 * Reconecta automaticamente com backoff simples se a conexão cair, e para de
 * tentar reconectar assim que o componente desmonta. `getToken` por padrão lê a
 * sessão de tenant; passe `getStoredPlatformAdminToken` (ou equivalente) para
 * conectar usando outra sessão.
 */
export function useSseStream(
  path: string,
  onEvent: (event: SseEvent) => void,
  enabled: boolean,
  getToken: () => string | null = getStoredToken,
): void {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let stopped = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    async function connect() {
      const token = getToken();
      if (!token) return;
      try {
        const response = await fetch(`${resolveApiBaseUrl()}${path}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        if (!response.ok || !response.body) throw new Error(`SSE HTTP ${response.status}`);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!stopped) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let separatorIndex: number;
          while ((separatorIndex = buffer.indexOf("\n\n")) !== -1) {
            const rawEvent = buffer.slice(0, separatorIndex);
            buffer = buffer.slice(separatorIndex + 2);
            if (rawEvent.startsWith(":")) continue; // heartbeat/comentário

            const lines = rawEvent.split("\n");
            const eventType = lines.find((l) => l.startsWith("event:"))?.slice(6).trim() ?? "message";
            const dataLine = lines.find((l) => l.startsWith("data:"))?.slice(5).trim();
            if (!dataLine) continue;
            try {
              onEventRef.current({ type: eventType, data: JSON.parse(dataLine) });
            } catch {
              // payload malformado: ignora este evento, mantém a conexão viva.
            }
          }
        }
      } catch (error) {
        if (controller.signal.aborted || stopped) return;
        // Reconecta com backoff fixo; nunca derruba a UI por falha de rede transitória.
        retryTimer = setTimeout(connect, 5_000);
      }
    }

    connect();

    return () => {
      stopped = true;
      controller.abort();
      if (retryTimer) clearTimeout(retryTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, enabled, getToken]);
}

// apps/api/src/modules/notifications/channels/push.channel.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 20.8 — canal de envio REAL de push via
// Expo Push API (docs.expo.dev/push-notifications/sending-notifications):
// `POST https://exp.host/--/api/v2/push/send`, corpo JSON = array de mensagens
// `{ to, title, body, data }`, máximo de 100 mensagens por requisição — contrato
// confirmado via pesquisa web nesta sessão de auditoria antes de escrever este arquivo.
//
// Sem credencial: o endpoint da Expo é público (qualquer app construído com Expo
// pode enviar push para seus próprios usuários sem autenticação de servidor), então,
// diferente de WhatsApp/e-mail, não há `IntegrationCredential` nenhuma aqui — a única
// pré-condição é ter ao menos um `PushDeviceToken` ativo do usuário-alvo.
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_TOKENS_PER_BATCH = 100;

export interface SendPushResult {
  success: boolean;
  message: string;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export async function sendExpoPushNotifications(
  tokens: string[],
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<SendPushResult> {
  if (tokens.length === 0) {
    return { success: false, message: "Nenhum dispositivo push ativo." };
  }

  try {
    const batches = chunk(tokens, MAX_TOKENS_PER_BATCH);
    const failures: string[] = [];
    for (const batch of batches) {
      const messages = batch.map((to) => ({ to, title, body, data }));
      const response = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(messages),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const bodyText = await response.text();
      if (!response.ok) {
        failures.push(`HTTP ${response.status}: ${bodyText.slice(0, 300)}`);
      }
    }
    if (failures.length > 0) {
      return { success: false, message: `Falha ao enviar push para ${failures.length} lote(s): ${failures.join(" | ")}` };
    }
    return { success: true, message: `Push enviado com sucesso para ${tokens.length} dispositivo(s).` };
  } catch (error) {
    return { success: false, message: `Falha de rede ao enviar push: ${(error as Error).message}` };
  }
}

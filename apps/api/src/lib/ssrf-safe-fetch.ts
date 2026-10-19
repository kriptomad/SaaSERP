// apps/api/src/lib/ssrf-safe-fetch.ts
// GAP DE AUDITORIA FECHADO (mega-audit rodada 10): `tenant-integrations.routes.ts`
// já bloqueava hosts/IPs privados LITERAIS na URL cadastrada (ex.: `http://127.0.0.1`),
// mas documentava explicitamente a lacuna: um domínio PÚBLICO que resolva (ou passe a
// resolver depois, via DNS rebinding) para um IP privado/metadata da nuvem
// (169.254.169.254) nunca era bloqueado, porque a validação só olhava a string da URL,
// nunca o IP real para onde o socket conecta. `fetch()` global também segue
// redirecionamentos automaticamente, permitindo uma 2ª URL (não validada) escondida
// atrás de uma 1ª URL pública legítima.
//
// Esta função resolve o DNS do host MANUALMENTE e usa o IP já validado como alvo de
// conexão (via opção `lookup` do `https.request`/`http.request` do Node, que recebe o
// socket diretamente — não há nenhuma janela entre "validar" e "conectar" para o DNS
// mudar de resposta, o que elimina o rebinding). Redirecionamentos NUNCA são seguidos
// automaticamente — uma resposta 3xx é tratada como entrega sem sucesso, nunca
// re-despachada para uma URL diferente da validada.
import * as dns from "node:dns";
import * as http from "node:http";
import * as https from "node:https";
import { URL } from "node:url";

export class UnsafeWebhookTargetError extends Error {}

const PRIVATE_IPV4_RANGES: Array<[number, number]> = [
  [ipToInt("0.0.0.0"), ipToInt("0.255.255.255")], // "este" host/rede
  [ipToInt("10.0.0.0"), ipToInt("10.255.255.255")],
  [ipToInt("100.64.0.0"), ipToInt("100.127.255.255")], // CGNAT
  [ipToInt("127.0.0.0"), ipToInt("127.255.255.255")], // loopback
  [ipToInt("169.254.0.0"), ipToInt("169.254.255.255")], // link-local, inclui metadata da nuvem
  [ipToInt("172.16.0.0"), ipToInt("172.31.255.255")],
  [ipToInt("192.0.0.0"), ipToInt("192.0.0.255")], // IETF protocol assignments
  [ipToInt("192.0.2.0"), ipToInt("192.0.2.255")], // TEST-NET-1
  [ipToInt("192.168.0.0"), ipToInt("192.168.255.255")],
  [ipToInt("198.18.0.0"), ipToInt("198.19.255.255")], // benchmark
  [ipToInt("198.51.100.0"), ipToInt("198.51.100.255")], // TEST-NET-2
  [ipToInt("203.0.113.0"), ipToInt("203.0.113.255")], // TEST-NET-3
  [ipToInt("224.0.0.0"), ipToInt("255.255.255.255")], // multicast + reservado
];

function ipToInt(ip: string): number {
  const parts = ip.split(".").map(Number);
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function isPrivateIpv4(ip: string): boolean {
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) return false;
  const value = ipToInt(ip);
  return PRIVATE_IPV4_RANGES.some(([start, end]) => value >= start && value <= end);
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized.startsWith("::ffff:")) {
    // IPv4-mapped — revalida a parte v4 embutida, nunca confia no prefixo v6 sozinho.
    return isPrivateIpv4(normalized.replace("::ffff:", ""));
  }
  return (
    normalized === "::1" || // loopback
    normalized === "::" ||
    normalized.startsWith("fc") || // unique local fc00::/7
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") || // link-local fe80::/10
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  );
}

function isPrivateOrReservedIp(ip: string, family: number): boolean {
  return family === 4 ? isPrivateIpv4(ip) : isPrivateIpv6(ip);
}

interface SsrfSafeFetchOptions {
  method: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}

export interface SsrfSafeFetchResult {
  statusCode: number;
}

// Entrega HTTP real de um webhook, com DNS resolvido e validado no MOMENTO da
// conexão TCP (nunca antes, nunca depois) e sem seguir redirecionamentos.
export function ssrfSafeFetch(targetUrl: string, options: SsrfSafeFetchOptions): Promise<SsrfSafeFetchResult> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(targetUrl);
    } catch {
      reject(new UnsafeWebhookTargetError(`URL de destino inválida: ${targetUrl}`));
      return;
    }
    if (parsed.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && parsed.protocol === "http:")) {
      reject(new UnsafeWebhookTargetError("Apenas URLs HTTPS são aceitas para entrega de webhook em produção."));
      return;
    }

    const transport = parsed.protocol === "https:" ? https : http;
    const request = transport.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method: options.method,
        headers: options.headers,
        timeout: options.timeoutMs,
        // Validação real do IP acontece AQUI, dentro do próprio resolvedor usado pelo
        // socket — o Node só conecta ao endereço que este callback aprovar via `cb`.
        lookup: (hostname, lookupOptions, callback) => {
          dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
            if (err) {
              callback(err, "", 0);
              return;
            }
            const list = addresses as dns.LookupAddress[];
            const unsafe = list.find((a) => isPrivateOrReservedIp(a.address, a.family));
            if (unsafe || list.length === 0) {
              callback(new UnsafeWebhookTargetError(`Host "${hostname}" resolve para um IP privado/reservado (${unsafe?.address ?? "nenhum IP"}) — entrega bloqueada (proteção SSRF).`), "", 0);
              return;
            }
            const chosen = list[0];
            callback(null, chosen.address, chosen.family);
          });
        },
      },
      (response) => {
        // 3xx NUNCA é seguido automaticamente — uma URL de redirecionamento é, por
        // definição, uma URL diferente da que foi validada/cadastrada pelo tenant.
        response.resume(); // drena o corpo para liberar o socket, descartando o conteúdo (irrelevante para o contrato de entrega)
        resolve({ statusCode: response.statusCode ?? 0 });
      },
    );

    request.on("timeout", () => request.destroy(new Error("Timeout ao entregar webhook.")));
    request.on("error", (err) => reject(err));
    request.write(options.body);
    request.end();
  });
}

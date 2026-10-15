// apps/api/src/lib/cidr-match.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 14.5 — allowlist de IP do painel do dono
// da plataforma. Suporta apenas IPv4 (`a.b.c.d` ou `a.b.c.d/bits`) — escopo
// deliberadamente limitado ao caso real de uso (VPN corporativa/IP fixo de
// escritório), sem suporte a IPv6 nesta fase; um IP IPv6 recebido (ex.: cliente
// conectando via rede que só oferece IPv6) nunca combina com nenhuma entrada e por
// isso é bloqueado por padrão — fail-closed, nunca fail-open por falta de suporte.
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    result = (result << 8) + octet;
  }
  return result >>> 0;
}

export function ipMatchesCidr(ip: string, cidrRange: string): boolean {
  // `::ffff:` é o prefixo IPv4-mapped-IPv6 usado por Node quando `trust proxy` extrai
  // o IP real de um cabeçalho X-Forwarded-For — normalizado para IPv4 puro antes de
  // comparar, senão toda entrada IPv4 cadastrada nunca combinaria.
  const normalizedIp = ip.startsWith("::ffff:") ? ip.slice("::ffff:".length) : ip;

  const [rangeIp, bitsRaw] = cidrRange.split("/");
  const bits = bitsRaw !== undefined ? Number(bitsRaw) : 32;
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;

  const ipInt = ipv4ToInt(normalizedIp);
  const rangeInt = ipv4ToInt(rangeIp);
  if (ipInt === null || rangeInt === null) return false;

  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

export function ipMatchesAnyCidr(ip: string, cidrRanges: string[]): boolean {
  return cidrRanges.some((range) => ipMatchesCidr(ip, range));
}

/** Valida o formato `a.b.c.d` ou `a.b.c.d/bits` antes de persistir uma entrada da allowlist. */
export function isValidCidrRange(cidrRange: string): boolean {
  const [rangeIp, bitsRaw] = cidrRange.split("/");
  if (bitsRaw !== undefined) {
    const bits = Number(bitsRaw);
    if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  }
  return ipv4ToInt(rangeIp) !== null;
}

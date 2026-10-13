// apps/web/src/shared/ui/format.ts
// Decimais do Prisma chegam como string no JSON; estes helpers normalizam exibição e entrada.
export function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function money(value: string | number | null | undefined): string {
  return toNumber(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function qty(value: string | number | null | undefined): string {
  return toNumber(value).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR");
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

// Aceita "12,50", "1.234,50" e "12.50"; retorna null quando vazio/inválido.
export function parseDecimal(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const normalized = trimmed.includes(",") ? trimmed.replace(/\./g, "").replace(",", ".") : trimmed;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

// <input type="date"> -> ISO (meio-dia local evita virar o dia anterior por fuso).
export function dateInputToIso(value: string): string {
  return new Date(`${value}T12:00:00`).toISOString();
}

export function toDateInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function toDateTimeLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${toDateInput(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

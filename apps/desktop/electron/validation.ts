// apps/desktop/electron/validation.ts
// Validação runtime compartilhada entre o processo main (electron/main.ts) e o
// renderer deste shell (src/screens/*.tsx) — nunca confiamos apenas em tipos
// TypeScript (que desaparecem em runtime) para dados vindos de IPC ou de input do
// usuário. Usa zod (já dependência de apps/api, agora também de apps/desktop).
//
// CORREÇÃO DE AUDITORIA: fa-desktop-ipc-no-schema-validation, fa-desktop-client-host-config-no-validation.
import { z } from "zod";

// NOTA: este módulo é importado tanto pelo processo main (Node puro) quanto pelos
// `src/screens/*.tsx` do renderer (bundlado pelo Vite). Por isso NÃO usamos `node:net`
// aqui (o Vite o externaliza como stub vazio no bundle de browser, quebrando a
// validação em runtime no renderer) — a checagem de IPv4/IPv6 é feita com regex puro,
// idêntica em ambos os processos.
const IPV4_PATTERN = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
// IPv6 simplificado (sem colchetes) — cobre forma completa e abreviada com "::".
const IPV6_PATTERN = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;

/** Hostname RFC1123 simples (letras/números/hífen/ponto) — rejeita espaços, barras, `;`, etc. */
const HOSTNAME_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

function isIPv4(value: string): boolean {
  return IPV4_PATTERN.test(value);
}

function isIPv6(value: string): boolean {
  return IPV6_PATTERN.test(value);
}

/** Aceita IPv4, IPv6 (sem colchetes) ou hostname DNS válido — rejeita qualquer outro caractere (injection). */
export const hostnameSchema = z
  .string()
  .trim()
  .min(1, "Host obrigatório")
  .max(253, "Host muito longo")
  .refine((value) => isIPv4(value) || isIPv6(value) || HOSTNAME_PATTERN.test(value), {
    message: "Host inválido — use um IP ou hostname válido (sem espaços ou caracteres especiais).",
  });

export const portSchema = z.number().int().min(1, "Porta inválida").max(65535, "Porta inválida");

export const backupScheduleSchema = z.enum(["DISABLED", "DAILY", "WEEKLY"]);

export const installModeSchema = z.enum(["HOST", "CLIENT"]);

/** `postgres://` ou `postgresql://` apenas — nunca aceita outro esquema (ex. `file:`, `javascript:`). */
export const databaseUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine(
    (value) => {
      try {
        const url = new URL(value);
        return url.protocol === "postgres:" || url.protocol === "postgresql:";
      } catch {
        return false;
      }
    },
    { message: "Connection string do PostgreSQL inválida (esperado postgres://...)." },
  );

export const networkConfigSchema = z
  .object({
    bindAddress: hostnameSchema,
    port: portSchema,
    backupFolderPath: z.string().trim().min(1).max(4096).nullable(),
    backupSchedule: backupScheduleSchema,
    databaseUrl: databaseUrlSchema,
  })
  .strict();

export const clientHostConfigSchema = z
  .object({
    host: hostnameSchema,
    port: portSchema,
    useHttps: z.boolean(),
  })
  .strict();

export const installModePatchSchema = z.object({ installMode: installModeSchema }).strict();
export const onboardingCompletePatchSchema = z.object({ onboardingComplete: z.literal(true) }).strict();

export const authLoginPayloadSchema = z
  .object({
    tenantSlug: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9-]+$/i, "Identificador da loja inválido"),
    email: z.string().trim().min(3).max(254).email("E-mail inválido"),
    password: z.string().min(1).max(512),
  })
  .strict();

/** Apenas http/https — nunca `file:`, `javascript:`, `data:`, etc. */
export const httpUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine(
    (value) => {
      try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "URL inválida — apenas http/https são aceitos." },
  );

export type ValidationResult<T> = { success: true; data: T } | { success: false; error: string };

/** Helper usado em todos os handlers IPC do main: nunca deixa payload inválido passar silenciosamente. */
export function validate<T>(schema: z.ZodType<T>, payload: unknown): ValidationResult<T> {
  const result = schema.safeParse(payload);
  if (result.success) return { success: true, data: result.data };
  const message = result.error.issues.map((issue) => `${issue.path.join(".") || "payload"}: ${issue.message}`).join("; ");
  return { success: false, error: message };
}

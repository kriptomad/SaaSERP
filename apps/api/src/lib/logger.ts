// apps/api/src/lib/logger.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 8/20.9 — logger central estruturado (Pino)
// com mascaramento automático de campos sensíveis LGPD antes de qualquer log sair do
// processo. Substitui `console.log`/`console.error`/`console.warn` crus (encontrados em
// 7+ arquivos na mega-auditoria), que:
// 1) não têm nível/estrutura (impossível filtrar por severidade em produção);
// 2) nunca mascaram CPF/CNPJ, e-mail, telefone, token de pagamento etc. que aparecem
//    em payloads de erro/webhook repassados diretamente para o log.
//
// `redact` do Pino substitui os valores dos caminhos informados por "[REDACTED]" antes
// da serialização — nunca depois (ou seja, o dado sensível nunca chega a tocar disco/
// stdout em texto puro). Os caminhos cobrem os formatos de payload mais comuns deste
// código (webhooks Stripe/Asaas, cadastro de cliente/usuário, tokenização de cartão).
import pino from "pino";

const SENSITIVE_PATHS = [
  // Documentos e identificação (LGPD Art. 5º, dado pessoal)
  "*.cpf",
  "*.cnpj",
  "*.cpfCnpj",
  "*.email",
  "*.phone",
  "*.telefone",
  // Credenciais/segredos nunca devem vazar em log, mesmo mascarados parcialmente
  "*.password",
  "*.senha",
  "*.token",
  "*.accessToken",
  "*.access_token",
  "*.apiKey",
  "*.api_key",
  "*.secret",
  "*.authorization",
  // Dados de cartão/pagamento (também exigido por PCI-DSS, não só LGPD)
  "*.creditCard",
  "*.creditCardNumber",
  "*.creditCardToken",
  "*.ccv",
  "*.number",
  "*.holderName",
  "*.paymentMethodToken",
];

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
  redact: { paths: SENSITIVE_PATHS, censor: "[REDACTED]" },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
});

// Logger por módulo (child logger) — mantém o mesmo redact/nível, apenas rotula a
// origem (`module: "billing"`, `module: "pluggy-webhook"` etc.) para facilitar busca
// nos agregadores de log (ex.: filtrar só erros do worker de fidelidade).
export function createModuleLogger(moduleName: string) {
  return logger.child({ module: moduleName });
}

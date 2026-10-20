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
//
// CONVENÇÃO DO PROJETO (fa-w4-logger-redaction-incomplete / fa-w4-pluggy-webhook-raw-body-logged):
// o `redact` acima é uma rede de segurança para campos conhecidos, NÃO uma licença
// para logar objetos inteiros e confiar cegamente nele. `fast-redact` (motor por trás
// do `redact` do Pino) só cobre os caminhos explicitamente listados, e um payload de
// webhook de provedor (Pluggy/Asaas/Stripe/iFone etc.) ou um corpo de requisição
// (`req.body`) pode conter chaves arbitrárias — incluindo PII — que nunca vão bater
// com nenhum caminho desta lista. Por isso: NUNCA passe `req.body`, um payload de
// webhook bruto, ou um model Prisma inteiro (`{ client }`, `{ prescriptionRecord }`)
// direto para `log.info`/`log.warn`/`log.error` — extraia e logue só os campos
// especificamente necessários para debug (ex.: `{ eventType: body.event, itemId:
// body.itemId }`, nunca `{ body }`). Ver `modules/financial/pluggy-webhook.routes.ts`
// para o padrão correto.
import pino from "pino";

const SENSITIVE_PATHS = [
  // Documentos e identificação (LGPD Art. 5º, dado pessoal) — cobre tanto o campo
  // num objeto de nível raiz quanto aninhado um nível abaixo (ex.: `{ client: {
  // document } }`), que é o formato mais comum de payload logado neste código.
  "cpf",
  "*.cpf",
  "cnpj",
  "*.cnpj",
  "cpfCnpj",
  "*.cpfCnpj",
  "email",
  "*.email",
  "phone",
  "*.phone",
  "telefone",
  "*.telefone",
  // fa-w4-logger-redaction-incomplete — `document`/`patientDocument` (CPF do
  // paciente em `PrescriptionRecord`, Capítulo 4.5/LGPD Art. 11 — dado pessoal
  // SENSÍVEL) e `address`/`name` (dado pessoal comum, mas ainda assim PII direta)
  // não estavam cobertos — qualquer handler que logasse `{ client }`,
  // `{ prescriptionRecord }` ou similar inteiro vazava CPF/nome/endereço em texto
  // puro no agregador de log.
  "document",
  "*.document",
  "patientDocument",
  "*.patientDocument",
  "address",
  "*.address",
  "name",
  "*.name",
  "fullName",
  "*.fullName",
  // Credenciais/segredos nunca devem vazar em log, mesmo mascarados parcialmente
  "password",
  "*.password",
  "senha",
  "*.senha",
  "token",
  "*.token",
  "accessToken",
  "*.accessToken",
  "access_token",
  "*.access_token",
  "apiKey",
  "*.apiKey",
  "api_key",
  "*.api_key",
  "secret",
  "*.secret",
  "authorization",
  "*.authorization",
  // Dados de cartão/pagamento (também exigido por PCI-DSS, não só LGPD)
  "creditCard",
  "*.creditCard",
  "creditCardNumber",
  "*.creditCardNumber",
  "creditCardToken",
  "*.creditCardToken",
  "ccv",
  "*.ccv",
  "number",
  "*.number",
  "holderName",
  "*.holderName",
  "paymentMethodToken",
  "*.paymentMethodToken",
  // fa-w4-logger-redaction-incomplete — dados bancários (`BankAccount`, Capítulo
  // 17.4 — conta bancária cadastrada manualmente para conciliação/Open Finance
  // business) e PIX, usados em conciliação financeira e integrações Pluggy/Asaas.
  "agencyNumber",
  "*.agencyNumber",
  "accountNumber",
  "*.accountNumber",
  "pixKey",
  "*.pixKey",
  "iban",
  "*.iban",
  "bankAccount",
  "*.bankAccount",
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

// fa-w4-obs-no-request-id — logger por requisição HTTP (child logger), mesmo padrão
// de `createModuleLogger` acima (child do logger raiz, mesmo redact/nível), apenas
// amarrando o `requestId` (header `x-request-id` recebido ou gerado via
// `crypto.randomUUID()`, ver `middlewares/request-id.middleware.ts`) a todo log
// emitido durante o ciclo de vida daquela requisição — permite correlacionar, num
// agregador de log, TODAS as linhas de uma única requisição (inclusive as do job
// BullMQ que ela eventualmente enfileira, quando o produtor propaga `requestId` no
// payload do job).
export function createRequestLogger(requestId: string) {
  return logger.child({ module: "http", requestId });
}

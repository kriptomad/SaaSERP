// apps/api/src/modules/data-portability/product-import-mapping.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 18.5 — mapeamento de colunas sugerido por
// similaridade de nome ("Preço Venda" → `unitPrice`) e validação de linha com as
// MESMAS regras de negócio do cadastro manual de `Product` (EAN-13 com dígito
// verificador real; preço positivo). Compartilhado pela rota de sugestão de
// mapeamento e pelo worker de validação, para nunca divergir em dois lugares.
//
// Round 2 (fechamento do gap documentado acima): o mesmo arquivo também modela
// CLIENT/SUPPLIER, reaproveitando a mesma infraestrutura de sugestão de mapeamento/
// validação/preview — nome do arquivo mantido (`product-import-mapping.ts`) para não
// gerar churn de import em 3 outros arquivos que já o referenciam.
import { isValidEan13CheckDigit } from "../../lib/scale-barcode";

export type ImportTargetEntity = "PRODUCT" | "CLIENT" | "SUPPLIER";

// Campos reais de `Product` expostos ao wizard de importação (Capítulo 18.5, texto
// integral). `barcodeEan13`/`categoryName` são nomes "lógicos" do wizard — mapeiam
// internamente para as colunas reais `Product.barcode`/`Product.category`
// (`Product` não tem uma tabela de categorias separada; `category` é texto livre).
export const PRODUCT_IMPORT_TARGET_FIELDS = ["name", "barcodeEan13", "costPrice", "unitPrice", "stockQuantity", "categoryName"] as const;
export type ProductImportTargetField = (typeof PRODUCT_IMPORT_TARGET_FIELDS)[number];

// Campos reais de `Client`/`Supplier` expostos ao wizard — mesmo subconjunto comum
// aos dois modelos (name/document/phone/email), já que ambos compartilham essas
// quatro colunas em `schema.prisma` (Client tem bem mais campos de nicho, mas estes
// quatro são os únicos universais o suficiente para uma planilha genérica de
// cadastro em massa).
export const CLIENT_IMPORT_TARGET_FIELDS = ["name", "document", "phone", "email"] as const;
export type ClientImportTargetField = (typeof CLIENT_IMPORT_TARGET_FIELDS)[number];

export const SUPPLIER_IMPORT_TARGET_FIELDS = ["name", "document", "phone", "email"] as const;
export type SupplierImportTargetField = (typeof SUPPLIER_IMPORT_TARGET_FIELDS)[number];

export function importTargetFieldsForEntity(entity: ImportTargetEntity): readonly string[] {
  if (entity === "PRODUCT") return PRODUCT_IMPORT_TARGET_FIELDS;
  if (entity === "CLIENT") return CLIENT_IMPORT_TARGET_FIELDS;
  return SUPPLIER_IMPORT_TARGET_FIELDS;
}

/** Remove acentos/pontuação e normaliza para minúsculas — heurística simples, não um algoritmo de similaridade real (ex.: Levenshtein). Suficiente para o conjunto pequeno e previsível de nomes de coluna de planilhas de ERPs concorrentes. */
function normalizeHeaderName(header: string): string {
  return header
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

// Dicionário de sinônimos — cobre os nomes de coluna mais comuns observados em
// planilhas de catálogo de ERPs concorrentes/exportações manuais; não é exaustivo
// (limite documentado: qualquer header fora deste dicionário e sem match exato ao
// nome do campo não recebe sugestão automática, mas continua 100% editável no passo 2).
const PRODUCT_SYNONYM_DICTIONARY: Record<string, ProductImportTargetField> = {
  nome: "name",
  produto: "name",
  descricao: "name",
  "descricao do produto": "name",
  preco: "unitPrice",
  "preco venda": "unitPrice",
  "preco de venda": "unitPrice",
  valor: "unitPrice",
  "valor venda": "unitPrice",
  "valor unitario": "unitPrice",
  custo: "costPrice",
  "preco custo": "costPrice",
  "preco de custo": "costPrice",
  "custo unitario": "costPrice",
  ean: "barcodeEan13",
  ean13: "barcodeEan13",
  "codigo de barras": "barcodeEan13",
  "cod barras": "barcodeEan13",
  barcode: "barcodeEan13",
  estoque: "stockQuantity",
  quantidade: "stockQuantity",
  "quantidade em estoque": "stockQuantity",
  "qtd estoque": "stockQuantity",
  categoria: "categoryName",
  "categoria do produto": "categoryName",
  grupo: "categoryName",
};

// Dicionário comum a CLIENT/SUPPLIER — mesmas 4 colunas universais.
const PARTY_SYNONYM_DICTIONARY: Record<string, "name" | "document" | "phone" | "email"> = {
  nome: "name",
  cliente: "name",
  fornecedor: "name",
  "razao social": "name",
  "nome fantasia": "name",
  documento: "document",
  cpf: "document",
  cnpj: "document",
  "cpf cnpj": "document",
  "cpf/cnpj": "document",
  telefone: "phone",
  celular: "phone",
  whatsapp: "phone",
  fone: "phone",
  email: "email",
  "e mail": "email",
  "endereco de email": "email",
};

function synonymDictionaryForEntity(entity: ImportTargetEntity): Record<string, string> {
  return entity === "PRODUCT" ? PRODUCT_SYNONYM_DICTIONARY : PARTY_SYNONYM_DICTIONARY;
}

/**
 * Sugere, para cada header do arquivo, o campo-alvo mais provável da entidade —
 * primeiro por match exato ao nome do próprio campo-alvo normalizado, depois pelo
 * dicionário de sinônimos acima. Headers sem nenhum match ficam de fora do mapeamento
 * sugerido (o lojista preenche manualmente no passo 2, sempre editável).
 */
export function suggestColumnMapping(headers: string[], entity: ImportTargetEntity = "PRODUCT"): Record<string, string> {
  const suggestion: Record<string, string> = {};
  const targetFields = importTargetFieldsForEntity(entity);
  const synonymDictionary = synonymDictionaryForEntity(entity);
  const normalizedTargets = new Map<string, string>(targetFields.map((f) => [normalizeHeaderName(f), f]));

  for (const header of headers) {
    const normalized = normalizeHeaderName(header);
    if (normalizedTargets.has(normalized)) {
      suggestion[header] = normalizedTargets.get(normalized)!;
      continue;
    }
    if (synonymDictionary[normalized]) {
      suggestion[header] = synonymDictionary[normalized];
      continue;
    }
    // Match por substring (ex.: "Preço Venda (R$)" contém "preco venda") — último
    // recurso, só aplicado se não houve match exato acima.
    const partial = Object.keys(synonymDictionary).find((key) => normalized.includes(key));
    if (partial) {
      suggestion[header] = synonymDictionary[partial];
    }
  }
  return suggestion;
}

export interface MappedProductRow {
  name?: string;
  barcodeEan13?: string;
  costPrice?: string;
  unitPrice?: string;
  stockQuantity?: string;
  categoryName?: string;
}

/**
 * Aplica `columnMapping` (header original -> campo-alvo) a uma linha bruta do
 * arquivo (array alinhado ao array de headers) e devolve um objeto por campo-alvo.
 * Genérico o suficiente para PRODUCT/CLIENT/SUPPLIER — o chamador faz o cast para o
 * tipo `MappedXRow` apropriado conforme a entidade do job.
 */
export function applyColumnMapping<T extends object = MappedProductRow>(
  headers: string[],
  row: string[],
  columnMapping: Record<string, string>,
): T {
  const mapped: Record<string, string> = {};
  headers.forEach((header, index) => {
    const targetField = columnMapping[header];
    if (!targetField) return;
    const rawValue = row[index]?.trim();
    if (rawValue) {
      mapped[targetField] = rawValue;
    }
  });
  return mapped as T;
}

/**
 * Valida uma linha mapeada contra as MESMAS regras de negócio do cadastro manual de
 * produto (products.routes.ts: `unitPrice` positivo; EAN-13 real com dígito
 * verificador). Devolve a lista de mensagens de erro (vazia = linha válida).
 */
export function validateMappedProductRow(row: MappedProductRow): string[] {
  const errors: string[] = [];

  if (!row.name || row.name.length < 2) {
    errors.push("Nome do produto é obrigatório (mínimo 2 caracteres).");
  }

  if (!row.unitPrice) {
    errors.push("Preço de venda (unitPrice) é obrigatório.");
  } else {
    const unitPrice = Number(row.unitPrice.replace(",", "."));
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      errors.push(`Preço de venda inválido: "${row.unitPrice}" (deve ser um número positivo).`);
    }
  }

  if (row.costPrice) {
    const costPrice = Number(row.costPrice.replace(",", "."));
    if (!Number.isFinite(costPrice) || costPrice < 0) {
      errors.push(`Preço de custo inválido: "${row.costPrice}" (deve ser um número não negativo).`);
    }
  }

  if (row.stockQuantity) {
    const stockQuantity = Number(row.stockQuantity.replace(",", "."));
    if (!Number.isFinite(stockQuantity) || stockQuantity < 0) {
      errors.push(`Quantidade em estoque inválida: "${row.stockQuantity}" (deve ser um número não negativo).`);
    }
  }

  if (row.barcodeEan13) {
    const digitsOnly = row.barcodeEan13.replace(/\D/g, "");
    if (digitsOnly.length !== 13 || !isValidEan13CheckDigit(digitsOnly)) {
      errors.push(`Código de barras EAN-13 inválido: "${row.barcodeEan13}" (dígito verificador não confere).`);
    }
  }

  // Categoria (Product.category) é texto livre, não uma FK — "existente ou a ser
  // criada" (Capítulo 18.5) já é satisfeito automaticamente: qualquer valor não
  // vazio é aceito e vira a categoria do produto na gravação, criando-a implicitamente
  // se ainda não existir nenhum outro produto com o mesmo texto.

  return errors;
}

// ─────────────────────────────────────────────────────────────────────────
// CLIENT / SUPPLIER — fecha o gap documentado originalmente: mesmo wizard de 4
// passos, agora também cobrindo as duas entidades que o schema (`DataImportJob.
// targetEntity`) já suportava como String livre desde a primeira rodada.
// ─────────────────────────────────────────────────────────────────────────

export interface MappedPartyRow {
  name?: string;
  document?: string;
  phone?: string;
  email?: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Valida uma linha mapeada de CLIENT/SUPPLIER — mesmas regras de negócio do
 * cadastro manual (clients.routes.ts/suppliers.routes.ts): nome obrigatório,
 * e-mail com formato válido se informado. `document` (CPF/CNPJ) não tem dígito
 * verificador exigido no cadastro manual (campo de texto livre lá também), então a
 * única regra aqui é de unicidade — verificada à parte pelo worker (precisa
 * consultar o banco e as outras linhas do próprio arquivo, não é uma regra
 * puramente sintática de uma linha isolada).
 */
export function validateMappedPartyRow(row: MappedPartyRow): string[] {
  const errors: string[] = [];

  if (!row.name || row.name.trim().length < 2) {
    errors.push("Nome é obrigatório (mínimo 2 caracteres).");
  }

  if (row.email && !EMAIL_REGEX.test(row.email)) {
    errors.push(`E-mail inválido: "${row.email}".`);
  }

  return errors;
}

/** Normaliza um documento (CPF/CNPJ) para comparação de duplicidade: só dígitos. */
export function normalizeDocument(document: string): string {
  return document.replace(/\D/g, "");
}

export function buildClientCreateData(tenantId: string, row: MappedPartyRow) {
  return {
    tenantId,
    name: row.name!,
    document: row.document ? normalizeDocument(row.document) : null,
    phone: row.phone ?? null,
    email: row.email ?? null,
  };
}

export function buildSupplierCreateData(tenantId: string, row: MappedPartyRow) {
  return {
    tenantId,
    name: row.name!,
    document: row.document ? normalizeDocument(row.document) : null,
    phone: row.phone ?? null,
    email: row.email ?? null,
  };
}

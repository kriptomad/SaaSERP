// apps/api/src/modules/purchasing/nfe-xml-import.service.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 17.8 (Módulo de Compras) e reclamações de
// mercado pesquisadas (Capítulo 1) — ERPs concorrentes (Bling, ContaAzul) oferecem
// "importar XML de compra" como recurso central do recebimento de mercadoria; sem
// ele, o lojista reitera manualmente cada item de uma nota de compra de papel/XML
// na tela de Pedido de Compra. GAP DE AUDITORIA FECHADO: só existia a emissão de
// NFC-e de SAÍDA (emit-fiscal-document.service.ts); nenhum caminho de ENTRADA.
//
// Parsing do XML padrão da NF-e modelo 55 (layout oficial SEFAZ, mesma estrutura em
// qualquer emissor: Focus NFe, Bling, SAP etc. — <NFe><infNFe><det>...). Usa
// `fast-xml-parser` (dependência leve, sem binários nativos) só para ler os campos
// relevantes ao recebimento — nunca reimplementa validação fiscal da nota em si
// (essa responsabilidade é do emissor/SEFAZ; aqui só extraímos dados para
// pré-preencher um PurchaseOrder, que o lojista sempre confere antes de confirmar).
//
// Estratégia de casamento de item ↔ Product (nunca automática sem revisão):
//   1. `cEAN`/`cEANTrib` (GTIN) contra `Product.barcode` — casamento mais confiável.
//   2. `cProd` (código do produto no fornecedor) contra `Product.sku` — fallback.
//   3. Sem casamento: item retorna `productId: null` e `suggestedName`/`suggestedSku`
//      para o lojista criar o produto manualmente antes de confirmar a importação
//      (nunca criamos Product automaticamente — cadastro de produto exige decisões
//      de precificação/NCM/categoria que não vêm completas na XML de compra).
import { XMLParser } from "fast-xml-parser";
import { TenantScopedPrismaClient } from "@filitech/db";

export interface ParsedNfeSupplier {
  cnpj: string;
  name: string;
}

export interface ParsedNfeItem {
  cProd: string;
  ean: string | null;
  description: string;
  ncm: string | null;
  quantity: number;
  unitCost: number;
  totalValue: number;
  // Preenchido pelo casamento contra o catálogo do tenant (nunca pela própria XML).
  matchedProductId: string | null;
  matchedBy: "BARCODE" | "SKU" | null;
}

export interface ParsedNfe {
  accessKey: string | null;
  number: string | null;
  series: string | null;
  issueDate: string | null;
  supplier: ParsedNfeSupplier;
  totalValue: number;
  items: ParsedNfeItem[];
}

export class InvalidNfeXmlError extends Error {}

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", removeNSPrefix: true });

function onlyDigits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// Parse puro (sem acesso a banco) — separado para poder ser testado isoladamente e
// reaproveitado tanto no preview quanto na confirmação, sempre reinterpretando o XML
// original enviado pelo cliente (nunca confiamos em um preview cacheado/alterável
// pelo front, que poderia divergir do XML real assinado pela SEFAZ).
export function parseNfeXml(xmlContent: string): ParsedNfe {
  let parsed: any;
  try {
    parsed = xmlParser.parse(xmlContent);
  } catch (error) {
    throw new InvalidNfeXmlError(`XML malformado: ${(error as Error).message}`);
  }

  const nfeProc = parsed?.nfeProc ?? parsed;
  const infNFe = nfeProc?.NFe?.infNFe ?? nfeProc?.infNFe;
  if (!infNFe) {
    throw new InvalidNfeXmlError("XML não contém a estrutura esperada <NFe><infNFe> — verifique se é o XML da NF-e (modelo 55), não o DANFE em PDF.");
  }

  const accessKeyAttr: string | undefined = infNFe["@_Id"];
  const accessKey = accessKeyAttr ? accessKeyAttr.replace(/^NFe/, "") : null;

  const ide = infNFe.ide ?? {};
  const emit = infNFe.emit ?? {};

  const supplier: ParsedNfeSupplier = {
    cnpj: onlyDigits(emit.CNPJ ?? emit.CPF),
    name: String(emit.xNome ?? "Fornecedor não identificado"),
  };

  const detRaw = infNFe.det;
  const detList: any[] = Array.isArray(detRaw) ? detRaw : detRaw ? [detRaw] : [];
  if (detList.length === 0) {
    throw new InvalidNfeXmlError("A NF-e não contém nenhum item (<det>) para importar.");
  }

  const items: ParsedNfeItem[] = detList.map((det) => {
    const prod = det.prod ?? {};
    const ean = typeof prod.cEAN === "string" && prod.cEAN !== "SEM GTIN" ? prod.cEAN : null;
    return {
      cProd: String(prod.cProd ?? ""),
      ean,
      description: String(prod.xProd ?? ""),
      ncm: prod.NCM ? String(prod.NCM) : null,
      quantity: toNumber(prod.qCom),
      unitCost: toNumber(prod.vUnCom),
      totalValue: toNumber(prod.vProd),
      matchedProductId: null,
      matchedBy: null,
    };
  });

  const total = infNFe.total?.ICMSTot ?? {};

  return {
    accessKey,
    number: ide.nNF ? String(ide.nNF) : null,
    series: ide.serie ? String(ide.serie) : null,
    issueDate: ide.dhEmi ? String(ide.dhEmi) : null,
    supplier,
    totalValue: toNumber(total.vNF),
    items,
  };
}

// Casa cada item contra o catálogo do tenant (barcode > sku). Modifica `parsed.items`
// in-place e retorna o mesmo objeto, por conveniência do chamador.
export async function matchNfeItemsToCatalog(prisma: TenantScopedPrismaClient, parsed: ParsedNfe): Promise<ParsedNfe> {
  const barcodes = [...new Set(parsed.items.map((i) => i.ean).filter((v): v is string => Boolean(v)))];
  const skus = [...new Set(parsed.items.map((i) => i.cProd).filter(Boolean))];

  const [byBarcode, bySku] = await Promise.all([
    barcodes.length > 0
      ? prisma.product.findMany({ where: { barcode: { in: barcodes } }, select: { id: true, barcode: true } })
      : Promise.resolve([]),
    skus.length > 0 ? prisma.product.findMany({ where: { sku: { in: skus } }, select: { id: true, sku: true } }) : Promise.resolve([]),
  ]);

  const barcodeMap = new Map(byBarcode.map((p) => [p.barcode as string, p.id]));
  const skuMap = new Map(bySku.map((p) => [p.sku, p.id]));

  for (const item of parsed.items) {
    if (item.ean && barcodeMap.has(item.ean)) {
      item.matchedProductId = barcodeMap.get(item.ean)!;
      item.matchedBy = "BARCODE";
      continue;
    }
    if (item.cProd && skuMap.has(item.cProd)) {
      item.matchedProductId = skuMap.get(item.cProd)!;
      item.matchedBy = "SKU";
    }
  }

  return parsed;
}

// Tenta encontrar o Supplier já cadastrado pelo CNPJ do emitente da nota — nunca cria
// um Supplier automaticamente (mesmo princípio do item: cadastro completo exige
// revisão humana), apenas sugere para o front pré-selecionar.
export async function findSupplierByDocument(prisma: TenantScopedPrismaClient, cnpj: string): Promise<{ id: string; name: string } | null> {
  if (!cnpj) return null;
  const supplier = await prisma.supplier.findFirst({ where: { document: cnpj }, select: { id: true, name: true } });
  return supplier;
}

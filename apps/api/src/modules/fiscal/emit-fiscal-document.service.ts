// apps/api/src/modules/fiscal/emit-fiscal-document.service.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 6.6/20.3/21.7 — emissão real da NFC-e via
// Focus NFe, fechando o gap de auditoria em que a fila BullMQ `fiscal-emission` tinha
// produtor (close-sale.service.ts) mas nenhum worker consumidor: todo FiscalDocument
// ficava travado em PENDING para sempre e nenhuma nota era de fato transmitida à
// SEFAZ. Mesmo padrão "fail-closed configurável" de transmit-fiscal-event.ts: sem
// credencial FISCAL_FOCUS_NFE ativa (tenant ou plataforma), a emissão falha
// explicitamente — nunca um sucesso simulado.
//
// Contrato real confirmado via documentação oficial Focus NFe
// (doc.focusnfe.com.br/reference/emitir_nfce e /reference/consultar_nfce):
//   - POST https://api.focusnfe.com.br/v2/nfce?ref={referencia}  — SÍNCRONO: a nota é
//     autorizada ou rejeitada na própria resposta do POST (sem necessidade de
//     polling em uso normal). Usamos o próprio FiscalDocument.id como {referencia}
//     (persistido em FiscalDocument.focusNfeReference) — nunca reaproveitamos esse
//     valor depois de uma primeira tentativa, para preservar a idempotência exigida
//     pela própria Focus NFe (erro "already_processed" em nova tentativa com a mesma
//     ref já autorizada).
//   - GET https://api.focusnfe.com.br/v2/nfce/{referencia} — consulta usada apenas no
//     caso de borda em que o POST retorna "already_processed" (nota já autorizada em
//     uma tentativa anterior cujo retorno se perdeu antes de persistirmos o
//     resultado) — nunca para poll de status assíncrono, que não existe neste
//     endpoint.
//   - Autenticação: HTTP Basic Auth, usuário = token Focus NFe, senha vazia (mesmo
//     padrão de transmit-fiscal-event.ts).
//   - Resposta de sucesso (201, status "autorizado"): chave_nfe, numero, serie,
//     caminho_xml_nota_fiscal, caminho_danfe, qrcode_url, status_sefaz, mensagem_sefaz.
//   - Resposta de rejeição (201, status "erro_autorizacao"): status_sefaz (código da
//     SEFAZ, ex. "704") + mensagem_sefaz — nunca tratado como sucesso.
import { Prisma, TenantScopedPrismaClient } from "@filitech/db";
import {
  decryptFocusNfeCredential,
  resolveFocusNfeCredential,
  FocusNfeNotConfiguredError,
} from "./focus-nfe-credential";
import { notifyTenant } from "../notifications/notify.service";
import { withCircuitBreaker } from "../../lib/circuit-breaker";
import { dispatchWebhookEvent } from "../../lib/webhook-dispatch";
import { createModuleLogger } from "../../lib/logger";
import { resolveCfop } from "./cfop-resolver.service";

const FOCUS_NFE_BREAKER = "focus-nfe";

export { FocusNfeNotConfiguredError };

// Falha de cadastro (nunca de rede/SEFAZ): produto sem NCM ou tenant sem UF de
// origem cadastrados. Emitir com NCM "00000000" (fictício) ou UF chutada para a
// SEFAZ é pior do que bloquear — gera autuação fiscal real por informação
// incorreta na nota. Bloqueia a emissão e orienta o lojista a corrigir o cadastro.
export class FiscalDataValidationError extends Error {}

export interface FiscalDocumentEmissionResult {
  authorized: boolean;
  accessKey: string | null;
  rejectionReason: string | null;
}

// Tabela SEFAZ tPag (Nota Técnica 2020.006) — nunca inventada: cada código abaixo é o
// identificador oficial de forma de pagamento usado no leiaute 4.00 da NFC-e.
const PAYMENT_METHOD_TO_SEFAZ_CODE: Record<string, string> = {
  CASH: "01",
  CREDIT_CARD: "03",
  DEBIT_CARD: "04",
  STORE_CREDIT: "05",
  PIX: "17",
  BOLETO: "15",
  MARKETPLACE: "99",
  HEALTH_INSURANCE: "99",
};

// Tabela SEFAZ indPres — "1" cobre balcão físico (COUNTER/DINE_IN), que é o uso
// dominante da NFC-e; os demais canais recebem o código correspondente ao modo real
// de entrega/venda (Capítulo 21.7).
function resolvePresencaComprador(channel: string): string {
  if (channel === "DELIVERY_IFOOD") return "4"; // entrega a domicílio
  if (channel === "ONLINE_STORE") return "2"; // não presencial, internet
  return "1"; // presencial (COUNTER/DINE_IN)
}

function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * Resolve CFOP/CST-CSOSN aplicável ao item, reaproveitando a mesma TaxRule central
 * (Capítulo 21.6) consultada por tax-engine.service.ts, com a mesma precedência
 * (regra mais específica por NCM/UF/nicho vence a mais genérica). Quando nenhuma
 * TaxRule específica declara `cfop`, cai para `resolveCfop` (Capítulo 21.13) em vez
 * de um valor fixo — nunca "5102 para tudo", que seria incompatível com vendas
 * interestaduais/sujeitas a ICMS-ST e geraria autuação por CFOP divergente da
 * natureza real da operação. CST-CSOSN segue com o default documentado do próprio
 * exemplo oficial Focus NFe — nunca lançado como erro bloqueante, pois ausência de
 * override fiscal fino não pode impedir a emissão de uma venda já fechada e paga.
 */
async function resolveItemFiscalCodes(
  prisma: TenantScopedPrismaClient,
  params: { tenantId: string; ncm: string; uf: string; destinationUf: string; nicheCode: string; isSimplesNacional: boolean },
): Promise<{ cfop: string; cstCsosn: string }> {
  const rule = await prisma.taxRule.findFirst({
    where: {
      OR: [{ tenantId: params.tenantId }, { tenantId: null }],
      AND: [
        { OR: [{ ncm: params.ncm }, { ncm: null }] },
        { OR: [{ uf: params.uf }, { uf: null }] },
        { OR: [{ nicheCode: params.nicheCode }, { nicheCode: null }] },
        { effectiveFrom: { lte: new Date() } },
        { OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }] },
      ],
    },
    orderBy: [{ ncm: "desc" }, { uf: "desc" }, { nicheCode: "desc" }],
    select: { cfop: true, cstCsosn: true, icmsStMva: true },
  });

  return {
    cfop:
      rule?.cfop ??
      resolveCfop({
        isInterstate: params.uf !== params.destinationUf,
        isSubjectToIcmsSt: Boolean(rule?.icmsStMva),
        isOwnProduction: false, // produção própria já é resolvida/gravada em calculateFullTax no fechamento da venda (close-sale.service.ts) — aqui só preenche o fallback residual quando a TaxRule não declara CFOP explícito
        isReturn: false,
      }),
    cstCsosn: rule?.cstCsosn ?? (params.isSimplesNacional ? "102" : "00"), // CSOSN 102 (Simples) / CST 00 (Normal) — tributação padrão sem benefício
  };
}

/**
 * Emite a NFC-e real junto à Focus NFe para o FiscalDocument informado, consumido
 * pelo worker BullMQ `fiscal-emission` (apps/api/src/workers/fiscal-emission.worker.ts).
 * Idempotente: se o documento já estiver AUTHORIZED/CANCELLED, retorna
 * imediatamente sem nova chamada HTTP (proteção contra reprocessamento de job).
 */
export async function emitFiscalDocument(
  prisma: TenantScopedPrismaClient,
  params: { tenantId: string; fiscalDocumentId: string },
): Promise<FiscalDocumentEmissionResult> {
  const fiscalDocument = await prisma.fiscalDocument.findUniqueOrThrow({
    where: { id: params.fiscalDocumentId },
    include: {
      sale: {
        include: {
          client: true,
          items: { include: { product: true, service: true } },
        },
      },
    },
  });

  if (fiscalDocument.status === "AUTHORIZED" || fiscalDocument.status === "CANCELLED") {
    return {
      authorized: fiscalDocument.status === "AUTHORIZED",
      accessKey: fiscalDocument.accessKey,
      rejectionReason: null,
    };
  }

  if (fiscalDocument.type !== "NFCE" && fiscalDocument.type !== "NFSE") {
    // NF-e modelo 55 (entrada/saída de mercadoria entre empresas, Capítulo 21.8/21.17)
    // segue um contrato de payload diferente (destinatário PJ obrigatório, duplicatas,
    // transporte) ainda não portado para este worker — documentado honestamente como
    // gap de escopo, nunca silenciosamente tratado como NFC-e.
    throw new Error(
      `Emissão automática via Focus NFe implementada apenas para NFC-e/NFS-e nesta fase — FiscalDocument ${fiscalDocument.id} é do tipo ${fiscalDocument.type}.`,
    );
  }

  if (!fiscalDocument.sale) {
    throw new Error(
      `FiscalDocument ${fiscalDocument.id} não está vinculado a nenhuma venda — impossível montar o payload de emissão.`,
    );
  }

  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: params.tenantId },
    select: { cnpj: true, uf: true, taxRegime: true, inscricaoMunicipal: true },
  });

  if (!tenant.cnpj) {
    throw new Error(
      "Tenant sem CNPJ cadastrado — impossível emitir NFC-e/NFS-e (tenants PERSONAL, Capítulo 22, nunca emitem documento fiscal; isto indica uma venda fechada incorretamente para um tenant sem perfil fiscal).",
    );
  }

  const credential = await resolveFocusNfeCredential(prisma, params.tenantId);
  if (!credential) {
    throw new FocusNfeNotConfiguredError(
      "A integração com a Focus NFe ainda não foi configurada/ativada para este tenant nem existe credencial de plataforma. Configure-a em Configurações > Integrações antes de fechar vendas fiscais.",
    );
  }
  const decrypted = decryptFocusNfeCredential(credential);
  const basicAuth = Buffer.from(`${decrypted.token}:`).toString("base64");

  if (fiscalDocument.type === "NFSE") {
    return emitNfseDocument(prisma, { tenantId: params.tenantId, fiscalDocument, tenant, basicAuth });
  }

  const sale = fiscalDocument.sale;
  const isSimplesNacional = tenant.taxRegime === "SIMPLES_NACIONAL";

  // Apenas itens de produto compõem a NFC-e (mercadoria) — itens de serviço (mão de
  // obra de comanda/O.S., Capítulo 21.8) são tributados por ISS/NFS-e municipal,
  // emitidos em um FiscalDocument NFSE próprio (ver `emitNfseDocument` abaixo).
  const productItems = sale.items.filter((item) => item.productId && item.product);
  if (productItems.length === 0) {
    throw new Error(
      `Venda ${sale.id} não possui nenhum item de produto (apenas serviços) — NFC-e não se aplica; o fechamento desta venda não deveria ter criado um FiscalDocument do tipo NFCE.`,
    );
  }

  const items = await Promise.all(
    productItems.map(async (item, index) => {
      const product = item.product!;
      if (!product.ncm) {
        throw new FiscalDataValidationError(
          `Produto "${product.name}" (SKU ${product.sku}) não possui NCM cadastrado. Preencha o NCM em Cadastros > Produtos antes de emitir documentos fiscais — a emissão com NCM fictício resulta em autuação pela SEFAZ.`,
        );
      }
      const uf = product.originUf ?? tenant.uf;
      if (!uf) {
        throw new FiscalDataValidationError(
          `Não foi possível determinar a UF de origem para o produto "${product.name}" (SKU ${product.sku}): nem o produto nem o tenant possuem UF cadastrada. Configure a UF do estabelecimento em Configurações > Empresa.`,
        );
      }
      const ncm = product.ncm;
      const destinationUf = sale.client?.uf ?? uf;
      const nicheCode = product.nicheCode ?? "MARKET";
      const { cfop, cstCsosn } = await resolveItemFiscalCodes(prisma, {
        tenantId: params.tenantId,
        ncm,
        uf,
        destinationUf,
        nicheCode,
        isSimplesNacional,
      });

      return {
        numero_item: String(index + 1),
        codigo_ncm: ncm,
        codigo_produto: product.sku,
        descricao: product.name,
        quantidade_comercial: Number(item.quantity),
        quantidade_tributavel: Number(item.quantity),
        cfop,
        valor_unitario_comercial: Number(item.unitPrice),
        valor_unitario_tributavel: Number(item.unitPrice),
        valor_bruto: Number(item.totalPrice),
        unidade_comercial: "UN",
        unidade_tributavel: "UN",
        icms_origem: product.icmsOrigin, // tabela SEFAZ "Origem da Mercadoria" (Convênio ICMS 38/2013), configurável por produto em Cadastros > Produtos
        icms_situacao_tributaria: cstCsosn,
      };
    }),
  );

  const totalPayment = productItems.reduce((acc, item) => acc.plus(item.totalPrice), new Prisma.Decimal(0));
  const sefazPaymentCode = PAYMENT_METHOD_TO_SEFAZ_CODE[sale.paymentMethod] ?? "99";
  // CORREÇÃO DE AUDITORIA (mega-audit rodada 5): `local_destino` (tabela SEFAZ
  // "Local de destino da operação") estava fixo em "1" (operação interna) para
  // TODA venda — inconsistente com o CFOP já resolvido por item acima (que
  // corretamente distingue CFOP interno/interestadual via `isInterstate`). Uma
  // NFC-e de entrega/vitrine (Capítulo 8.5/11.6) para cliente de outra UF é uma
  // operação interestadual real (gera DIFAL, Capítulo 21.9) — declarar
  // "1" nesse caso diverge do CFOP e pode gerar rejeição/autuação por
  // inconsistência fiscal. "2" = operação interestadual; "3" = operação com o
  // exterior nunca se aplica à NFC-e (consumidor final nacional).
  const localDestino = tenant.uf && sale.client?.uf && sale.client.uf !== tenant.uf ? "2" : "1";

  const payload: Record<string, unknown> = {
    cnpj_emitente: onlyDigits(tenant.cnpj),
    data_emissao: new Date().toISOString(),
    presenca_comprador: resolvePresencaComprador(sale.channel),
    modalidade_frete: "9", // sem transporte — NFC-e é sempre venda direta ao consumidor final no balcão/entrega local
    local_destino: localDestino,
    natureza_operacao: "VENDA AO CONSUMIDOR",
    items,
    formas_pagamento: [{ forma_pagamento: sefazPaymentCode, valor_pagamento: Number(totalPayment) }],
  };

  if (sale.client?.document) {
    const digits = onlyDigits(sale.client.document);
    if (digits.length === 11) payload.cpf_destinatario = digits;
    else if (digits.length === 14) payload.cnpj_destinatario = digits;
    if (sale.client.name) payload.nome_destinatario = sale.client.name;
  }

  // Referência externa própria do FiscalDocument — nunca reaproveitada entre
  // tentativas (idempotência exigida pela Focus NFe: reenviar a mesma ref de uma nota
  // já autorizada retorna "already_processed", nunca uma segunda autorização).
  const referencia = fiscalDocument.focusNfeReference ?? fiscalDocument.id;
  if (!fiscalDocument.focusNfeReference) {
    await prisma.fiscalDocument.update({
      where: { id: fiscalDocument.id },
      data: { focusNfeReference: referencia },
    });
  }

  const response = await withCircuitBreaker(FOCUS_NFE_BREAKER, () =>
    fetch(`https://api.focusnfe.com.br/v2/nfce?ref=${encodeURIComponent(referencia)}`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }),
  );

  let body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  // Caso de borda documentado pela própria Focus NFe: se uma tentativa anterior já
  // autorizou esta referência mas o retorno do POST se perdeu antes de persistirmos
  // (timeout de rede, processo reiniciado), consultamos o resultado já definitivo em
  // vez de tratar isto como falha — nunca reenviamos o payload sob a mesma ref.
  if (body.codigo === "already_processed") {
    const queryResponse = await withCircuitBreaker(FOCUS_NFE_BREAKER, () =>
      fetch(`https://api.focusnfe.com.br/v2/nfce/${encodeURIComponent(referencia)}`, {
        method: "GET",
        headers: { Authorization: `Basic ${basicAuth}`, Accept: "application/json" },
      }),
    );
    body = (await queryResponse.json().catch(() => ({}))) as Record<string, unknown>;
  }

  const status = typeof body.status === "string" ? body.status : null;

  if (status === "autorizado") {
    const accessKey = typeof body.chave_nfe === "string" ? body.chave_nfe : null;
    await prisma.fiscalDocument.update({
      where: { id: fiscalDocument.id },
      data: {
        status: "AUTHORIZED",
        accessKey,
        authorizedAt: new Date(),
        xmlStorageKey: typeof body.caminho_xml_nota_fiscal === "string" ? body.caminho_xml_nota_fiscal : null,
        danfeStorageKey: typeof body.caminho_danfe === "string" ? body.caminho_danfe : null,
        qrCodeUrl: typeof body.qrcode_url === "string" ? body.qrcode_url : null,
        focusNfeNumero: typeof body.numero === "string" ? body.numero : null,
        focusNfeSerie: typeof body.serie === "string" ? body.serie : null,
        focusNfeStatusSefaz: typeof body.status_sefaz === "string" ? body.status_sefaz : null,
        focusNfeMensagemSefaz: typeof body.mensagem_sefaz === "string" ? body.mensagem_sefaz : null,
      },
    });
    // Capítulo 15.4 — webhook de saída "fiscal_document.authorized": não bloqueia a
    // autorização do documento fiscal caso o enfileiramento do dispatch falhe (mesmo
    // princípio de close-sale.service.ts/sale.completed).
    await dispatchWebhookEvent(params.tenantId, "fiscal_document.authorized", {
      fiscalDocumentId: fiscalDocument.id,
      saleId: fiscalDocument.saleId,
      accessKey,
      focusNfeNumero: typeof body.numero === "string" ? body.numero : null,
      focusNfeSerie: typeof body.serie === "string" ? body.serie : null,
    }).catch((error) => {
      createModuleLogger("emit-fiscal-document").error({ fiscalDocumentId: fiscalDocument.id, err: error }, "falha ao enfileirar webhook fiscal_document.authorized");
    });
    return { authorized: true, accessKey, rejectionReason: null };
  }

  // "erro_autorizacao" (rejeição SEFAZ) ou qualquer resposta HTTP de erro
  // (400/401/403/415/422) — nunca tratado como sucesso.
  const rejectionReason =
    typeof body.mensagem_sefaz === "string"
      ? body.mensagem_sefaz
      : typeof body.mensagem === "string"
        ? body.mensagem
        : Array.isArray(body.erros)
          ? JSON.stringify(body.erros)
          : `Falha HTTP ${response.status} sem corpo de erro interpretável.`;

  await prisma.fiscalDocument.update({
    where: { id: fiscalDocument.id },
    data: {
      status: "REJECTED",
      rejectionReason,
      focusNfeStatusSefaz: typeof body.status_sefaz === "string" ? body.status_sefaz : null,
      focusNfeMensagemSefaz: typeof body.mensagem_sefaz === "string" ? body.mensagem_sefaz : null,
    },
  });

  await notifyTenant({
    tenantId: params.tenantId,
    category: "FISCAL_DOCUMENT_REJECTED",
    severity: "CRITICAL",
    title: "NFC-e rejeitada pela SEFAZ",
    body: `A nota fiscal da venda ${sale.id} foi rejeitada: ${rejectionReason}`,
    linkRoute: "/vendas/historico",
    sourceType: "FISCAL_DOCUMENT",
    sourceId: fiscalDocument.id,
  });

  return { authorized: false, accessKey: null, rejectionReason };
}

// Mapeamento best-effort nicho → item da Lista de Serviços anexa à LC 116/2003
// (base nacional usada pela maioria dos municípios atendidos pela Focus NFe).
// Documentado como aproximação honesta: municípios com lista própria divergente
// exigem ajuste manual pelo lojista direto no painel Focus NFe — nunca travamos
// a emissão por isso, pois a prefeitura aceita reclassificação posterior sem
// invalidar a nota já autorizada.
const NICHE_TAG_TO_ITEM_LISTA_SERVICO: Record<string, string> = {
  BEAUTY_SALON: "06.01", // barbeiros, cabeleireiros, manicuros, pedicuros, estética e congêneres
  CAR_DETAILING: "14.01", // lubrificação, limpeza, lustração, lavagem e conservação de veículos
  AUTOMOTIVE_WORKSHOP: "14.01", // conserto, revisão e manutenção de veículos
  PETSHOP: "06.01", // banho/tosa — tratado como congênere de estética (subitem adotado pela maioria dos municípios)
};
const DEFAULT_ITEM_LISTA_SERVICO = "14.01";

/**
 * Emite a NFS-e real junto à Focus NFe para itens de serviço (ISS municipal,
 * Capítulo 21.8), consumida pelo mesmo worker/fila `fiscal-emission` que já
 * emite NFC-e. Contrato confirmado via documentação oficial Focus NFe
 * (doc.focusnfe.com.br/reference/emitir_nfse): POST /v2/nfse?ref={referencia},
 * mesma autenticação/idempotência (`already_processed`) da NFC-e, porém síncrono
 * apenas em parte — municípios cujo webservice é mais lento podem responder
 * "processando_autorizacao" e a nota é consultada depois via GET; tratamos esse
 * status aqui mantendo o documento em PENDING (nunca como erro) para o próximo
 * ciclo do worker reconsultar.
 */
async function emitNfseDocument(
  prisma: TenantScopedPrismaClient,
  params: {
    tenantId: string;
    fiscalDocument: Prisma.FiscalDocumentGetPayload<{ include: { sale: { include: { client: true; items: { include: { product: true; service: true } } } } } }>;
    tenant: { cnpj: string | null; uf: string | null; taxRegime: string; inscricaoMunicipal: string | null };
    basicAuth: string;
  },
): Promise<FiscalDocumentEmissionResult> {
  const { fiscalDocument, tenant, basicAuth } = params;
  const sale = fiscalDocument.sale!;

  if (!tenant.inscricaoMunicipal) {
    throw new FiscalDataValidationError(
      "Tenant sem Inscrição Municipal cadastrada — impossível emitir NFS-e (ISS). Preencha a Inscrição Municipal em Configurações > Empresa antes de fechar comandas com itens de serviço.",
    );
  }

  const serviceItems = sale.items.filter((item) => item.serviceId && item.service);
  if (serviceItems.length === 0) {
    throw new Error(
      `Venda ${sale.id} não possui nenhum item de serviço — NFS-e não se aplica; o fechamento desta venda não deveria ter criado um FiscalDocument do tipo NFSE.`,
    );
  }

  const valorServicos = serviceItems.reduce((acc, item) => acc.plus(item.totalPrice), new Prisma.Decimal(0));
  const descricaoServico = serviceItems.map((item) => `${Number(item.quantity)}x ${item.service!.name}`).join("; ");
  const itemListaServico = NICHE_TAG_TO_ITEM_LISTA_SERVICO[serviceItems[0].service!.nicheTag] ?? DEFAULT_ITEM_LISTA_SERVICO;
  // Alíquota efetiva = ISS total já calculado (comanda.routes.ts/calculateIss) ÷
  // valor bruto dos serviços — nunca recalculada aqui a partir de uma TaxRule
  // nova, para que o valor transmitido à prefeitura seja idêntico ao que já foi
  // persistido/auditado no fechamento da venda (fonte única da verdade).
  const aliquotaIss = fiscalDocument.issAmount && valorServicos.greaterThan(0) ? Number(fiscalDocument.issAmount.div(valorServicos).mul(100)) : 0;

  const payload: Record<string, unknown> = {
    data_emissao: new Date().toISOString(),
    prestador: { cnpj: onlyDigits(tenant.cnpj!), inscricao_municipal: tenant.inscricaoMunicipal },
    servico: {
      item_lista_servico: itemListaServico,
      discriminacao: descricaoServico,
      valor_servicos: Number(valorServicos),
      aliquota: aliquotaIss,
      iss_retido: fiscalDocument.issRetidoNaFonte,
    },
  };

  if (sale.client?.document) {
    const digits = onlyDigits(sale.client.document);
    const tomador: Record<string, unknown> = {};
    if (digits.length === 11) tomador.cpf = digits;
    else if (digits.length === 14) tomador.cnpj = digits;
    if (sale.client.name) tomador.razao_social = sale.client.name;
    payload.tomador = tomador;
  }

  const referencia = fiscalDocument.focusNfeReference ?? fiscalDocument.id;
  if (!fiscalDocument.focusNfeReference) {
    await prisma.fiscalDocument.update({ where: { id: fiscalDocument.id }, data: { focusNfeReference: referencia } });
  }

  const response = await withCircuitBreaker(FOCUS_NFE_BREAKER, () =>
    fetch(`https://api.focusnfe.com.br/v2/nfse?ref=${encodeURIComponent(referencia)}`, {
      method: "POST",
      headers: { Authorization: `Basic ${basicAuth}`, Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );

  let body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (body.codigo === "already_processed") {
    const queryResponse = await withCircuitBreaker(FOCUS_NFE_BREAKER, () =>
      fetch(`https://api.focusnfe.com.br/v2/nfse/${encodeURIComponent(referencia)}`, {
        method: "GET",
        headers: { Authorization: `Basic ${basicAuth}`, Accept: "application/json" },
      }),
    );
    body = (await queryResponse.json().catch(() => ({}))) as Record<string, unknown>;
  }

  const status = typeof body.status === "string" ? body.status : null;

  // Alguns municípios processam a NFS-e de forma assíncrona (webservice mais
  // lento que o padrão síncrono da NFC-e) — a Focus NFe retorna
  // "processando_autorizacao" enquanto aguarda a prefeitura. Mantemos o
  // documento em PENDING (nunca rejeitado/autorizado) para o BullMQ tentar
  // novamente via backoff, nunca travando o job como falha definitiva.
  if (status === "processando_autorizacao") {
    throw new Error(
      `NFS-e ${fiscalDocument.id} ainda em processamento pela prefeitura (status "processando_autorizacao") — nova tentativa será feita automaticamente pelo BullMQ.`,
    );
  }

  if (status === "autorizado") {
    const accessKey = typeof body.chave === "string" ? body.chave : null;
    await prisma.fiscalDocument.update({
      where: { id: fiscalDocument.id },
      data: {
        status: "AUTHORIZED",
        accessKey,
        authorizedAt: new Date(),
        focusNfeNumero: typeof body.numero === "string" ? body.numero : null,
        focusNfeSerie: typeof body.serie === "string" ? body.serie : null,
        focusNfeCodigoVerificacao: typeof body.codigo_verificacao === "string" ? body.codigo_verificacao : null,
      },
    });
    await dispatchWebhookEvent(params.tenantId, "fiscal_document.authorized", {
      fiscalDocumentId: fiscalDocument.id,
      saleId: fiscalDocument.saleId,
      accessKey,
      focusNfeNumero: typeof body.numero === "string" ? body.numero : null,
    }).catch((error) => {
      createModuleLogger("emit-fiscal-document").error({ fiscalDocumentId: fiscalDocument.id, err: error }, "falha ao enfileirar webhook fiscal_document.authorized (NFS-e)");
    });
    return { authorized: true, accessKey, rejectionReason: null };
  }

  const rejectionReason =
    typeof body.mensagem === "string"
      ? body.mensagem
      : Array.isArray(body.erros)
        ? JSON.stringify(body.erros)
        : `Falha HTTP ${response.status} sem corpo de erro interpretável.`;

  await prisma.fiscalDocument.update({
    where: { id: fiscalDocument.id },
    data: { status: "REJECTED", rejectionReason },
  });

  await notifyTenant({
    tenantId: params.tenantId,
    category: "FISCAL_DOCUMENT_REJECTED",
    severity: "CRITICAL",
    title: "NFS-e rejeitada pela prefeitura",
    body: `A nota fiscal de serviço da venda ${sale.id} foi rejeitada: ${rejectionReason}`,
    linkRoute: "/vendas/historico",
    sourceType: "FISCAL_DOCUMENT",
    sourceId: fiscalDocument.id,
  });

  return { authorized: false, accessKey: null, rejectionReason };
}

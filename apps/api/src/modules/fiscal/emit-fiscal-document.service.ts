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

export { FocusNfeNotConfiguredError };

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
 * (regra mais específica por NCM/UF/nicho vence a mais genérica). Cai para os
 * defaults documentados do próprio exemplo oficial Focus NFe quando nenhuma TaxRule
 * específica declara cfop/cstCsosn — nunca lançado como erro bloqueante, pois
 * ausência de override fiscal fino não pode impedir a emissão de uma venda já
 * fechada e paga.
 */
async function resolveItemFiscalCodes(
  prisma: TenantScopedPrismaClient,
  params: { tenantId: string; ncm: string; uf: string; nicheCode: string; isSimplesNacional: boolean },
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
    select: { cfop: true, cstCsosn: true },
  });

  return {
    cfop: rule?.cfop ?? "5102", // venda de mercadoria adquirida/recebida de terceiros (operação interna)
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
          items: { include: { product: true } },
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

  if (fiscalDocument.type !== "NFCE") {
    // NF-e modelo 55 (entrada/saída de mercadoria entre empresas, Capítulo 21.8/21.17)
    // segue um contrato de payload diferente (destinatário PJ obrigatório, duplicatas,
    // transporte) ainda não portado para este worker — documentado honestamente como
    // gap de escopo, nunca silenciosamente tratado como NFC-e.
    throw new Error(
      `Emissão automática via Focus NFe implementada apenas para NFC-e nesta fase — FiscalDocument ${fiscalDocument.id} é do tipo ${fiscalDocument.type}.`,
    );
  }

  if (!fiscalDocument.sale) {
    throw new Error(
      `FiscalDocument ${fiscalDocument.id} não está vinculado a nenhuma venda — impossível montar o payload de emissão.`,
    );
  }

  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: params.tenantId },
    select: { cnpj: true, uf: true, taxRegime: true },
  });

  if (!tenant.cnpj) {
    throw new Error(
      "Tenant sem CNPJ cadastrado — impossível emitir NFC-e (tenants PERSONAL, Capítulo 22, nunca emitem documento fiscal; isto indica uma venda fechada incorretamente para um tenant sem perfil fiscal).",
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

  const sale = fiscalDocument.sale;
  const isSimplesNacional = tenant.taxRegime === "SIMPLES_NACIONAL";

  // Apenas itens de produto compõem a NFC-e (mercadoria) — itens de serviço (mão de
  // obra de O.S., Capítulo 21.8) são tributados por ISS/NFS-e municipal, fora do
  // escopo deste worker (gap documentado acima no bloco `type !== "NFCE"`).
  const productItems = sale.items.filter((item) => item.productId && item.product);
  if (productItems.length === 0) {
    throw new Error(
      `Venda ${sale.id} não possui nenhum item de produto (apenas serviços) — NFC-e não se aplica; o fechamento desta venda não deveria ter criado um FiscalDocument do tipo NFCE.`,
    );
  }

  const items = await Promise.all(
    productItems.map(async (item, index) => {
      const product = item.product!;
      const ncm = product.ncm ?? "00000000";
      const uf = product.originUf ?? tenant.uf ?? "SP";
      const nicheCode = product.nicheCode ?? "MARKET";
      const { cfop, cstCsosn } = await resolveItemFiscalCodes(prisma, {
        tenantId: params.tenantId,
        ncm,
        uf,
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
        icms_origem: "0", // mercadoria nacional — Product não distingue origem importada nesta fase
        icms_situacao_tributaria: cstCsosn,
      };
    }),
  );

  const totalPayment = productItems.reduce((acc, item) => acc.plus(item.totalPrice), new Prisma.Decimal(0));
  const sefazPaymentCode = PAYMENT_METHOD_TO_SEFAZ_CODE[sale.paymentMethod] ?? "99";

  const payload: Record<string, unknown> = {
    cnpj_emitente: onlyDigits(tenant.cnpj),
    data_emissao: new Date().toISOString(),
    presenca_comprador: resolvePresencaComprador(sale.channel),
    modalidade_frete: "9", // sem transporte — NFC-e é sempre venda direta ao consumidor final no balcão/entrega local
    local_destino: "1", // operação interna (NFC-e nunca cruza fronteira estadual)
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

  const response = await fetch(`https://api.focusnfe.com.br/v2/nfce?ref=${encodeURIComponent(referencia)}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  let body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  // Caso de borda documentado pela própria Focus NFe: se uma tentativa anterior já
  // autorizou esta referência mas o retorno do POST se perdeu antes de persistirmos
  // (timeout de rede, processo reiniciado), consultamos o resultado já definitivo em
  // vez de tratar isto como falha — nunca reenviamos o payload sob a mesma ref.
  if (body.codigo === "already_processed") {
    const queryResponse = await fetch(`https://api.focusnfe.com.br/v2/nfce/${encodeURIComponent(referencia)}`, {
      method: "GET",
      headers: { Authorization: `Basic ${basicAuth}`, Accept: "application/json" },
    });
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
        xmlStorageKey: typeof body.caminho_xml_nota_fiscal === "string" ? body.caminho_xml_nota_fiscal : null,
        danfeStorageKey: typeof body.caminho_danfe === "string" ? body.caminho_danfe : null,
        qrCodeUrl: typeof body.qrcode_url === "string" ? body.qrcode_url : null,
        focusNfeNumero: typeof body.numero === "string" ? body.numero : null,
        focusNfeSerie: typeof body.serie === "string" ? body.serie : null,
        focusNfeStatusSefaz: typeof body.status_sefaz === "string" ? body.status_sefaz : null,
        focusNfeMensagemSefaz: typeof body.mensagem_sefaz === "string" ? body.mensagem_sefaz : null,
      },
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

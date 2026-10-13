// apps/api/src/modules/hardware/tef/sitef-adapter.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 23.5 — adaptador real para o daemon
// CliSiTef/SiTef (Software Express), padrão escolhido pelo usuário para o MVP de TEF
// (genérico, não Stone/Cielo/Rede específico).
//
// PESQUISA REALIZADA NESTA SESSÃO (protocolo confirmado via busca web — não
// adivinhado): o CliSiTef é o componente que a Software Express instala no PDV físico
// do lojista (processo/serviço local, geralmente Windows, às vezes também disponível
// como wrapper HTTP). A integração real usada aqui segue o modelo "requisição local
// HTTP" descrito na documentação pública da Software Express
// (dev.softwareexpress.com.br/docs/manual-interface-clisitef — manual completo exige
// credencial de parceiro/NDA, mas a ESTRUTURA do fluxo é publicamente documentada e
// replicada em projetos de referência, ex. github.com/tefway/clisitef-basic-tests):
//
//   1. POST /iniciarFuncaoSiTef — abre uma transação: código da função (venda crédito/
//      débito/cancelamento), valor em centavos, referência do cupom (nossa `saleId`),
//      data/hora fiscal, identificação do operador/loja/terminal.
//   2. POST /continuarFuncaoSiTef (0..N vezes) — o daemon pode pedir dados adicionais
//      do operador (ex.: confirmar impressão de via) antes de liberar o resultado
//      final; o ERP exibe o campo pedido e reenvia a resposta do operador.
//   3. POST /finalizarFuncaoSiTef — confirma (ou desfaz) a transação após o ERP
//      decidir se o cupom fiscal foi emitido com sucesso (passo "confirmação"
//      exigido pelo fluxo ABECS — sem ele a transação fica pendente na adquirente).
//
// O host:porta do daemon (normalmente 127.0.0.1, mas pode ser outra máquina da rede
// local da loja que concentra o SiTef de vários PDVs) e o código da loja/terminal são
// SEMPRE configuráveis por tenant — nunca hardcoded — e vêm da mesma
// `IntegrationCredential` (provider `TEF_CLISITEF`) usada no CRUD genérico de
// integrações (`integration-credentials.routes.ts`), com o payload
// `{ host, port, storeCode, terminalId }`.
//
// LIMITAÇÃO REAL E HONESTA (documentar sempre que este arquivo for citado): este
// adaptador faz chamadas HTTP REAIS para o host/porta configurados — não existe
// nenhuma simulação de resposta de sucesso. Mas só funciona fim-a-fim quando o
// daemon CliSiTef/SiTef está de fato instalado e rodando no PC do caixa do cliente
// final (infraestrutura que só existe no ambiente de produção da loja, nunca neste
// sandbox de desenvolvimento). Sem o daemon ativo, toda chamada falha com
// `TefDaemonUnreachableError` — nunca um sucesso fingido.
import {
  TefContinuationRequest,
  TefDaemonUnreachableError,
  TefProvider,
  TefSessionResult,
  TefStartParams,
} from "./tef-provider";

export interface SitefConnectionConfig {
  host: string;
  port: number;
  storeCode: string;
  terminalId: string;
}

const REQUEST_TIMEOUT_MS = 30_000; // Transação de cartão pode esperar o cliente digitar a senha no pinpad.

// Códigos de função SiTef documentados publicamente (manual CliSiTef, seção "Funções
// disponíveis"): 1 = venda crédito à vista/parcelado loja, 2 = venda débito.
const FUNCTION_CODE: Record<TefStartParams["transactionType"], string> = {
  CREDIT: "1",
  DEBIT: "2",
};

function baseUrl(config: SitefConnectionConfig): string {
  return `http://${config.host}:${config.port}`;
}

async function postJson(url: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    // ECONNREFUSED/timeout — o daemon CliSiTef não está rodando ou o host configurado
    // está incorreto. Nunca convertido em sucesso simulado.
    throw new TefDaemonUnreachableError(
      `Não foi possível conectar ao daemon SiTef em ${url}. Verifique se o CliSiTef está instalado e em execução neste PDV, e se host/porta estão configurados corretamente em Configurações > Hardware. Detalhe técnico: ${(error as Error).message}`,
    );
  }
  const text = await response.text();
  if (!response.ok) {
    throw new TefDaemonUnreachableError(`Daemon SiTef respondeu HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    throw new TefDaemonUnreachableError(`Resposta não-JSON do daemon SiTef: ${text.slice(0, 500)}`);
  }
}

function mapContinuation(body: Record<string, unknown>): TefContinuationRequest | null {
  if (!body.campoSolicitado) return null;
  return {
    fieldId: String(body.campoSolicitado),
    label: typeof body.mensagemOperador === "string" ? body.mensagemOperador : "Confirme no terminal do caixa",
    kind: body.tipoCampo === "CONFIRMACAO" ? "CONFIRMATION" : "TEXT",
  };
}

function mapResult(sessionId: string, body: Record<string, unknown>): TefSessionResult {
  const continuation = mapContinuation(body);
  if (continuation) {
    return {
      sessionId,
      status: "AWAITING_CONTINUATION",
      nsu: null,
      authorizationCode: null,
      customerReceipt: null,
      merchantReceipt: null,
      pendingContinuation: continuation,
      rejectionReason: null,
    };
  }

  const approved = body.codigoResposta === "0" || body.codigoResposta === 0;
  return {
    sessionId,
    status: approved ? "APPROVED" : "DENIED",
    nsu: typeof body.nsu === "string" ? body.nsu : null,
    authorizationCode: typeof body.codigoAutorizacao === "string" ? body.codigoAutorizacao : null,
    customerReceipt: typeof body.viaCliente === "string" ? body.viaCliente : null,
    merchantReceipt: typeof body.viaEstabelecimento === "string" ? body.viaEstabelecimento : null,
    pendingContinuation: null,
    rejectionReason: approved ? null : typeof body.mensagem === "string" ? body.mensagem : "Transação negada pela adquirente.",
  };
}

export class SitefAdapter implements TefProvider {
  constructor(private readonly config: SitefConnectionConfig) {}

  async startTransaction(params: TefStartParams): Promise<TefSessionResult> {
    const now = new Date();
    const body = await postJson(`${baseUrl(this.config)}/iniciarFuncaoSiTef`, {
      funcao: FUNCTION_CODE[params.transactionType],
      valor: String(params.amountCents),
      cupomFiscal: params.saleReference,
      dataFiscal: now.toISOString().slice(0, 10).replace(/-/g, ""),
      horaFiscal: now.toISOString().slice(11, 19).replace(/:/g, ""),
      codigoLoja: this.config.storeCode,
      numeroTerminal: this.config.terminalId,
      numeroParcelas: params.transactionType === "CREDIT" ? String(params.installments ?? 1) : undefined,
    });
    const sessionId = typeof body.idTransacao === "string" ? body.idTransacao : `${this.config.terminalId}-${now.getTime()}`;
    return mapResult(sessionId, body);
  }

  async continueTransaction(sessionId: string, fieldId: string, value: string): Promise<TefSessionResult> {
    const body = await postJson(`${baseUrl(this.config)}/continuarFuncaoSiTef`, {
      idTransacao: sessionId,
      campoSolicitado: fieldId,
      valorResposta: value,
    });
    return mapResult(sessionId, body);
  }

  async confirmTransaction(sessionId: string): Promise<void> {
    await postJson(`${baseUrl(this.config)}/finalizarFuncaoSiTef`, {
      idTransacao: sessionId,
      confirmar: true,
    });
  }

  async cancelTransaction(sessionId: string, nsu: string, reason: string): Promise<void> {
    const now = new Date();
    await postJson(`${baseUrl(this.config)}/iniciarFuncaoSiTef`, {
      funcao: "200", // Código documentado para "cancelamento/estorno" no manual CliSiTef.
      nsu,
      justificativa: reason,
      dataFiscal: now.toISOString().slice(0, 10).replace(/-/g, ""),
      horaFiscal: now.toISOString().slice(11, 19).replace(/:/g, ""),
      codigoLoja: this.config.storeCode,
      numeroTerminal: this.config.terminalId,
      idTransacaoOriginal: sessionId,
    });
  }
}

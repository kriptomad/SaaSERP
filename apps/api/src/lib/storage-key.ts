// Convenção do Bible (Cap. 3): toda chave de objeto no R2 é `tenants/<tenantId>/<categoria>/<arquivo>`.
// Ponteiros recebidos do cliente devem ser validados contra o prefixo do tenant da sessão,
// senão um tenant poderia gravar a chave de outro e, ao gerar URL assinada de leitura, acessar o arquivo alheio.
//
// GAP DE AUDITORIA FECHADO: a validação anterior só conferia `startsWith("tenants/<id>/")`
// mais o comprimento mínimo e a ausência de segmentos literais ".."/"." em QUALQUER
// posição — permissiva demais quanto à ESTRUTURA do restante do path: aceitava
// qualquer quantidade de segmentos extras, segmentos vazios (`//`), e qualquer
// caractere (espaços, barras invertidas, caracteres de controle) nos segmentos de
// categoria/arquivo, abrindo espaço para um storageKey "parecido" mas estruturalmente
// diferente do padrão real `tenants/<tenantId>/<categoria>/<arquivo>` ser aceito como
// válido — inclusive variantes de traversal que uma camada downstream menos cuidadosa
// (ex.: uma ferramenta local que faça `path.join` ingênuo com o storageKey) poderia
// interpretar de forma diferente do R2/S3 (que trata a chave como string opaca).
// Agora a validação exige EXATAMENTE 4 segmentos (nunca mais, nunca menos) e cada
// segmento de categoria/arquivo restrito a um charset seguro (alfanumérico, ponto,
// hífen, underscore — nunca espaço, barra, ou qualquer caractere fora desse conjunto).
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9._-]+$/;

function isSafeSegment(segment: string): boolean {
  return segment.length > 0 && segment !== "." && segment !== ".." && SAFE_PATH_SEGMENT.test(segment);
}

export function isTenantStorageKey(storageKey: string, tenantId: string): boolean {
  if (!storageKey || !tenantId) return false;
  const segments = storageKey.split("/");
  // Estrutura fixa esperada: tenants/<tenantId>/<categoria>/<arquivo> — exatamente
  // 4 segmentos. Um path mais raso não é um objeto real; um path mais profundo
  // (ou com segmentos vazios por barras duplicadas) nunca corresponde a uma chave
  // de fato gerada por `presignObjectUpload`/`putObjectDirect`.
  if (segments.length !== 4) return false;
  const [root, tenantSegment, categorySegment, fileSegment] = segments;
  if (root !== "tenants") return false;
  // Comparação EXATA do segmento de tenant (nunca prefixo) — impede que o tenantId
  // da sessão seja um prefixo "parecido" de outro tenant (ex.: sessão com
  // tenantId "abc" não deve casar com uma chave gravada para o tenant "abc-outro").
  if (tenantSegment !== tenantId) return false;
  return isSafeSegment(categorySegment) && isSafeSegment(fileSegment);
}

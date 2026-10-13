// Convenção do Bible (Cap. 3): toda chave de objeto no R2 é `tenants/<tenantId>/<categoria>/<arquivo>`.
// Ponteiros recebidos do cliente devem ser validados contra o prefixo do tenant da sessão,
// senão um tenant poderia gravar a chave de outro e, ao gerar URL assinada de leitura, acessar o arquivo alheio.
export function isTenantStorageKey(storageKey: string, tenantId: string): boolean {
  if (!storageKey.startsWith(`tenants/${tenantId}/`)) return false;
  if (storageKey.length <= `tenants/${tenantId}/`.length) return false;
  return !storageKey.split("/").some((segment) => segment === ".." || segment === ".");
}

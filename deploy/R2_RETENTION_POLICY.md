# Cloudflare R2 — Política de Retenção, Versionamento e Redundância (fa-w6-di-r2-no-redundancy-retention)

> **Achado de auditoria (sev. 94):** o bucket Cloudflare R2 usado pela API
> (`apps/api/src/lib/object-storage.ts` — bucket único, isolamento lógico por prefixo
> `tenants/<tenantId>/<categoria>/<arquivo>`, config em `R2_ACCOUNT_ID` /
> `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET_NAME`, cadastrados em
> **Painel Admin → Infraestrutura** ou nas variáveis de ambiente equivalentes) não tem
> NENHUMA configuração de versionamento, lifecycle ou Object Lock documentada ou
> aplicada. Isso é puramente uma configuração do **console/API da Cloudflare**, fora do
> escopo deste repositório (não há Terraform/IaC para R2 hoje) — este documento é o
> checklist de produção que deve ser aplicado manualmente (ou via `wrangler`/API R2)
> antes de qualquer tenant real usar o bucket de produção, e deve ser revisado a cada
> mudança de bucket/conta.

## Por que isso importa

O mesmo bucket guarda, lado a lado (por prefixo):
- `tenants/<tenantId>/fiscal/...` — XMLs/PDFs de notas fiscais (obrigação legal de
  guarda de 5 anos no Brasil; ver também `fa-w6-di-fiscal-cascade-delete`).
- `tenants/<tenantId>/backups/...` — dumps criptografados do
  `encrypted-database-backup.worker.ts` (`fa-w6-di-backup-not-pit-consistent` /
  `fa-w6-di-backup-no-restore-verification`).
- `tenants/<tenantId>/os-photos/...`, `avatars/...` — anexos operacionais (perda é
  grave, mas não uma obrigação legal).

Sem versionamento/retenção no R2, um `DeleteObjectCommand` indevido (bug na API, token
comprometido, erro operacional) apaga o objeto **permanentemente e sem recuperação**,
mesmo que o registro lógico no Postgres (`DatabaseBackupLog`, `FiscalDocument`,
`TenantDataExportJob`) continue íntegro — o ponteiro para o binário fica órfão.

## Checklist obrigatório (console Cloudflare R2, antes de produção)

- [ ] **Versionamento do bucket: ON.** Painel Cloudflare → R2 → bucket → Settings →
      Object versioning → *Enable*. Isso por si só já protege contra
      overwrite/delete acidental (a versão anterior continua recuperável).
- [ ] **Lifecycle rules configuradas** (Settings → Object lifecycle rules):
      - Prefixo `tenants/*/backups/`: expirar/mover para classe de armazenamento mais
        barata após N dias **apenas para versões não-correntes** (nunca a versão
        corrente — essa é controlada pelo `data-retention-purge.worker.ts` /
        `encrypted-database-backup.worker.ts` no nível da aplicação, não pelo R2).
      - Prefixo `tenants/*/fiscal/`: **sem expiração automática** (retenção legal de 5
        anos mínimo) — se uma lifecycle rule for criada aqui, ela deve apenas mover
        para *Infrequent Access* por custo, nunca excluir.
      - Prefixo `tenants/*/exports/` (ZIPs de exportação LGPD,
        `TenantDataExportJob`): lifecycle de expiração de versões não-correntes após
        30 dias é aceitável — a exclusão da versão corrente continua sendo feita pela
        aplicação (respeitando o campo `legalHold`, ver
        `fa-w6-di-export-purge-no-legal-hold`).
- [ ] **Object Lock (modo *Compliance* ou *Governance*) nos prefixos de backup e
      fiscal.** R2 suporta Object Lock por bucket (não por prefixo) via API S3
      (`PutObjectLockConfiguration`) — hoje isso implica **um bucket separado** para
      `backups/` e `fiscal/` caso Object Lock seja exigido só para eles (o bucket
      único atual não pode ter Object Lock parcial). Decisão de produto: se a empresa
      precisar de garantia de imutabilidade (ex. para auditoria SOX/LGPD formal),
      criar `R2_FISCAL_BUCKET_NAME`/`R2_BACKUP_BUCKET_NAME` dedicados com Object Lock
      habilitado na criação do bucket (**não pode ser ativado depois**), e ajustar
      `object-storage.ts` para rotear esses prefixos ao bucket correto. **Não
      implementado neste fix** — registrado aqui como item de decisão de produto por
      exigir criação de bucket novo e migração de chaves existentes.
- [ ] **Redundância geográfica:** R2 já replica automaticamente entre data centers
      dentro da mesma jurisdição (garantia da Cloudflare, não configurável) — não há
      ação adicional aqui além de confirmar a jurisdição do bucket (Settings →
      Location) é a desejada (ex. `EEUR`/padrão) no momento da criação.
- [ ] **Credenciais de API Token com escopo mínimo:** confirmar que o token usado em
      `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` tem permissão apenas no bucket de
      produção (não "All buckets"), e que existe um token **separado** (mais restrito,
      sem `DeleteObject`) para qualquer processo de auditoria/leitura externa.
- [ ] **Alerta de custo/uso:** configurar um budget alert na conta Cloudflare para o
      bucket (Settings → Notifications), já que lifecycle mal configurado nos
      prefixos `fiscal/`/`backups/` pode levar a custo crescente sem limite.

## Verificação em nível de aplicação (boot-time warning — implementado)

Como não há forma de ler a configuração real de versionamento/lifecycle/Object Lock de
um bucket R2 via S3 API padrão (a Cloudflare não expõe `GetBucketVersioning`/
`GetBucketLifecycleConfiguration` no S3-compat hoje), a aplicação **não pode verificar
automaticamente** se este checklist foi aplicado. Como mitigação mínima, foi adicionada
uma variável de ambiente opcional `R2_RETENTION_POLICY_CONFIRMED` (ver
`apps/api/src/lib/env-validation.ts`): se ausente/diferente de `"true"` em produção
(`NODE_ENV=production`), a API **loga um warning explícito no boot** (não bloqueia o
start, pois esta é uma configuração externa ao deploy) apontando para este documento,
até que um operador confirme manualmente que o checklist acima foi aplicado no console
Cloudflare e defina a variável.

## Runbook de teste de restauração manual

Ver também `fa-w6-di-backup-no-restore-verification`: a verificação automática em
`encrypted-database-backup.worker.ts` cobre apenas a integridade do arquivo
(decrypt + contagem de linhas por modelo bate com o que foi lido). Um **drill de
restauração completa periódico** (restaurar o dump em um Postgres descartável e validar
a aplicação de ponta a ponta) continua sendo um processo manual, fora do escopo deste
fix, e deve ser executado trimestralmente usando
`apps/api/scripts/restore-encrypted-backup.mjs` contra um banco de staging/descartável,
nunca contra produção. Registrar a data/resultado de cada drill executado.

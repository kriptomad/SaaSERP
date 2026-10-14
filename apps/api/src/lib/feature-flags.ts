// apps/api/src/lib/feature-flags.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 15.2 — motor de avaliação de Feature
// Flags. GAP DE AUDITORIA FECHADO: o painel de plataforma já tinha CRUD completo
// de `FeatureFlag` (platform-admin.routes.ts), mas nenhuma rota de negócio jamais
// consultava uma flag antes de executar um fluxo — todo o mecanismo era decorativo.
//
// Regra de avaliação (Capítulo 15.2): uma flag libera um tenant quando QUALQUER uma
// das condições abaixo é verdadeira:
//   1. `enabledForTenantIds` contém o tenantId (override explícito — ex.: tenants
//      beta-testers escolhidos a dedo pelo time, sempre habilitados independente do
//      percentual de rollout).
//   2. O tenant cai dentro do `rolloutPercent` — hash determinístico de
//      `${flagKey}:${tenantId}` mod 100, NUNCA Math.random(): o mesmo tenant precisa
//      sempre cair do mesmo lado do corte em avaliações repetidas (senão o rollout
//      "piscaria" a feature ligada/desligada a cada requisição), e o hash incluir a
//      própria key evita que todos os tenants fiquem sempre nos mesmos "primeiros X%"
//      em TODAS as flags (o que aconteceria se o corte dependesse só do tenantId).
// Uma flag com `active = false` nunca libera ninguém, independente de rollout/override
// (kill switch imediato do time de plataforma).
import { createHash } from "node:crypto";
import { prismaUnscoped as prisma } from "@filitech/db";

function deterministicBucket(flagKey: string, tenantId: string): number {
  const hash = createHash("sha256").update(`${flagKey}:${tenantId}`).digest();
  // Usa só os 4 primeiros bytes do hash como inteiro sem sinal — suficiente entropia
  // para uma distribuição uniforme de 0-99 sem precisar do hash inteiro.
  const value = hash.readUInt32BE(0);
  return value % 100;
}

// Consulta direta ao banco a cada chamada (sem cache em memória): o volume de
// chamadas é baixo o suficiente (gate em início de fluxo, nunca em loop quente) para
// que a simplicidade/consistência imediata de uma config alterada no painel admin
// valha mais que a micro-otimização de um cache que precisaria de invalidação.
export async function isFeatureEnabled(flagKey: string, tenantId: string): Promise<boolean> {
  const flag = await prisma.featureFlag.findUnique({ where: { key: flagKey } });
  // Flag inexistente = comportamento padrão SEGURO: nunca bloqueia um fluxo por uma
  // flag que o time de plataforma ainda não cadastrou (fail-open), mas isso só é
  // seguro porque toda flag usada em código de produção É cadastrada manualmente no
  // bootstrap/seed do painel admin antes do deploy que a consome — nunca criada
  // implicitamente pela própria aplicação.
  if (!flag) return true;
  if (!flag.active) return false;
  if (flag.enabledForTenantIds.includes(tenantId)) return true;
  return deterministicBucket(flagKey, tenantId) < flag.rolloutPercent;
}

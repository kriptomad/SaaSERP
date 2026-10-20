// apps/api/src/lib/tenant-purge.ts
// fa-w6-bl-no-offboarding-retention — grace period configurável (dias) entre um
// tenant entrar em SUSPENDED (por qualquer motivo: inadimplência definitiva ou
// trial expirado sem contratação) e se tornar elegível ao expurgo/anonimização de
// offboarding (`workers/tenant-offboarding-purge.worker.ts`). Lido do ambiente a
// cada suspensão (nunca cacheado no módulo) para que uma mudança operacional do
// valor se aplique a partir da PRÓXIMA suspensão, sem precisar reiniciar o
// processo — `Tenant.purgeAt` já calculado permanece intocado para suspensões
// anteriores.
export function getTenantPurgeGraceDays(): number {
  const raw = Number(process.env.TENANT_PURGE_GRACE_DAYS ?? 90);
  return Number.isFinite(raw) && raw > 0 ? raw : 90;
}

/** Calcula `Tenant.purgeAt` a partir do instante exato da suspensão (`suspendedAt`). */
export function computeTenantPurgeAt(suspendedAt: Date): Date {
  return new Date(suspendedAt.getTime() + getTenantPurgeGraceDays() * 24 * 60 * 60 * 1000);
}

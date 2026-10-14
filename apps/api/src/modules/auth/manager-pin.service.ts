// apps/api/src/modules/auth/manager-pin.service.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 6.8 — PIN curto (4-6 dígitos) para
// aprovações em campo (ex.: estorno de venda) — nunca substitui a senha/2FA completos
// (Capítulo 3.5/14), apenas confirma, no próprio caixa físico, que um Owner/Manager
// específico autorizou a ação sem precisar fazer logout do operador de caixa.
//
// Correção de auditoria: o snippet original do Capítulo 6.8 usava bcrypt — inconsistente
// com o padrão de hashing argon2id já adotado em todo o resto do sistema (password.service.ts,
// Capítulo 3.5). A implementação real usa argon2id, nunca uma segunda biblioteca de hash.
import argon2 from "argon2";
import { TenantScopedPrismaClient } from "@filitech/db";
import { enforceRateLimit, resetRateLimit } from "../../lib/rate-limit";

const ARGON2_OPTIONS: argon2.Options = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export class InvalidManagerPinFormatError extends Error {}
export class ManagerPinNotConfiguredError extends Error {}
export class InvalidManagerPinError extends Error {}

export async function setManagerPin(prisma: TenantScopedPrismaClient, userId: string, rawPin: string) {
  if (!/^\d{4,6}$/.test(rawPin)) {
    throw new InvalidManagerPinFormatError("O PIN deve conter de 4 a 6 dígitos numéricos.");
  }
  const managerPinHash = await argon2.hash(rawPin, ARGON2_OPTIONS);
  return prisma.user.update({ where: { id: userId }, data: { managerPinHash } });
}

export async function verifyManagerPin(prisma: TenantScopedPrismaClient, userId: string, rawPin: string): Promise<true> {
  // Mesmo padrão de lockout por tentativas do login (Capítulo 14.3): 3 tentativas
  // erradas em 5 minutos bloqueiam novas tentativas de PIN para o usuário por 5
  // minutos, independente de bloqueio de senha.
  await enforceRateLimit(`managerpin:fail:${userId}`, 3, 300);

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.managerPinHash) {
    throw new ManagerPinNotConfiguredError("Este usuário ainda não configurou um PIN de gerente.");
  }

  const valid = await argon2.verify(user.managerPinHash, rawPin);
  if (!valid) {
    throw new InvalidManagerPinError("PIN de gerente inválido.");
  }
  // O contador de tentativas só deve limitar ERROS — sem este reset, um gerente
  // legítimo ficaria bloqueado após a 3ª autorização válida em 5 minutos.
  await resetRateLimit(`managerpin:fail:${userId}`);
  return true;
}

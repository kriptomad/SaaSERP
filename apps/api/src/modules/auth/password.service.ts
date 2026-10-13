// apps/api/src/modules/auth/password.service.ts
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 3.5 — Segurança de Autenticação.
import argon2 from "argon2";

const ARGON2_OPTIONS: argon2.Options = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export async function hashPassword(plainPassword: string): Promise<string> {
  return argon2.hash(plainPassword, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, plainPassword: string): Promise<boolean> {
  return argon2.verify(hash, plainPassword);
}

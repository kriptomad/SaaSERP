// apps/web/src/shared/validation/password-strength.ts
// Espelha exatamente apps/api/src/lib/password-policy.ts — os dois arquivos
// implementam os MESMOS 5 critérios de força na MESMA ordem (nenhum pacote
// compartilhado entre apps/api e apps/web neste monorepo, por convenção já usada
// em outros utilitários duplicados como shared/storage/upload.ts vs
// lib/object-storage.ts). Qualquer mudança de critério deve ser replicada nos
// dois lados.
const SPECIAL_CHAR_REGEX = /[!@#$%^&*(),.?":{}|<>_\-+=~`[\]\\/;']/;

export interface PasswordPolicyResult {
  valid: boolean;
  errors: string[];
}

/** Mesma validação mínima obrigatória do backend — usada para feedback inline antes do submit. */
export function validatePasswordPolicy(password: string): PasswordPolicyResult {
  const errors: string[] = [];
  if (password.length < 8) {
    errors.push("Mínimo de 8 caracteres.");
  }
  if (!SPECIAL_CHAR_REGEX.test(password)) {
    errors.push("Pelo menos 1 caractere especial (ex.: ! @ # $ % & *).");
  }
  return { valid: errors.length === 0, errors };
}

export type PasswordStrengthLabel = "Muito fraca" | "Fraca" | "Média" | "Forte" | "Muito forte";

export interface PasswordStrengthResult {
  score: number; // 0-5
  label: PasswordStrengthLabel;
  percent: number; // 0-100, para alimentar a LinearProgress
  color: "error" | "warning" | "info" | "success";
}

export function computePasswordStrength(password: string): PasswordStrengthResult {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (SPECIAL_CHAR_REGEX.test(password)) score++;

  const label: PasswordStrengthLabel =
    score <= 1 ? "Muito fraca" : score === 2 ? "Fraca" : score === 3 ? "Média" : score === 4 ? "Forte" : "Muito forte";
  const color: PasswordStrengthResult["color"] =
    score <= 1 ? "error" : score === 2 ? "warning" : score === 3 ? "info" : "success";

  return { score, label, percent: (score / 5) * 100, color };
}

// apps/api/src/lib/password-policy.ts
// Política mínima de senha forte, aplicada em TODO lugar onde uma senha é definida
// (signup do dono do tenant, criação de usuário pelo Owner/Manager, reset de senha
// do admin de plataforma): mínimo 8 caracteres e pelo menos 1 caractere especial —
// o mesmo critério usado pelo medidor de força visual no frontend
// (apps/web/src/shared/validation/password-strength.ts), para nunca divergir em
// dois lugares o que conta como "forte o suficiente para ser aceita".
const SPECIAL_CHAR_REGEX = /[!@#$%^&*(),.?":{}|<>_\-+=~`[\]\\/;']/;

export interface PasswordPolicyResult {
  valid: boolean;
  errors: string[];
}

/** Validação mínima OBRIGATÓRIA (bloqueia o cadastro se falhar). */
export function validatePasswordPolicy(password: string): PasswordPolicyResult {
  const errors: string[] = [];
  if (password.length < 8) {
    errors.push("A senha deve ter no mínimo 8 caracteres.");
  }
  if (!SPECIAL_CHAR_REGEX.test(password)) {
    errors.push("A senha deve conter pelo menos 1 caractere especial (ex.: ! @ # $ % & *).");
  }
  return { valid: errors.length === 0, errors };
}

export function isStrongPassword(password: string): boolean {
  return validatePasswordPolicy(password).valid;
}

export type PasswordStrengthLabel = "Muito fraca" | "Fraca" | "Média" | "Forte" | "Muito forte";

/**
 * Score 0-5 usado pela barra de força no frontend — soma de 5 critérios
 * independentes (mais generoso que o mínimo obrigatório acima, para dar feedback
 * incremental enquanto o usuário digita). Mantido aqui (mesmo sem UI no backend)
 * para o cálculo nunca divergir do frontend — ambos os arquivos implementam
 * exatamente os mesmos 5 critérios na mesma ordem.
 */
export function computePasswordStrength(password: string): { score: number; label: PasswordStrengthLabel } {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (SPECIAL_CHAR_REGEX.test(password)) score++;

  const label: PasswordStrengthLabel =
    score <= 1 ? "Muito fraca" : score === 2 ? "Fraca" : score === 3 ? "Média" : score === 4 ? "Forte" : "Muito forte";

  return { score, label };
}

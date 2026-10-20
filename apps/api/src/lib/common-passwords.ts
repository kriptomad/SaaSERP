// apps/api/src/lib/common-passwords.ts
// CORREÇÃO DE AUDITORIA (fa-w6-sess-password-policy-no-breach-check):
// password-policy.ts só checava comprimento/caractere especial — uma senha
// trivialmente adivinhável/vazada (ex.: "Password1!", "Senha123!") passava
// normalmente desde que tivesse 8+ caracteres e 1 especial. Esta lista local
// (top senhas mais comuns, incluindo variações em PT-BR relevantes para um SaaS
// brasileiro) é verificada em `validatePasswordPolicy` — deliberadamente NÃO
// chamamos uma API externa tipo HIBP aqui: o caminho de login/signup/troca de
// senha é hot-path de autenticação e não pode depender de uma chamada de rede
// para um serviço terceiro (latência, disponibilidade, e também vazaria o fato
// de que uma senha específica está sendo testada para um serviço externo).
// Comparação é sempre case-insensitive (ver password-policy.ts) — um atacante
// não ganha nada capitalizando/trocando de caixa uma senha já comum.
export const COMMON_PASSWORDS: ReadonlySet<string> = new Set(
  [
    "123456", "123456789", "12345678", "12345", "1234567", "1234567890", "qwerty", "password",
    "111111", "123123", "abc123", "1q2w3e4r", "qwertyuiop", "iloveyou", "000000", "zaq12wsx",
    "dragon", "monkey", "letmein", "login", "princess", "qwerty123", "solo", "passw0rd",
    "starwars", "football", "welcome", "admin", "admin123", "sunshine", "master", "hello",
    "freedom", "whatever", "trustno1", "shadow", "superman", "michael", "jennifer", "jordan",
    "hunter", "hunter2", "baseball", "flower", "michelle", "charlie", "robert", "thomas",
    "ginger", "andrew", "lovely", "7777777", "yellow", "biteme", "test", "test123",
    "changeme", "changeit", "default", "guest", "guest123", "demo", "demo123", "temp123",
    "senha", "senha123", "123456senha", "brasil", "brasil123", "brasil2024", "brasil2025",
    "senha1234", "minhasenha", "123mudar", "mudar123", "acesso123", "acesso1234",
    "abcd1234", "a1b2c3d4", "qazwsx", "1qaz2wsx", "p@ssw0rd", "p@ssword", "passw0rd!",
    "password1", "password123", "password1!", "senha123!", "senha@123", "senha#123",
    "qwer1234", "asdf1234", "zxcv1234", "1234qwer", "aa123456", "q1w2e3r4", "123qwe",
    "11111111", "88888888", "99999999", "123321", "654321", "1q2w3e", "121212", "232323",
    "666666", "7777777", "8675309", "princess1", "letmein1", "welcome1", "football1",
    "baseball1", "dragon1", "master1", "monkey1", "shadow1", "superman1", "trustno11",
    "iloveyou1", "sunshine1", "flower1", "charlie1", "jennifer1", "michelle1", "jordan23",
    "michael1", "andrew1", "joshua1", "daniel1", "thomas1", "robert1", "matthew1",
    "abcdefgh", "abcdef", "abcdefg", "aaaaaa", "1111111", "123456a", "a123456", "111222",
  ].map((password) => password.toLowerCase()),
);

export function isCommonPassword(password: string): boolean {
  return COMMON_PASSWORDS.has(password.toLowerCase());
}

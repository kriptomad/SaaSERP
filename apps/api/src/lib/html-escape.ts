// apps/api/src/lib/html-escape.ts
// fa-w5-notif-email-html-injection / fa-w5-notif-reset-email-html-injection — helper
// único e reutilizável para escapar conteúdo controlado por tenant/usuário antes de
// interpolar em HTML de e-mail (ou qualquer outro contexto HTML server-side). Sem
// isto, um `title`/`body` de notificação ou um `User.name`/`Tenant.tradeName`
// contendo `<script>`/`<img onerror=...>` era inserido CRU dentro de `<p>${...}</p>`
// — o destinatário do e-mail (aberto num cliente de e-mail que renderiza HTML) ficava
// exposto a HTML/script injection a partir de dados que um usuário comum do tenant
// controla (ex.: nome de usuário no cadastro, nome fantasia do tenant, corpo de uma
// notificação cujo texto/dados vêm de registros de negócio editáveis).
//
// Verificado antes de criar este arquivo: não existia nenhum helper equivalente
// (`escapeHtml`/`sanitizeHtml`/etc.) em nenhum outro lugar do monorepo.
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

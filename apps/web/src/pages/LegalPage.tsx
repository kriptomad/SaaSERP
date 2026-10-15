// apps/web/src/pages/LegalPage.tsx
// GAP DE AUDITORIA FECHADO (mega-audit rodada 5): o checkbox de consentimento do
// cadastro (SignupPage) linkava para `/termos` e `/privacidade`, mas nenhuma das
// duas rotas existia — um link morto não constitui consentimento informado válido
// perante a LGPD. Conteúdo real e específico do produto (não um texto genérico
// "lorem ipsum" de placeholder), cobrindo os pontos que a arquitetura real do
// sistema de fato implementa (multi-tenant, dados fiscais, Open Finance/Pluggy,
// WhatsApp, cookies de sessão JWT).
import { Box, Container, Paper, Typography, Divider, Link as MuiLink } from "@mui/material";
import { Link as RouterLink, useLocation } from "react-router-dom";

const TERMS_CONTENT = (
  <>
    <Typography variant="h4" gutterBottom>Termos de Uso — Filitech ERP</Typography>
    <Typography variant="caption" color="text.secondary">Última atualização: {new Date().toLocaleDateString("pt-BR")}</Typography>
    <Divider sx={{ my: 2 }} />
    <Typography variant="h6" gutterBottom>1. Objeto</Typography>
    <Typography paragraph>
      O Filitech ERP é uma plataforma SaaS multi-tenant de gestão empresarial (PDV, estoque, ordens de
      serviço, financeiro, fiscal e módulos de nicho) oferecida por assinatura mensal recorrente. Ao
      criar uma conta ("Tenant"), você concorda com estes Termos de Uso em nome próprio ou da pessoa
      jurídica que representa.
    </Typography>
    <Typography variant="h6" gutterBottom>2. Conta e responsabilidade pelos dados</Typography>
    <Typography paragraph>
      Cada Tenant é logicamente isolado dos demais clientes da plataforma. Você é responsável pela
      veracidade dos dados cadastrais (incluindo CNPJ/CPF, razão social e regime tributário), pela
      guarda de suas credenciais de acesso e por toda atividade realizada sob sua conta, incluindo
      documentos fiscais emitidos através da plataforma.
    </Typography>
    <Typography variant="h6" gutterBottom>3. Assinatura, cobrança e suspensão</Typography>
    <Typography paragraph>
      Planos pagos são cobrados via Stripe ou Asaas conforme o ciclo escolhido. O não pagamento após o
      vencimento resulta em período de carência seguido de suspensão de acesso (bloqueio HTTP 402),
      sem exclusão imediata dos dados. Dados ficam retidos por período adicional antes da exclusão
      definitiva, conforme nossa Política de Privacidade.
    </Typography>
    <Typography variant="h6" gutterBottom>4. Documentos fiscais</Typography>
    <Typography paragraph>
      A emissão de NF-e/NFC-e/NFS-e é realizada através de integração com provedor terceirizado (Focus
      NFe) e SEFAZ/prefeituras. A Filitech não se responsabiliza por indisponibilidades dos serviços
      governamentais, mas garante que os cálculos tributários aplicados refletem a configuração fiscal
      informada pelo Tenant (regime, CFOP, CST/CSOSN).
    </Typography>
    <Typography variant="h6" gutterBottom>5. Rescisão</Typography>
    <Typography paragraph>
      Você pode encerrar sua conta a qualquer momento através do painel administrativo. A Filitech pode
      suspender ou encerrar contas que violem estes termos, pratiquem fraude fiscal ou coloquem em
      risco a segurança de outros Tenants.
    </Typography>
  </>
);

const PRIVACY_CONTENT = (
  <>
    <Typography variant="h4" gutterBottom>Política de Privacidade — Filitech ERP</Typography>
    <Typography variant="caption" color="text.secondary">Última atualização: {new Date().toLocaleDateString("pt-BR")}</Typography>
    <Divider sx={{ my: 2 }} />
    <Typography variant="h6" gutterBottom>1. Dados coletados</Typography>
    <Typography paragraph>
      Coletamos dados cadastrais da empresa/pessoa (razão social, CNPJ/CPF, endereço), dados de
      usuários (nome, e-mail, telefone/WhatsApp), dados operacionais inseridos no sistema (clientes,
      produtos, vendas, ordens de serviço) e, quando você opta pela integração Open Finance (módulo
      Filitech Pessoal), dados bancários obtidos via Pluggy, sob seu consentimento explícito e
      revogável a qualquer momento.
    </Typography>
    <Typography variant="h6" gutterBottom>2. Base legal e finalidade (LGPD)</Typography>
    <Typography paragraph>
      O tratamento de dados ocorre para execução do contrato de prestação de serviço SaaS (Art. 7º, V,
      LGPD), cumprimento de obrigação legal/fiscal (Art. 7º, II) quando documentos fiscais são
      emitidos, e mediante consentimento (Art. 7º, I) para integrações opcionais como Open Finance e
      notificações via WhatsApp.
    </Typography>
    <Typography variant="h6" gutterBottom>3. Isolamento multi-tenant</Typography>
    <Typography paragraph>
      Todos os dados operacionais são isolados por `tenantId` em nível de banco de dados e de código —
      nenhum outro Tenant (incluindo outros clientes da Filitech) tem acesso aos seus dados. Acessos
      administrativos da equipe Filitech ao seu Tenant, quando necessários para suporte, são
      registrados em trilha de auditoria.
    </Typography>
    <Typography variant="h6" gutterBottom>4. Compartilhamento com terceiros</Typography>
    <Typography paragraph>
      Dados são compartilhados apenas com processadores estritamente necessários à operação: Stripe/
      Asaas (cobrança), Focus NFe e SEFAZ/prefeituras (emissão fiscal), Pluggy (Open Finance, somente
      se habilitado), provedores de e-mail/SMS/WhatsApp (notificações) e Cloudflare R2 (armazenamento
      de arquivos). Nunca vendemos dados pessoais a terceiros.
    </Typography>
    <Typography variant="h6" gutterBottom>5. Seus direitos</Typography>
    <Typography paragraph>
      Você pode solicitar exportação (portabilidade), correção ou exclusão de seus dados a qualquer
      momento através do painel administrativo (exportação de dados) ou pelo encerramento da conta.
      Dados fiscais têm retenção mínima legal obrigatória (5 anos) mesmo após solicitação de exclusão,
      conforme legislação tributária brasileira.
    </Typography>
    <Typography variant="h6" gutterBottom>6. Cookies e sessão</Typography>
    <Typography paragraph>
      Utilizamos exclusivamente cookies/armazenamento local técnicos e estritamente necessários
      (token de sessão JWT) — não utilizamos cookies de rastreamento publicitário de terceiros.
    </Typography>
  </>
);

export function LegalPage() {
  const location = useLocation();
  const content = location.pathname === "/privacidade" ? PRIVACY_CONTENT : TERMS_CONTENT;

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default", py: 6 }}>
      <Container maxWidth="md">
        <Paper elevation={1} sx={{ p: 4 }}>
          {content}
          <Divider sx={{ my: 2 }} />
          <MuiLink component={RouterLink} to="/signup">Voltar ao cadastro</MuiLink>
        </Paper>
      </Container>
    </Box>
  );
}

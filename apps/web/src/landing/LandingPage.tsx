// apps/web/src/landing/LandingPage.tsx
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 2.1/2.2 (Landing Page institucional,
// "Dark Premium") + diretriz explícita do usuário: site moderno, com
// transições, efeitos de transparência (glassmorphism), aba dedicada de
// nichos mostrando módulos/planos por nicho, e possibilidade de montar plano
// à la carte somando módulos avulsos.
import { useMemo, useState } from "react";
import {
  AppBar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Container,
  Stack,
  Tab,
  Tabs,
  Toolbar,
  Typography,
  Checkbox,
  FormControlLabel,
  Divider,
  alpha,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import BoltIcon from "@mui/icons-material/Bolt";
import CloudOffIcon from "@mui/icons-material/CloudOff";
import ShieldIcon from "@mui/icons-material/Shield";
import { motion, AnimatePresence } from "framer-motion";
import { NICHES, MODULE_CATALOG, findPlan, findModule } from "../content/catalog";
import { ThemeToggleButton } from "../theme/ThemeToggleButton";

const GAP_SOLUTIONS = [
  {
    icon: <BoltIcon fontSize="large" />,
    title: "PDV lento? Resolvido com Offline-First",
    body: "Vendas gravadas localmente (IndexedDB) e sincronizadas assim que a rede volta — nunca trava o caixa por instabilidade de internet.",
  },
  {
    icon: <CloudOffIcon fontSize="large" />,
    title: "Sem conexão não é motivo de parada",
    body: "Diferente dos grandes ERPs que travam sem internet, o Filitech continua vendendo e emitindo fiscal assim que a conexão retorna.",
  },
  {
    icon: <ShieldIcon fontSize="large" />,
    title: "Interface limpa, sem poluição visual",
    body: "MUI v5 com hierarquia visual clara — reclamação recorrente de usuários de ERPs tradicionais (telas lotadas, fluxos confusos).",
  },
];

function fadeUp(delay = 0) {
  return {
    initial: { opacity: 0, y: 24 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, margin: "-80px" },
    transition: { duration: 0.6, delay },
  };
}

export function LandingPage() {
  const [activeNicheId, setActiveNicheId] = useState(NICHES[0].id);
  const [extraModuleCodes, setExtraModuleCodes] = useState<string[]>([]);

  const activeNiche = useMemo(() => NICHES.find((n) => n.id === activeNicheId)!, [activeNicheId]);
  const comboPlan = findPlan(activeNiche.comboPlanCode);

  const extraModulesTotal = extraModuleCodes.reduce((sum, code) => {
    if (activeNiche.moduleCodes.includes(code)) return sum; // já incluso no combo, não soma de novo
    const mod = findModule(code);
    return sum + (mod?.monthlyPrice ?? 0);
  }, 0);

  const estimatedTotal = (comboPlan?.basePrice ?? 0) + extraModulesTotal;

  function toggleExtraModule(code: string) {
    setExtraModuleCodes((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  }

  return (
    <Box sx={{ bgcolor: "background.default", color: "text.primary", minHeight: "100vh" }}>
      {/* Header translúcido (glassmorphism) — fixo no topo com blur sobre o hero */}
      <AppBar
        position="sticky"
        elevation={0}
        sx={{
          bgcolor: (t) => alpha(t.palette.background.default, 0.7),
          color: "text.primary",
          backdropFilter: "blur(12px)",
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <Toolbar sx={{ justifyContent: "space-between" }}>
          <Typography variant="h6" fontWeight={700}>
            Filitech <Box component="span" sx={{ color: "primary.main" }}>ERP</Box>
          </Typography>
          <Stack direction="row" spacing={{ xs: 0.5, md: 2 }} alignItems="center">
            <Button href="#nichos" color="inherit" sx={{ display: { xs: "none", sm: "inline-flex" } }}>Nichos</Button>
            <Button href="#precos" color="inherit" sx={{ display: { xs: "none", sm: "inline-flex" } }}>Planos</Button>
            <Button href="/login" color="inherit">Entrar</Button>
            <Button href="/signup" variant="contained" sx={{ display: { xs: "none", sm: "inline-flex" } }}>
              Criar minha empresa
            </Button>
            <ThemeToggleButton />
          </Stack>
        </Toolbar>
      </AppBar>

      {/* HERO */}
      <Box
        sx={{
          position: "relative",
          overflow: "hidden",
          py: { xs: 10, md: 16 },
          background: (t) =>
            `radial-gradient(circle at 20% 20%, ${alpha(t.palette.secondary.main, 0.15)}, transparent 45%), radial-gradient(circle at 80% 0%, ${alpha(t.palette.primary.main, 0.18)}, transparent 40%)`,
        }}
      >
        <Container maxWidth="md">
          <motion.div {...fadeUp(0)}>
            <Chip label="Vertical SaaS multi-nicho" color="primary" variant="outlined" sx={{ mb: 3 }} />
            <Typography variant="h2" fontWeight={800} sx={{ mb: 2, fontSize: { xs: "2.2rem", md: "3.5rem" } }}>
              O ERP que não trava, não emperra e fala a língua do seu negócio.
            </Typography>
            <Typography variant="h6" color="text.secondary" sx={{ mb: 4, fontWeight: 400 }}>
              PDV offline-first, fiscal completo com Reforma Tributária embutida e regras específicas para
              mercado, assistência técnica, adega, padaria, farmácia e varejo geral — tudo em um único sistema.
            </Typography>
            <Stack direction="row" spacing={2}>
              <Button href="/signup" size="large" variant="contained" sx={{ px: 4 }}>
                Começar grátis
              </Button>
              <Button href="#nichos" size="large" variant="outlined" color="inherit">
                Ver meu nicho
              </Button>
            </Stack>
          </motion.div>
        </Container>
      </Box>

      {/* GAPS DO MERCADO RESOLVIDOS */}
      <Container maxWidth="lg" sx={{ py: { xs: 8, md: 12 } }}>
        <motion.div {...fadeUp(0)}>
          <Typography variant="overline" color="primary.main">Por que trocar de ERP</Typography>
          <Typography variant="h4" fontWeight={700} sx={{ mb: 6 }}>
            Resolvemos exatamente o que mais reclamam dos ERPs tradicionais
          </Typography>
        </motion.div>
        <Stack direction={{ xs: "column", md: "row" }} spacing={3}>
          {GAP_SOLUTIONS.map((g, i) => (
            <motion.div key={g.title} {...fadeUp(i * 0.1)} style={{ flex: 1 }}>
              <Card
                variant="outlined"
                sx={{
                  height: "100%",
                  bgcolor: (t) => alpha(t.palette.background.paper, 0.7),
                  backdropFilter: "blur(6px)",
                  color: "inherit",
                }}
              >
                <CardContent>
                  <Box sx={{ color: "primary.main", mb: 2 }}>{g.icon}</Box>
                  <Typography variant="h6" fontWeight={700} gutterBottom>{g.title}</Typography>
                  <Typography variant="body2" color="text.secondary">{g.body}</Typography>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </Stack>
      </Container>

      {/* ABA DE NICHOS */}
      <Box id="nichos" sx={{ bgcolor: (t) => alpha(t.palette.text.primary, 0.03), py: { xs: 8, md: 12 } }}>
        <Container maxWidth="lg">
          <motion.div {...fadeUp(0)}>
            <Typography variant="overline" color="primary.main">Um sistema, dezoito especialidades</Typography>
            <Typography variant="h4" fontWeight={700} sx={{ mb: 1 }}>
              Escolha seu nicho e veja exatamente o que está incluso
            </Typography>
            <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
              Cada nicho tem regras fiscais e operacionais próprias — não é um sistema genérico com rótulo trocado.
            </Typography>
          </motion.div>

          <Tabs
            value={activeNicheId}
            onChange={(_, v) => setActiveNicheId(v)}
            variant="scrollable"
            scrollButtons="auto"
            sx={{ mb: 4 }}
          >
            {NICHES.map((n) => (
              <Tab key={n.id} value={n.id} label={n.label} />
            ))}
          </Tabs>

          <AnimatePresence mode="wait">
            <motion.div
              key={activeNicheId}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.3 }}
            >
              <Stack direction={{ xs: "column", md: "row" }} spacing={4}>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="h5" fontWeight={700} gutterBottom>{activeNiche.label}</Typography>
                  <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
                    {activeNiche.tagline}
                  </Typography>
                  <Typography variant="subtitle2" color="primary.main" gutterBottom>Dores que resolvemos</Typography>
                  <Stack spacing={1} sx={{ mb: 3 }}>
                    {activeNiche.painPoints.map((p) => (
                      <Stack key={p} direction="row" spacing={1} alignItems="flex-start">
                        <CheckCircleIcon fontSize="small" sx={{ color: "primary.main", mt: "2px" }} />
                        <Typography variant="body2" color="text.secondary">{p}</Typography>
                      </Stack>
                    ))}
                  </Stack>
                </Box>

                <Box sx={{ flex: 1 }}>
                  <Card variant="outlined">
                    <CardContent>
                      <Typography variant="subtitle2" color="primary.main" gutterBottom>Módulos inclusos neste nicho</Typography>
                      <Stack spacing={1.5} sx={{ mb: 2 }}>
                        {activeNiche.moduleCodes.map((code) => {
                          const mod = findModule(code);
                          if (!mod) return null;
                          return (
                            <Stack key={code} direction="row" justifyContent="space-between" alignItems="center">
                              <Typography variant="body2">{mod.label}</Typography>
                              <Chip size="small" color="primary" variant="outlined" label={`R$ ${mod.monthlyPrice.toFixed(2)}/mês`} />
                            </Stack>
                          );
                        })}
                      </Stack>
                      <Divider sx={{ mb: 2 }} />
                      <Stack direction="row" justifyContent="space-between" alignItems="baseline">
                        <Typography variant="body2" color="text.secondary">Plano {activeNiche.label}</Typography>
                        <Typography variant="h5" fontWeight={800}>R$ {(comboPlan?.basePrice ?? 0).toFixed(2)}<Typography component="span" variant="body2">/mês</Typography></Typography>
                      </Stack>
                      <Typography variant="caption" color="text.secondary">
                        10 usuários inclusos — cada usuário adicional custa +R$ 35,00/mês
                      </Typography>
                      <Button href="/signup" fullWidth variant="contained" sx={{ mt: 2 }}>
                        Assinar plano {activeNiche.label}
                      </Button>
                    </CardContent>
                  </Card>
                </Box>
              </Stack>
            </motion.div>
          </AnimatePresence>
        </Container>
      </Box>

      {/* MONTE SEU PLANO (à la carte) */}
      <Container maxWidth="md" sx={{ py: { xs: 8, md: 12 } }} id="precos">
        <motion.div {...fadeUp(0)}>
          <Typography variant="overline" color="primary.main">Precificação transparente</Typography>
          <Typography variant="h4" fontWeight={700} sx={{ mb: 1 }}>
            Monte seu plano somando módulos à la carte
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
            Comece pelo combo do seu nicho ({activeNiche.label}) e adicione módulos extras de outros nichos, cobrados à parte.
          </Typography>
        </motion.div>

        <Card variant="outlined">
          <CardContent>
            <Stack spacing={1.5} sx={{ mb: 2 }}>
              {MODULE_CATALOG.map((mod) => {
                const includedInCombo = activeNiche.moduleCodes.includes(mod.code);
                return (
                  <Stack key={mod.code} direction="row" justifyContent="space-between" alignItems="center">
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={includedInCombo || extraModuleCodes.includes(mod.code)}
                          disabled={includedInCombo}
                          onChange={() => toggleExtraModule(mod.code)}
                        />
                      }
                      label={
                        <Typography variant="body2">
                          {mod.label} {includedInCombo && <Chip size="small" label="incluso no combo" sx={{ ml: 1 }} />}
                        </Typography>
                      }
                    />
                    <Typography variant="body2" color="text.secondary">R$ {mod.monthlyPrice.toFixed(2)}/mês</Typography>
                  </Stack>
                );
              })}
            </Stack>
            <Divider sx={{ mb: 2 }} />
            <Stack direction="row" justifyContent="space-between" alignItems="baseline">
              <Typography variant="body1">Total estimado</Typography>
              <Typography variant="h4" fontWeight={800}>R$ {estimatedTotal.toFixed(2)}<Typography component="span" variant="body2">/mês</Typography></Typography>
            </Stack>
            <Button href="/signup" fullWidth size="large" variant="contained" sx={{ mt: 3 }}>
              Começar com este plano
            </Button>
          </CardContent>
        </Card>
      </Container>

      <Box component="footer" sx={{ borderTop: 1, borderColor: "divider", py: 4 }}>
        <Container maxWidth="lg">
          <Typography variant="body2" color="text.secondary" align="center">
            © {new Date().getFullYear()} Filitech ERP — Todos os direitos reservados.
          </Typography>
        </Container>
      </Box>
    </Box>
  );
}

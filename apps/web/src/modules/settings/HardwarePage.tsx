// apps/web/src/modules/settings/HardwarePage.tsx
// Fonte: BIBLE_ENGINEERING_V2.md, novo Capítulo 23 — painel de configuração de
// hardware do PDV (item final da missão: "lojista escolhe modelo de balança/
// impressora e testa a conexão"). Preferências de impressora/balança/gaveta são
// por TERMINAL físico (localStorage, ver hardware-config.ts); a credencial de TEF é
// por TENANT (IntegrationCredential, provider TEF_CLISITEF), pois o daemon SiTef é
// um serviço de rede local da loja, não do navegador.
import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Divider,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { api } from "../../api/client";
import {
  HardwareConfig,
  loadHardwareConfig,
  saveHardwareConfig,
} from "../../shared/hardware/hardware-config";
import {
  PRINTER_PROFILES,
  ThermalPrinterService,
  isWebSerialSupported,
} from "../../shared/hardware/thermal-printer.service";
import { ScaleService, isWebSerialSupportedForScale } from "../../shared/hardware/scale.service";

interface IntegrationCredentialSummary {
  id: string;
  provider: string;
  active: boolean;
  lastTestedAt: string | null;
  lastTestSuccess: boolean | null;
  lastTestMessage: string | null;
}

interface LabelPrinterConfig {
  id: string;
  name: string;
  connectionType: "NETWORK" | "USB" | "BLUETOOTH";
  networkHost: string | null;
  networkPort: number | null;
  labelWidthMm: number;
  labelHeightMm: number;
  isDefault: boolean;
}

export function HardwarePage() {
  const [config, setConfig] = useState<HardwareConfig>(() => loadHardwareConfig());
  const [printerMessage, setPrinterMessage] = useState<string | null>(null);
  const [scaleMessage, setScaleMessage] = useState<string | null>(null);

  const [tefHost, setTefHost] = useState("127.0.0.1");
  const [tefPort, setTefPort] = useState("4096");
  const [tefStoreCode, setTefStoreCode] = useState("");
  const [tefTerminalId, setTefTerminalId] = useState("");
  const [tefCredential, setTefCredential] = useState<IntegrationCredentialSummary | null>(null);
  const [tefMessage, setTefMessage] = useState<string | null>(null);
  const [tefSaving, setTefSaving] = useState(false);
  const [tefTesting, setTefTesting] = useState(false);

  const [labelPrinters, setLabelPrinters] = useState<LabelPrinterConfig[]>([]);
  const [newPrinterName, setNewPrinterName] = useState("");
  const [newPrinterHost, setNewPrinterHost] = useState("");
  const [newPrinterPort, setNewPrinterPort] = useState("9100");
  const [labelPrinterMessage, setLabelPrinterMessage] = useState<string | null>(null);

  function reloadLabelPrinters() {
    api
      .get<LabelPrinterConfig[]>("/label-printers")
      .then(setLabelPrinters)
      .catch(() => undefined);
  }

  useEffect(() => {
    api
      .get<IntegrationCredentialSummary[]>("/integration-credentials")
      .then((list) => setTefCredential(list.find((c) => c.provider === "TEF_CLISITEF") ?? null))
      .catch(() => undefined);
    reloadLabelPrinters();
  }, []);

  function updateConfig(patch: Partial<HardwareConfig>) {
    setConfig((prev) => {
      const next = { ...prev, ...patch };
      saveHardwareConfig(next);
      return next;
    });
  }

  async function handleTestPrinter() {
    setPrinterMessage(null);
    if (!config.printerModel) {
      setPrinterMessage("Selecione um modelo de impressora primeiro.");
      return;
    }
    if (!isWebSerialSupported()) {
      setPrinterMessage("Este navegador não suporta Web Serial API. Use Chrome ou Edge para conectar impressoras ESC/POS.");
      return;
    }
    try {
      const printer = new ThermalPrinterService(PRINTER_PROFILES[config.printerModel]);
      await printer.connect();
      setPrinterMessage("Conexão com a impressora estabelecida com sucesso.");
      await printer.disconnect();
    } catch (error) {
      setPrinterMessage(`Falha ao conectar: ${(error as Error).message}`);
    }
  }

  async function handleTestCashDrawer() {
    setPrinterMessage(null);
    if (!config.printerModel) {
      setPrinterMessage("Selecione um modelo de impressora primeiro (a gaveta é acionada através dela).");
      return;
    }
    if (!isWebSerialSupported()) {
      setPrinterMessage("Este navegador não suporta Web Serial API.");
      return;
    }
    try {
      const printer = new ThermalPrinterService(PRINTER_PROFILES[config.printerModel]);
      await printer.connect();
      await printer.openCashDrawer();
      setPrinterMessage("Comando de abertura de gaveta enviado.");
      await printer.disconnect();
    } catch (error) {
      setPrinterMessage(`Falha ao abrir gaveta: ${(error as Error).message}`);
    }
  }

  async function handleTestScale() {
    setScaleMessage(null);
    if (!config.scaleProtocol) {
      setScaleMessage("Selecione um protocolo de balança primeiro.");
      return;
    }
    if (!isWebSerialSupportedForScale()) {
      setScaleMessage("Este navegador não suporta Web Serial API. Use Chrome ou Edge, ou informe o peso manualmente no PDV.");
      return;
    }
    try {
      const scale = new ScaleService(config.scaleProtocol);
      await scale.connect();
      setScaleMessage("Conectado. Aguardando leitura de peso (15s)...");
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Nenhuma leitura recebida.")), 15_000);
        scale
          .streamReadings((reading) => {
            clearTimeout(timeout);
            setScaleMessage(`Peso lido: ${reading.weightKg.toFixed(3)} kg (${reading.stable ? "estável" : "instável"}).`);
            scale.disconnect().catch(() => undefined);
            resolve();
          })
          .catch(reject);
      });
    } catch (error) {
      setScaleMessage(`Falha ao conectar/ler balança: ${(error as Error).message}`);
    }
  }

  async function handleSaveTef() {
    setTefSaving(true);
    setTefMessage(null);
    try {
      const credential = await api.put<IntegrationCredentialSummary>("/integration-credentials", {
        provider: "TEF_CLISITEF",
        environment: "PRODUCTION",
        payload: { host: tefHost, port: Number(tefPort), storeCode: tefStoreCode, terminalId: tefTerminalId },
      });
      setTefCredential(credential);
      setTefMessage("Configuração do SiTef salva.");
    } catch (error) {
      setTefMessage(`Falha ao salvar: ${(error as Error).message}`);
    } finally {
      setTefSaving(false);
    }
  }

  async function handleTestTef() {
    if (!tefCredential) {
      setTefMessage("Salve a configuração antes de testar.");
      return;
    }
    setTefTesting(true);
    setTefMessage(null);
    try {
      const result = await api.post<{ success: boolean; message: string }>(`/integration-credentials/${tefCredential.id}/test`);
      setTefMessage(result.message);
    } catch (error) {
      setTefMessage(`Falha ao testar: ${(error as Error).message}`);
    } finally {
      setTefTesting(false);
    }
  }

  async function handleAddLabelPrinter() {
    setLabelPrinterMessage(null);
    if (!newPrinterName || !newPrinterHost) {
      setLabelPrinterMessage("Informe nome e host/IP da impressora.");
      return;
    }
    try {
      await api.post("/label-printers", {
        name: newPrinterName,
        connectionType: "NETWORK",
        networkHost: newPrinterHost,
        networkPort: Number(newPrinterPort) || 9100,
        labelWidthMm: 40,
        labelHeightMm: 25,
        isDefault: labelPrinters.length === 0,
      });
      setNewPrinterName("");
      setNewPrinterHost("");
      setNewPrinterPort("9100");
      reloadLabelPrinters();
      setLabelPrinterMessage("Impressora de etiqueta adicionada.");
    } catch (error) {
      setLabelPrinterMessage(`Falha ao adicionar: ${(error as Error).message}`);
    }
  }

  async function handleRemoveLabelPrinter(id: string) {
    await api.delete(`/label-printers/${id}`);
    reloadLabelPrinters();
  }

  async function handleSetDefaultLabelPrinter(id: string) {
    await api.patch(`/label-printers/${id}`, { isDefault: true });
    reloadLabelPrinters();
  }

  return (
    <Box sx={{ p: 3, maxWidth: 800, mx: "auto" }}>
      <Typography variant="h5" sx={{ mb: 1 }}>
        Hardware do PDV
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Configurações por terminal (impressora, balança e gaveta ficam salvas apenas
        neste computador/navegador — cada caixa físico tem seu próprio hardware
        ligado). A maquininha/TEF é configurada por loja (vale para todos os
        terminais).
      </Typography>

      <Paper sx={{ p: 2, mb: 3 }}>
        <Typography variant="subtitle1" sx={{ mb: 2 }}>
          Impressora térmica (ESC/POS) e gaveta de dinheiro
        </Typography>
        {!isWebSerialSupported() && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Web Serial API indisponível neste navegador (suportado apenas em Chrome/Edge/Opera). A impressão/gaveta
            automáticas não funcionarão aqui — use a entrada manual de peso e feche vendas normalmente.
          </Alert>
        )}
        <Stack spacing={2}>
          <TextField
            select
            label="Modelo da impressora"
            value={config.printerModel ?? ""}
            onChange={(e) => updateConfig({ printerModel: (e.target.value || null) as HardwareConfig["printerModel"] })}
          >
            <MenuItem value="">Nenhuma</MenuItem>
            {Object.keys(PRINTER_PROFILES).map((key) => (
              <MenuItem key={key} value={key}>
                {key.replace(/_/g, " ")}
              </MenuItem>
            ))}
          </TextField>
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" onClick={handleTestPrinter}>
              Conectar e testar impressora
            </Button>
            <Button variant="outlined" onClick={handleTestCashDrawer}>
              Testar abertura da gaveta
            </Button>
          </Stack>
          {printerMessage && <Alert severity="info">{printerMessage}</Alert>}
          <TextField
            select
            label="Abrir gaveta automaticamente ao fechar venda em dinheiro"
            value={config.openCashDrawerOnCashSale ? "yes" : "no"}
            onChange={(e) => updateConfig({ openCashDrawerOnCashSale: e.target.value === "yes" })}
          >
            <MenuItem value="yes">Sim</MenuItem>
            <MenuItem value="no">Não</MenuItem>
          </TextField>
        </Stack>
      </Paper>

      <Paper sx={{ p: 2, mb: 3 }}>
        <Typography variant="subtitle1" sx={{ mb: 2 }}>
          Balança de checkout (Toledo/Filizola)
        </Typography>
        {!isWebSerialSupportedForScale() && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Web Serial API indisponível neste navegador. O PDV ainda decodifica o peso a partir do código de barras
            EAN-13 pré-impresso (ticket da balança) — a leitura ao vivo direto da porta serial não funcionará aqui.
          </Alert>
        )}
        <Stack spacing={2}>
          <TextField
            select
            label="Protocolo da balança"
            value={config.scaleProtocol ?? ""}
            onChange={(e) => updateConfig({ scaleProtocol: (e.target.value || null) as HardwareConfig["scaleProtocol"] })}
          >
            <MenuItem value="">Nenhuma</MenuItem>
            <MenuItem value="TOLEDO_PRIX">Toledo Prix</MenuItem>
            <MenuItem value="FILIZOLA_GENERIC">Filizola (genérico)</MenuItem>
          </TextField>
          <Button variant="outlined" onClick={handleTestScale} sx={{ alignSelf: "flex-start" }}>
            Conectar e ler peso de teste
          </Button>
          {scaleMessage && <Alert severity="info">{scaleMessage}</Alert>}
        </Stack>
      </Paper>

      <Paper sx={{ p: 2, mb: 3 }}>
        <Typography variant="subtitle1" sx={{ mb: 2 }}>
          Maquininha de cartão (TEF — SiTef genérico)
        </Typography>
        <Alert severity="warning" sx={{ mb: 2 }}>
          Requer o daemon CliSiTef/SiTef (Software Express) instalado e em execução no PC do caixa do cliente final.
          Sem ele, o teste de conexão abaixo falhará honestamente — não é uma simulação.
        </Alert>
        <Stack spacing={2}>
          <TextField label="Host do daemon SiTef" value={tefHost} onChange={(e) => setTefHost(e.target.value)} />
          <TextField label="Porta" value={tefPort} onChange={(e) => setTefPort(e.target.value)} />
          <TextField label="Código da loja" value={tefStoreCode} onChange={(e) => setTefStoreCode(e.target.value)} />
          <TextField label="Número do terminal" value={tefTerminalId} onChange={(e) => setTefTerminalId(e.target.value)} />
          <Stack direction="row" spacing={1}>
            <Button variant="contained" disabled={tefSaving} onClick={handleSaveTef}>
              Salvar
            </Button>
            <Button variant="outlined" disabled={tefTesting || !tefCredential} onClick={handleTestTef}>
              Testar conexão
            </Button>
          </Stack>
          {tefMessage && <Alert severity="info">{tefMessage}</Alert>}
          {tefCredential?.lastTestedAt && (
            <Typography variant="caption" color="text.secondary">
              Último teste: {new Date(tefCredential.lastTestedAt).toLocaleString("pt-BR")} —{" "}
              {tefCredential.lastTestSuccess ? "sucesso" : "falhou"} ({tefCredential.lastTestMessage})
            </Typography>
          )}
        </Stack>
      </Paper>

      <Paper sx={{ p: 2, mb: 3 }}>
        <Typography variant="subtitle1" sx={{ mb: 2 }}>
          Impressora de etiquetas ZPL (Zebra/compatível)
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Configuração por LOJA (vale para qualquer terminal) — a etiqueta é enviada direto pela rede para a porta
          9100 da impressora. Sem impressora cadastrada, o botão "Imprimir etiqueta" do cadastro de produtos baixa o
          arquivo .zpl para impressão manual.
        </Typography>
        <Stack spacing={1} sx={{ mb: 2 }}>
          {labelPrinters.map((printer) => (
            <Stack key={printer.id} direction="row" spacing={1} alignItems="center">
              <Typography variant="body2" sx={{ flexGrow: 1 }}>
                {printer.name} — {printer.networkHost}:{printer.networkPort} {printer.isDefault ? "(padrão)" : ""}
              </Typography>
              {!printer.isDefault && (
                <Button size="small" onClick={() => handleSetDefaultLabelPrinter(printer.id)}>
                  Tornar padrão
                </Button>
              )}
              <Button size="small" color="error" onClick={() => handleRemoveLabelPrinter(printer.id)}>
                Remover
              </Button>
            </Stack>
          ))}
          {labelPrinters.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              Nenhuma impressora de etiqueta cadastrada.
            </Typography>
          )}
        </Stack>
        <Stack direction="row" spacing={1}>
          <TextField label="Nome" size="small" value={newPrinterName} onChange={(e) => setNewPrinterName(e.target.value)} />
          <TextField label="Host/IP" size="small" value={newPrinterHost} onChange={(e) => setNewPrinterHost(e.target.value)} />
          <TextField label="Porta" size="small" value={newPrinterPort} onChange={(e) => setNewPrinterPort(e.target.value)} sx={{ width: 100 }} />
          <Button variant="outlined" onClick={handleAddLabelPrinter}>
            Adicionar
          </Button>
        </Stack>
        {labelPrinterMessage && <Alert severity="info" sx={{ mt: 2 }}>{labelPrinterMessage}</Alert>}
      </Paper>

      <Divider sx={{ my: 2 }} />
      <Typography variant="caption" color="text.secondary">
        Leitor de código de barras: funciona como teclado (HID keyboard wedge) — nenhuma configuração adicional é
        necessária aqui, basta que o campo de busca do PDV esteja focado (ou o próprio leitor envie Enter).
      </Typography>
    </Box>
  );
}

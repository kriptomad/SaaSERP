// apps/web/src/modules/market/pos/PosPage.tsx
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 8.3 — tela real de PDV Offline-First.
// Lista produtos do catálogo Dexie (nunca da rede diretamente — sempre via cache
// local, para que o PDV funcione idêntico online ou offline), permite montar um
// carrinho e fechar a venda via closeSaleOffline (enfileira no Dexie + Background
// Sync), exibindo o status de sincronização da fila em tempo real.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Typography,
  Paper,
  Stack,
  TextField,
  Button,
  List,
  ListItemButton,
  ListItemText,
  Divider,
  Chip,
  Alert,
  ToggleButton,
  ToggleButtonGroup,
} from "@mui/material";
import { useLiveQuery } from "dexie-react-hooks";
import { useAuth } from "../../../auth/AuthContext";
import { offlineDb } from "../../../shared/offline/db";
import { syncProductCatalog } from "../../../shared/offline/sync-catalog";
import { syncPendingSales } from "../../../shared/offline/sync-pending-sales";
import { closeSaleOffline } from "./close-sale-offline";
import { fetchCurrentCashRegister, openCashRegister } from "../../../api/client";
import { decodeScaleBarcode } from "../../../shared/offline/scale-barcode";
import { ClientPicker } from "../../../shared/lookups";
import type { Client } from "../../registrations/api";
import { loadHardwareConfig, type HardwareConfig } from "../../../shared/hardware/hardware-config";
import { ThermalPrinterService, PRINTER_PROFILES, isWebSerialSupported } from "../../../shared/hardware/thermal-printer.service";
import { buildReceipt } from "../../../shared/hardware/receipt-layout";
import { ScaleService, SCALE_PROFILES, isWebSerialSupportedForScale } from "../../../shared/hardware/scale.service";
import { startTefTransaction, confirmTefTransaction, cancelTefTransaction } from "../../../shared/hardware/tef-client";

interface CartLine {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

type PaymentMethod = "CASH" | "DEBIT_CARD" | "CREDIT_CARD";

// Capítulo 23.3 (Hardware/Periféricos) — leitor de código de barras HID "teclado
// wedge": o próprio SO entrega os caracteres como digitação normal no campo
// focado, então nenhuma integração especial de driver é necessária. O único ajuste
// real possível no lado da aplicação é distinguir digitação humana de leitura de
// scanner pela VELOCIDADE entre teclas — leitores emitem cada caractere em poucos
// milissegundos, uma pessoa digitando leva dezenas a centenas de ms entre teclas.
// Heurística: se o intervalo médio entre as últimas teclas for menor que
// `SCANNER_MAX_INTERVAL_MS` e o buffer acumulado tiver cara de código de barras
// (só dígitos, >= 8 caracteres), tratamos como leitura de scanner e dispensamos a
// necessidade de apertar Enter manualmente (o leitor já envia Enter sozinho na
// maioria dos modelos, mas alguns não enviam — esta heurística cobre esse caso).
const SCANNER_MAX_INTERVAL_MS = 50;
const SCANNER_MIN_LENGTH = 8;

export function PosPage() {
  const { user, tenant } = useAuth();
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [client, setClient] = useState<Client | null>(null);
  const [cashRegisterId, setCashRegisterId] = useState<string | null>(null);
  const [openingAmount, setOpeningAmount] = useState("100.00");
  const [cashRegisterError, setCashRegisterError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [lastSaleMessage, setLastSaleMessage] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH");
  const [hardwareConfig] = useState<HardwareConfig>(() => loadHardwareConfig());
  const [printerConnected, setPrinterConnected] = useState(false);
  const [hardwareMessage, setHardwareMessage] = useState<string | null>(null);
  const [tefBusy, setTefBusy] = useState(false);
  const printerRef = useRef<ThermalPrinterService | null>(null);
  const scaleRef = useRef<ScaleService | null>(null);
  const keystrokeTimestampsRef = useRef<number[]>([]);
  const scannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const products = useLiveQuery(
    () =>
      offlineDb.products
        .filter(
          (p) =>
            !search ||
            p.name.toLowerCase().includes(search.toLowerCase()) ||
            p.sku.toLowerCase().includes(search.toLowerCase()) ||
            p.barcode === search,
        )
        .limit(25)
        .toArray(),
    [search],
  );

  const pendingSalesCount = useLiveQuery(
    () => offlineDb.pendingSales.where("syncStatus").anyOf("PENDING", "SYNCING", "FAILED").count(),
    [],
  );

  useEffect(() => {
    syncProductCatalog().catch((error) => setCatalogError((error as Error).message));
    syncPendingSales().catch(() => undefined);

    fetchCurrentCashRegister()
      .then((res) => setCashRegisterId(res.data?.id ?? null))
      .catch(() => setCashRegisterId(null));

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  async function handleOpenCashRegister() {
    setCashRegisterError(null);
    try {
      const amount = Number(openingAmount.replace(",", "."));
      const res = await openCashRegister(amount);
      setCashRegisterId(res.data.id);
    } catch (error) {
      setCashRegisterError((error as Error).message);
    }
  }

  const total = useMemo(() => cart.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0), [cart]);

  function addToCart(product: { id: string; name: string; unitPrice: number }, quantity = 1) {
    setCart((prev) => {
      const existing = prev.find((line) => line.productId === product.id);
      if (existing) {
        return prev.map((line) =>
          line.productId === product.id ? { ...line, quantity: line.quantity + quantity } : line,
        );
      }
      return [...prev, { productId: product.id, name: product.name, quantity, unitPrice: product.unitPrice }];
    });
  }

  // Capítulo 11.8 — Material de Construção/Ferragens: venda fracionada (ex. 2,4m de
  // tubo, 8,7m² de piso) — `SaleItem.quantity` já é Decimal no schema; o carrinho só
  // precisava de um campo editável que aceite quantidade decimal livre, não apenas
  // incrementos inteiros por clique.
  function setLineQuantity(productId: string, rawValue: string) {
    const normalized = rawValue.replace(",", ".");
    const parsed = Number(normalized);
    setCart((prev) =>
      prev.map((line) => {
        if (line.productId !== productId) return line;
        if (normalized.trim() === "" || Number.isNaN(parsed)) return { ...line, quantity: 0 };
        return { ...line, quantity: Math.max(0, parsed) };
      }),
    );
  }

  // Leitura de balança de checkout (Capítulo 4.1/20.7): o leitor serial/USB injeta o
  // EAN-13 de peso variável no mesmo campo de busca (comportamento padrão de leitores
  // configurados como teclado). Ao reconhecer o payload de peso embutido (prefixo "2"),
  // localiza o produto pesável pelo código interno de 5 dígitos e adiciona ao carrinho
  // com a quantidade já em kg — nunca confiando em um preço eventualmente embutido no
  // próprio código, sempre usando `unitPrice` do catálogo.
  async function handleScanBarcode(scanned: string) {
    const decoded = decodeScaleBarcode(scanned);
    if (!decoded) return false;
    const product = await offlineDb.products.where("barcode").equals(decoded.internalCode).first();
    if (!product || !product.isWeighted) return false;
    addToCart(product, decoded.weightKg);
    setSearch("");
    return true;
  }

  // Heurística de velocidade de digitação (Capítulo 23.3): acumula o timestamp de
  // cada tecla; se o intervalo médio recente for compatível com um leitor de código
  // de barras (não um humano digitando) e o buffer parecer um código de barras,
  // dispara a leitura automaticamente, sem exigir Enter manual.
  function handleSearchKeyStroke() {
    const now = performance.now();
    const timestamps = keystrokeTimestampsRef.current;
    timestamps.push(now);
    if (timestamps.length > 6) timestamps.shift();

    if (scannerTimerRef.current) clearTimeout(scannerTimerRef.current);
    scannerTimerRef.current = setTimeout(() => {
      const current = keystrokeTimestampsRef.current;
      if (current.length < 4) return;
      const intervals = current.slice(1).map((t, i) => t - current[i]);
      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      setSearch((value) => {
        if (avgInterval <= SCANNER_MAX_INTERVAL_MS && value.length >= SCANNER_MIN_LENGTH && /^\d+$/.test(value)) {
          handleScanBarcode(value);
        }
        return value;
      });
      keystrokeTimestampsRef.current = [];
    }, 80);
  }

  function removeFromCart(productId: string) {
    setCart((prev) => prev.filter((line) => line.productId !== productId));
  }

  // Capítulo 23.4 — conecta a impressora térmica via Web Serial API (precisa ser
  // chamado a partir de um clique, exigência da própria API). Sem Web Serial
  // (Firefox/Safari), avisa o operador sem travar o PDV: o lojista ainda consegue
  // fechar vendas, só não terá impressão/gaveta automáticas neste navegador.
  async function handlePrinterConnect() {
    setHardwareMessage(null);
    if (!hardwareConfig.printerModel) {
      setHardwareMessage("Nenhum modelo de impressora configurado. Configure em Configurações > Hardware do PDV.");
      return;
    }
    if (!isWebSerialSupported()) {
      setHardwareMessage("Este navegador não suporta Web Serial API (use Chrome/Edge). Cupom e gaveta não estarão disponíveis.");
      return;
    }
    try {
      const printer = new ThermalPrinterService(PRINTER_PROFILES[hardwareConfig.printerModel]);
      await printer.connect();
      printerRef.current = printer;
      setPrinterConnected(true);
      setHardwareMessage("Impressora conectada.");
    } catch (error) {
      setHardwareMessage(`Falha ao conectar impressora: ${(error as Error).message}`);
    }
  }

  // Capítulo 23.1 — leitura ao vivo da balança (não o código de barras pré-impresso):
  // usado quando o item é pesado diretamente no caixa, sem ticket. Conecta sob
  // demanda, lê a primeira pesagem estável e adiciona ao carrinho.
  async function handleWeighProduct(product: { id: string; name: string; unitPrice: number }) {
    setHardwareMessage(null);
    if (!hardwareConfig.scaleProtocol) {
      setHardwareMessage("Nenhuma balança configurada. Configure em Configurações > Hardware do PDV.");
      return;
    }
    if (!isWebSerialSupportedForScale()) {
      setHardwareMessage("Este navegador não suporta Web Serial API (use Chrome/Edge) — informe o peso manualmente.");
      return;
    }
    try {
      const scale = scaleRef.current ?? new ScaleService(hardwareConfig.scaleProtocol);
      if (!scale.isConnected) await scale.connect();
      scaleRef.current = scale;
      setHardwareMessage("Aguardando peso estável na balança…");
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Nenhuma leitura estável recebida em 15s.")), 15_000);
        scale
          .streamReadings((reading) => {
            if (reading.stable) {
              clearTimeout(timeout);
              addToCart(product, reading.weightKg);
              setHardwareMessage(`Peso lido: ${reading.weightKg.toFixed(3)} kg.`);
              scale.disconnect().catch(() => undefined);
              resolve();
            }
          })
          .catch(reject);
      });
    } catch (error) {
      setHardwareMessage(`Falha ao ler balança: ${(error as Error).message}`);
    }
  }

  async function printSaleReceipt(localId: string, totalAmount: number) {
    if (!hardwareConfig.printerModel || !printerRef.current?.isConnected) return;
    try {
      const builder = buildReceipt(
        {
          // Dados reais do tenant (Capítulo 21.7) — vêm da sessão autenticada
          // (login/signup já devolvem `tradeName`/`cnpj` reais do banco), nunca de
          // placeholder: o cupom impresso aqui é o "cupom não fiscal" (documento
          // fiscal real só existe após o sync+emissão síncrona via fila
          // `fiscal-emission`, ver `SalesHistoryPage`/`reimprimirCupomFiscal`).
          tenantTradeName: tenant?.tradeName ?? "Loja",
          tenantDocument: tenant?.cnpj ?? "",
          saleId: localId,
          closedAt: new Date(),
          items: cart.map((line) => ({
            description: line.name,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            totalPrice: line.quantity * line.unitPrice,
          })),
          totalAmount,
          paymentMethod,
          totalTaxesApprox: null,
          fiscalAccessKey: null,
          fiscalProtocolNumber: null,
          fiscalDocumentType: null,
        },
        PRINTER_PROFILES[hardwareConfig.printerModel].columns,
      );
      await printerRef.current.printReceipt(builder);
    } catch (error) {
      setHardwareMessage(`Falha ao imprimir cupom: ${(error as Error).message}`);
    }
  }

  async function handleCloseSale() {
    if (!user || cart.length === 0 || !cashRegisterId) return;

    let tefSessionId: string | null = null;
    let tefNsu: string | null = null;
    // Capítulo 23.5 — pagamento em cartão passa pelo TEF (SiTef) ANTES de fechar a
    // venda: só gravamos a venda como paga por cartão se a adquirente de fato aprovou.
    if (paymentMethod === "DEBIT_CARD" || paymentMethod === "CREDIT_CARD") {
      setTefBusy(true);
      setHardwareMessage("Enviando transação para a maquininha (TEF)…");
      try {
        const saleReference = `pdv-${Date.now()}`;
        const result = await startTefTransaction({
          amountCents: Math.round(total * 100),
          transactionType: paymentMethod === "CREDIT_CARD" ? "CREDIT" : "DEBIT",
          saleReference,
        });
        if (result.status !== "APPROVED") {
          setHardwareMessage(
            result.status === "AWAITING_CONTINUATION"
              ? "A maquininha pediu uma confirmação adicional não suportada neste fluxo simplificado — cancele e tente novamente."
              : `Transação recusada: ${result.rejectionReason ?? "motivo não informado."}`,
          );
          setTefBusy(false);
          return;
        }
        tefSessionId = result.sessionId;
        tefNsu = result.nsu;
      } catch (error) {
        setHardwareMessage(`Falha ao comunicar com o TEF: ${(error as Error).message}`);
        setTefBusy(false);
        return;
      }
      setTefBusy(false);
    }

    const result = await closeSaleOffline({
      cashRegisterId,
      cashierId: user.id,
      clientId: client?.id,
      items: cart.map((line) => ({ productId: line.productId, quantity: line.quantity, unitPrice: line.unitPrice })),
      paymentMethod,
    }).catch(async (error) => {
      // A adquirente já aprovou o débito no cartão do cliente, mas o ERP falhou ao
      // registrar a venda localmente — sem estornar agora, o cliente seria cobrado
      // sem nenhum registro de venda correspondente.
      if (tefSessionId) {
        await cancelTefTransaction(tefSessionId, tefNsu ?? "N/A", "Falha ao registrar a venda no ERP após aprovação do TEF").catch(() => undefined);
      }
      throw error;
    });

    if (tefSessionId) {
      // Confirma a transação junto à adquirente só depois que o ERP já registrou a
      // venda com sucesso — se a confirmação falhar, o cupom já existe e o lojista
      // decide manualmente (mesmo princípio de "nunca travar o fechamento de caixa
      // por indisponibilidade de rede" do Capítulo 8.3).
      confirmTefTransaction(tefSessionId).catch((error) =>
        setHardwareMessage(`Venda registrada, mas falha ao confirmar o TEF: ${(error as Error).message}`),
      );
    }

    if (paymentMethod === "CASH" && hardwareConfig.openCashDrawerOnCashSale && printerRef.current?.isConnected) {
      printerRef.current.openCashDrawer().catch((error) => setHardwareMessage(`Falha ao abrir gaveta: ${(error as Error).message}`));
    }
    await printSaleReceipt(result.localId, result.totalAmount);

    setLastSaleMessage(
      `Venda registrada localmente (${result.localId.slice(0, 8)}…). Total: R$ ${result.totalAmount.toFixed(2)}. ` +
        (isOnline ? "Sincronizando…" : "Será sincronizada quando a conexão voltar."),
    );
    setCart([]);
    setClient(null);
  }

  return (
    <Box sx={{ p: 3, maxWidth: 960, mx: "auto" }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h5">PDV — Ponto de Venda</Typography>
        <Stack direction="row" spacing={1} alignItems="center">
          <Chip
            size="small"
            label={isOnline ? "Online" : "Offline"}
            color={isOnline ? "success" : "warning"}
          />
          {Boolean(pendingSalesCount) && (
            <Chip size="small" label={`${pendingSalesCount} venda(s) pendente(s) de sync`} color="info" />
          )}
        </Stack>
      </Stack>

      {catalogError && <Alert severity="warning" sx={{ mb: 2 }}>Catálogo não sincronizado: {catalogError}</Alert>}
      {lastSaleMessage && <Alert severity="success" sx={{ mb: 2 }}>{lastSaleMessage}</Alert>}
      {hardwareMessage && <Alert severity="info" sx={{ mb: 2 }}>{hardwareMessage}</Alert>}

      <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
        <Button size="small" variant={printerConnected ? "outlined" : "contained"} onClick={handlePrinterConnect}>
          {printerConnected ? "Impressora conectada" : "Conectar impressora"}
        </Button>
      </Stack>

      <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
        <Paper sx={{ p: 2, flex: 1 }}>
          <TextField
            fullWidth
            label="Buscar por nome, SKU ou código de barras"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              handleSearchKeyStroke();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleScanBarcode(search);
            }}
            sx={{ mb: 2 }}
          />
          <List dense>
            {(products ?? []).map((product) => (
              <Stack key={product.id} direction="row" alignItems="center">
                <ListItemButton sx={{ flex: 1 }} onClick={() => addToCart(product)}>
                  <ListItemText
                    primary={product.name}
                    secondary={`SKU ${product.sku} · R$ ${product.unitPrice.toFixed(2)} · estoque local: ${product.stockQuantitySnapshot}`}
                  />
                </ListItemButton>
                {product.isWeighted && (
                  <Button size="small" onClick={() => handleWeighProduct(product)}>
                    Pesar
                  </Button>
                )}
              </Stack>
            ))}
            {products?.length === 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
                Nenhum produto encontrado no catálogo local.
              </Typography>
            )}
          </List>
        </Paper>

        <Paper sx={{ p: 2, flex: 1 }}>
          <Typography variant="subtitle1" sx={{ mb: 1 }}>
            Carrinho
          </Typography>
          {cashRegisterId ? (
            <Alert severity="success" sx={{ mb: 2 }}>
              Caixa aberto ({cashRegisterId.slice(0, 8)}…)
            </Alert>
          ) : (
            <Stack spacing={1} sx={{ mb: 2 }}>
              <Alert severity="warning">Nenhum caixa aberto. Abra um caixa para iniciar as vendas.</Alert>
              {cashRegisterError && <Alert severity="error">{cashRegisterError}</Alert>}
              <TextField
                size="small"
                label="Fundo de troco inicial (R$)"
                value={openingAmount}
                onChange={(e) => setOpeningAmount(e.target.value)}
              />
              <Button variant="outlined" onClick={handleOpenCashRegister}>
                Abrir Caixa
              </Button>
            </Stack>
          )}
          <List dense>
            {cart.map((line) => (
              <Stack key={line.productId} direction="row" alignItems="center" spacing={1} sx={{ py: 0.5 }}>
                <ListItemText
                  sx={{ flex: 1 }}
                  primary={line.name}
                  secondary={`R$ ${(line.quantity * line.unitPrice).toFixed(2)}`}
                />
                <TextField
                  size="small"
                  type="number"
                  inputProps={{ step: "0.01", min: 0 }}
                  value={line.quantity}
                  onChange={(e) => setLineQuantity(line.productId, e.target.value)}
                  sx={{ width: 96 }}
                  label="Qtd."
                />
                <Button size="small" color="error" onClick={() => removeFromCart(line.productId)}>
                  Remover
                </Button>
              </Stack>
            ))}
          </List>
          <Divider sx={{ my: 2 }} />
          {/* Capítulo 4.1.1 — CRM/fidelidade: identificar o cliente (CPF na nota)
              credita pontos automaticamente ao fechar a venda. Busca em tempo real na
              API, por isso só funciona online — offline a venda segue sem cliente. */}
          {isOnline ? (
            <Box sx={{ mb: 2 }}>
              <ClientPicker value={client} onChange={setClient} label="Cliente (CPF na nota — opcional)" />
            </Box>
          ) : (
            <Alert severity="info" sx={{ mb: 2 }}>
              Identificação de cliente para fidelidade exige conexão — venda seguirá sem pontos.
            </Alert>
          )}
          <Typography variant="h6">Total: R$ {total.toFixed(2)}</Typography>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={paymentMethod}
            onChange={(_e, value) => value && setPaymentMethod(value)}
            sx={{ mt: 1, mb: 1 }}
          >
            <ToggleButton value="CASH">Dinheiro</ToggleButton>
            <ToggleButton value="DEBIT_CARD">Débito (TEF)</ToggleButton>
            <ToggleButton value="CREDIT_CARD">Crédito (TEF)</ToggleButton>
          </ToggleButtonGroup>
          <Button
            variant="contained"
            fullWidth
            sx={{ mt: 1 }}
            disabled={cart.length === 0 || !cashRegisterId || tefBusy}
            onClick={handleCloseSale}
          >
            {tefBusy ? "Processando cartão…" : "Fechar Venda"}
          </Button>
        </Paper>
      </Stack>
    </Box>
  );
}

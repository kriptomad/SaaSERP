// apps/web/src/modules/public-store/PublicStorePage.tsx
// Capítulo 8.5 — Vitrine Virtual/Loja Online. Página PÚBLICA (sem AppShell/
// autenticação), acessível em /loja/:customSlug. Fluxo: catálogo -> carrinho ->
// dados do cliente -> confirmar pedido. Nunca baixa estoque nem gera venda
// diretamente — cria um `OnlineOrder` pendente de confirmação do lojista (ver
// comentário em apps/api/src/modules/online-store/public-online-store.routes.ts).
import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Container,
  Divider,
  FormControlLabel,
  IconButton,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import RemoveIcon from "@mui/icons-material/Remove";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCart";
import { publicStoreApi, type PublicStoreProduct } from "./api";
import { errorMessage } from "../../shared/ui/PageLayout";
import { money } from "../../shared/ui/format";

export function PublicStorePage() {
  const { customSlug = "" } = useParams<{ customSlug: string }>();
  const store = useQuery({ queryKey: ["public-store", customSlug], queryFn: () => publicStoreApi.store(customSlug) });
  const products = useQuery({ queryKey: ["public-store-products", customSlug], queryFn: () => publicStoreApi.products(customSlug) });

  const [cart, setCart] = useState<Record<string, number>>({});
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [isDelivery, setIsDelivery] = useState(false);
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const productsById = useMemo(() => new Map((products.data ?? []).map((p) => [p.id, p])), [products.data]);

  const itemsTotal = useMemo(
    () => Object.entries(cart).reduce((sum, [id, quantity]) => sum + Number(productsById.get(id)?.unitPrice ?? 0) * quantity, 0),
    [cart, productsById],
  );

  const createOrder = useMutation({
    mutationFn: () =>
      publicStoreApi.createOrder(customSlug, {
        customerName,
        customerPhone,
        isDelivery,
        deliveryAddress: isDelivery ? deliveryAddress : undefined,
        items: Object.entries(cart).map(([productId, quantity]) => ({ productId, quantity })),
      }),
    onSuccess: (order) => setConfirmed(order.id),
    onError: (err) => setFormError(errorMessage(err)),
  });

  function addToCart(product: PublicStoreProduct) {
    setCart((prev) => ({ ...prev, [product.id]: (prev[product.id] ?? 0) + 1 }));
  }
  function removeFromCart(product: PublicStoreProduct) {
    setCart((prev) => {
      const next = { ...prev };
      const qty = (next[product.id] ?? 0) - 1;
      if (qty <= 0) delete next[product.id];
      else next[product.id] = qty;
      return next;
    });
  }

  if (store.isPending || products.isPending) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 6 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (store.isError || !store.data) {
    return (
      <Container maxWidth="sm" sx={{ py: 6 }}>
        <Alert severity="error">Loja não encontrada ou indisponível no momento.</Alert>
      </Container>
    );
  }

  const info = store.data;

  if (confirmed) {
    return (
      <Container maxWidth="sm" sx={{ py: 6 }}>
        <Alert severity="success">
          Pedido #{confirmed.slice(0, 8)} enviado com sucesso! A loja entrará em contato para confirmar.
        </Alert>
      </Container>
    );
  }

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 3 }}>
        {info.logoUrl && <Avatar src={info.logoUrl} sx={{ width: 56, height: 56 }} />}
        <Typography variant="h4" sx={{ color: info.primaryColorHex }}>
          {info.tenantName}
        </Typography>
      </Stack>

      <Stack spacing={2} sx={{ mb: 4 }}>
        {(products.data ?? []).length === 0 && <Alert severity="info">Nenhum produto disponível na loja no momento.</Alert>}
        {(products.data ?? []).map((product) => (
          <Card key={product.id} variant="outlined">
            <CardContent sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Box>
                <Typography variant="subtitle1">{product.name}</Typography>
                {product.description && (
                  <Typography variant="body2" color="text.secondary">
                    {product.description}
                  </Typography>
                )}
                <Typography variant="body1" fontWeight={600}>
                  {money(product.unitPrice)}
                </Typography>
              </Box>
              <Stack direction="row" spacing={1} alignItems="center">
                <IconButton size="small" disabled={!cart[product.id]} onClick={() => removeFromCart(product)}>
                  <RemoveIcon fontSize="small" />
                </IconButton>
                <Typography>{cart[product.id] ?? 0}</Typography>
                <IconButton size="small" onClick={() => addToCart(product)}>
                  <AddIcon fontSize="small" />
                </IconButton>
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Stack>

      {Object.keys(cart).length > 0 && (
        <Card variant="outlined" sx={{ mb: 4 }}>
          <CardContent>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
              <ShoppingCartIcon color="primary" />
              <Typography variant="h6">Finalizar pedido</Typography>
            </Stack>
            <Stack spacing={2}>
              <TextField label="Seu nome" value={customerName} onChange={(e) => setCustomerName(e.target.value)} required />
              <TextField label="Telefone/WhatsApp" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} required />
              {info.deliveryEnabled && (
                <FormControlLabel
                  control={<Switch checked={isDelivery} onChange={(e) => setIsDelivery(e.target.checked)} />}
                  label={`Entrega${info.deliveryFee ? ` (+ ${money(info.deliveryFee)})` : ""}`}
                />
              )}
              {isDelivery && (
                <TextField
                  label="Endereço de entrega"
                  value={deliveryAddress}
                  onChange={(e) => setDeliveryAddress(e.target.value)}
                  required
                  multiline
                />
              )}
              <Divider />
              <Typography variant="subtitle1">
                Total dos itens: {money(itemsTotal)}
                {info.minOrderAmount && itemsTotal < Number(info.minOrderAmount) && (
                  <Typography component="span" color="error" sx={{ ml: 1 }}>
                    (pedido mínimo: {money(info.minOrderAmount)})
                  </Typography>
                )}
              </Typography>
              {formError && <Alert severity="error">{formError}</Alert>}
              <Button
                variant="contained"
                size="large"
                disabled={
                  !customerName ||
                  !customerPhone ||
                  (isDelivery && !deliveryAddress) ||
                  (Boolean(info.minOrderAmount) && itemsTotal < Number(info.minOrderAmount)) ||
                  createOrder.isPending
                }
                onClick={() => createOrder.mutate()}
              >
                Enviar pedido
              </Button>
            </Stack>
          </CardContent>
        </Card>
      )}
    </Container>
  );
}

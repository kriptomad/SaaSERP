// apps/web/src/modules/recipes/RecipesPage.tsx
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 4.4 (Padaria/Confeitaria) — Ficha
// Técnica avançada: cadastro de rendimento (`yieldQuantity`) e proporção de
// insumos (`RecipeItem.quantityPerYield`), com o CMV do produto final (`costPrice`)
// recalculado automaticamente no backend sempre que o custo de um insumo muda
// (recalculate-recipe-cost.service.ts). Esta tela nunca existia até aqui — era o
// maior gap de usabilidade do nicho.
import { useEffect, useState } from "react";
import { Alert, Box, Button, IconButton, Paper, Stack, TextField, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { recipesApi, type Recipe } from "./api";
import { productsApi, type ProductListItem } from "../registrations/api";
import { Page, PageHeader, errorMessage } from "../../shared/ui/PageLayout";
import { ProductPicker } from "../../shared/lookups";
import { useToast } from "../../shared/ui/Toast";
import { money, parseDecimal } from "../../shared/ui/format";
import { ApiError } from "../../api/client";

let itemSeq = 0;
interface ItemRow {
  key: number;
  ingredientId: string | null;
  quantityPerYield: string;
}
const newItemRow = (partial: Partial<ItemRow> = {}): ItemRow => ({ key: ++itemSeq, ingredientId: null, quantityPerYield: "", ...partial });

export function RecipesPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [product, setProduct] = useState<ProductListItem | null>(null);
  const [yieldQuantity, setYieldQuantity] = useState("");
  const [items, setItems] = useState<ItemRow[]>([newItemRow()]);

  const productDetailQuery = useQuery({
    queryKey: ["product-detail", product?.id],
    queryFn: () => productsApi.get(product!.id),
    enabled: product !== null,
  });

  const recipeQuery = useQuery({
    queryKey: ["recipe", product?.id],
    queryFn: () => recipesApi.getByProduct(product!.id),
    enabled: product !== null,
    retry: false,
  });

  const recipeNotFound = recipeQuery.isError && recipeQuery.error instanceof ApiError && recipeQuery.error.status === 404;

  useEffect(() => {
    if (recipeQuery.data) {
      const recipe: Recipe = recipeQuery.data;
      setYieldQuantity(recipe.yieldQuantity);
      setItems(
        recipe.items.length > 0
          ? recipe.items.map((item) =>
              newItemRow({
                ingredientId: item.ingredientId,
                quantityPerYield: item.quantityPerYield,
              }),
            )
          : [newItemRow()],
      );
    } else if (recipeNotFound) {
      setYieldQuantity("");
      setItems([newItemRow()]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipeQuery.data, recipeNotFound, product?.id]);

  const mutation = useMutation({
    mutationFn: () => {
      const yieldQty = parseDecimal(yieldQuantity);
      if (!product) throw new Error("Selecione um produto final.");
      if (!yieldQty || yieldQty <= 0) throw new Error("Informe um rendimento válido.");
      const parsedItems = items
        .filter((i) => i.ingredientId)
        .map((i) => {
          const q = parseDecimal(i.quantityPerYield);
          if (!q || q <= 0) throw new Error("Informe a quantidade por rendimento de cada insumo.");
          return { ingredientId: i.ingredientId!, quantityPerYield: q };
        });
      if (parsedItems.length === 0) throw new Error("Adicione ao menos um insumo.");
      return recipesApi.upsert(product.id, { yieldQuantity: yieldQty, items: parsedItems });
    },
    onSuccess: () => {
      toast.success("Ficha técnica salva. O CMV do produto final foi recalculado.");
      void queryClient.invalidateQueries({ queryKey: ["recipe", product?.id] });
      void queryClient.invalidateQueries({ queryKey: ["product-detail", product?.id] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const updateItem = (key: number, patch: Partial<ItemRow>) => setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  const removeItem = (key: number) => setItems((prev) => (prev.length > 1 ? prev.filter((i) => i.key !== key) : prev));

  return (
    <Page>
      <PageHeader title="Fichas técnicas" subtitle="Cadastre o rendimento e os insumos de cada produto fabricado (padaria/confeitaria)." />
      <Paper sx={{ p: 2, mb: 2 }}>
        <ProductPicker value={product?.id ?? null} onChange={setProduct} label="Produto final (acabado)" />
      </Paper>

      {product && (
        <Paper sx={{ p: 2 }}>
          {productDetailQuery.data && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Custo atual do produto final (CMV): <strong>{productDetailQuery.data.costPrice ? money(productDetailQuery.data.costPrice) : "não calculado"}</strong>
              {" — "}recalculado automaticamente quando o custo de um insumo muda.
            </Alert>
          )}

          {recipeQuery.isError && !recipeNotFound && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage(recipeQuery.error)}</Alert>}
          {recipeNotFound && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              Este produto ainda não tem ficha técnica. Preencha os campos abaixo para criar.
            </Alert>
          )}

          <TextField
            label="Rendimento (yieldQuantity)"
            helperText="Quantas unidades do produto final esta ficha produz (ex.: 1 ficha = 20 pães)."
            value={yieldQuantity}
            onChange={(e) => setYieldQuantity(e.target.value)}
            sx={{ mb: 2, maxWidth: 320 }}
          />

          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Insumos
          </Typography>
          <Stack spacing={1}>
            {items.map((item) => (
              <Stack key={item.key} direction="row" spacing={1} alignItems="center">
                <Box sx={{ flex: 1 }}>
                  <ProductPicker
                    value={item.ingredientId}
                    onChange={(p) => updateItem(item.key, { ingredientId: p?.id ?? null })}
                    label="Insumo"
                  />
                </Box>
                <TextField
                  label="Qtd. por rendimento"
                  value={item.quantityPerYield}
                  onChange={(e) => updateItem(item.key, { quantityPerYield: e.target.value })}
                  sx={{ width: 200 }}
                />
                <IconButton aria-label="Remover insumo" onClick={() => removeItem(item.key)} disabled={items.length === 1}>
                  <DeleteIcon />
                </IconButton>
              </Stack>
            ))}
          </Stack>

          <Button startIcon={<AddIcon />} onClick={() => setItems((prev) => [...prev, newItemRow()])} sx={{ mt: 1 }}>
            Adicionar insumo
          </Button>

          <Box sx={{ mt: 3, display: "flex", justifyContent: "flex-end" }}>
            <Button variant="contained" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
              Salvar ficha técnica
            </Button>
          </Box>
        </Paper>
      )}
    </Page>
  );
}

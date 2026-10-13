// apps/web/src/shared/lookups.tsx
// Seletores reutilizáveis alimentados pela API real (clientes, produtos, fornecedores, usuários).
import { useState } from "react";
import { Autocomplete, TextField } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { api, fetchMe } from "../api/client";
import { clientsApi, productsApi, suppliersApi, type Client, type ProductListItem, type Supplier } from "../modules/registrations/api";
import { useDebounced } from "./ui/useDebounced";

export function useProductsLookup() {
  return useQuery<ProductListItem[]>({ queryKey: ["products"], queryFn: productsApi.list });
}

export function useSuppliersLookup() {
  return useQuery<Supplier[]>({ queryKey: ["suppliers", ""], queryFn: () => suppliersApi.list() });
}

export interface Professional {
  id: string;
  name: string;
}

// /users exige permissão de gestão de usuários; sem ela, cai para o próprio usuário logado (/me).
export function useProfessionals() {
  return useQuery<Professional[]>({
    queryKey: ["professionals"],
    queryFn: async () => {
      try {
        const data = await api.get<{ users: Array<Professional & { active: boolean }> }>("/users");
        return data.users.filter((u) => u.active).map((u) => ({ id: u.id, name: u.name }));
      } catch {
        const me = await fetchMe();
        return [{ id: me.session.userId, name: "Eu (usuário logado)" }];
      }
    },
    staleTime: 60_000,
  });
}

export function ClientPicker({
  value,
  onChange,
  label = "Cliente",
  required,
}: {
  value: Client | null;
  onChange: (client: Client | null) => void;
  label?: string;
  required?: boolean;
}) {
  const [input, setInput] = useState("");
  const debounced = useDebounced(input.trim());
  const query = useQuery<Client[]>({ queryKey: ["clients", debounced], queryFn: () => clientsApi.list(debounced || undefined) });

  return (
    <Autocomplete
      options={query.data ?? []}
      value={value}
      loading={query.isFetching}
      getOptionLabel={(c) => (c.document ? `${c.name} — ${c.document}` : c.name)}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      filterOptions={(options) => options}
      onInputChange={(_, text, reason) => reason === "input" && setInput(text)}
      onChange={(_, next) => onChange(next)}
      noOptionsText="Nenhum cliente encontrado"
      loadingText="Buscando…"
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          required={required}
          error={query.isError}
          helperText={query.isError ? (query.error as Error).message : undefined}
        />
      )}
    />
  );
}

export function SupplierPicker({
  value,
  onChange,
  label = "Fornecedor",
  required,
}: {
  value: string | null;
  onChange: (supplierId: string | null) => void;
  label?: string;
  required?: boolean;
}) {
  const query = useSuppliersLookup();
  const options = query.data ?? [];
  return (
    <Autocomplete
      options={options}
      value={options.find((s) => s.id === value) ?? null}
      loading={query.isPending}
      getOptionLabel={(s) => s.name}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      onChange={(_, next) => onChange(next?.id ?? null)}
      noOptionsText="Nenhum fornecedor cadastrado"
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          required={required}
          error={query.isError}
          helperText={query.isError ? (query.error as Error).message : undefined}
        />
      )}
    />
  );
}

export function ProductPicker({
  value,
  onChange,
  label = "Produto",
  required,
}: {
  value: string | null;
  onChange: (product: ProductListItem | null) => void;
  label?: string;
  required?: boolean;
}) {
  const query = useProductsLookup();
  const options = query.data ?? [];
  return (
    <Autocomplete
      options={options}
      value={options.find((p) => p.id === value) ?? null}
      loading={query.isPending}
      getOptionLabel={(p) => `${p.name} (${p.sku})`}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      onChange={(_, next) => onChange(next)}
      noOptionsText="Nenhum produto encontrado"
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          required={required}
          error={query.isError}
          helperText={query.isError ? (query.error as Error).message : undefined}
        />
      )}
    />
  );
}

// apps/web/src/shared/CommandPalette.tsx
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 8.3 — busca global (Ctrl+K/Cmd+K).
// GAP DE AUDITORIA ENCONTRADO E CORRIGIDO: nenhum componente de busca global
// existia. Combina, no mesmo Dialog: (1) navegação estática (NAV_GROUPS,
// filtrado pelos mesmos critérios de módulo/role/tenantType do AppShell — nunca
// mostra um item que o usuário não teria no menu lateral) + (2) busca de
// entidades via GET /search (debounce 300ms, cancela requisição anterior com
// AbortController para nunca aplicar uma resposta desatualizada).
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  List,
  ListItemButton,
  ListItemText,
  TextField,
  Typography,
  Box,
  CircularProgress,
} from "@mui/material";
import { api } from "../api/client";
import type { NavGroup } from "../layout/navigation";

interface SearchResultItem {
  type: "PRODUCT" | "CLIENT" | "WORK_ORDER" | "SUPPLIER";
  id: string;
  label: string;
  subtitle: string;
  route: string;
}

const TYPE_LABEL: Record<SearchResultItem["type"], string> = {
  PRODUCT: "Produto",
  CLIENT: "Cliente",
  WORK_ORDER: "Ordem de Serviço",
  SUPPLIER: "Fornecedor",
};

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  navGroups: NavGroup[];
}

export function CommandPalette({ open, onClose, navGroups }: CommandPaletteProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [entityResults, setEntityResults] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!open) {
      setQuery("");
      setEntityResults([]);
    }
  }, [open]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setEntityResults([]);
      return;
    }
    debounceRef.current = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      api
        .get<SearchResultItem[]>("/search", { q: query.trim() })
        .then((results) => {
          if (!controller.signal.aborted) setEntityResults(results);
        })
        .catch(() => {
          if (!controller.signal.aborted) setEntityResults([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const navMatches = navGroups
    .flatMap((group) => group.items.map((item) => ({ group: group.label, ...item })))
    .filter((item) => query.trim().length > 0 && item.label.toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, 8);

  function goTo(route: string) {
    onClose();
    navigate(route);
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth PaperProps={{ sx: { mt: -20 } }}>
      <Box sx={{ p: 2 }}>
        <TextField
          autoFocus
          fullWidth
          placeholder="Buscar produtos, clientes, O.S., telas... (Ctrl+K)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          InputProps={{ endAdornment: loading ? <CircularProgress size={18} /> : undefined }}
        />
      </Box>
      <List dense sx={{ maxHeight: 420, overflowY: "auto" }}>
        {navMatches.length > 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ px: 2 }}>
            Telas
          </Typography>
        )}
        {navMatches.map((item) => (
          <ListItemButton key={item.id} onClick={() => goTo(item.path)}>
            <ListItemText primary={item.label} secondary={item.group} />
          </ListItemButton>
        ))}
        {entityResults.length > 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ px: 2 }}>
            Resultados
          </Typography>
        )}
        {entityResults.map((result) => (
          <ListItemButton key={`${result.type}-${result.id}`} onClick={() => goTo(result.route)}>
            <ListItemText primary={result.label} secondary={`${TYPE_LABEL[result.type]} — ${result.subtitle}`} />
          </ListItemButton>
        ))}
        {query.trim().length >= 2 && !loading && navMatches.length === 0 && entityResults.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 2 }}>
            Nenhum resultado para "{query}".
          </Typography>
        )}
      </List>
    </Dialog>
  );
}

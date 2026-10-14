// apps/web/src/modules/platform-admin/PlatformAdminAuthContext.tsx
// Contexto de sessão do painel de administração de plataforma — espelha
// `auth/AuthContext.tsx` (tenant), mas com estado e storage key inteiramente
// separados (Capítulo 14.2: nunca confundir sessão de tenant com sessão de
// administrador da plataforma).
import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { getStoredPlatformAdminToken, setStoredPlatformAdminToken } from "./platform-admin-client";

export interface PlatformAdminSessionAdmin {
  id: string;
  name: string;
  email: string;
  role: "SUPER_ADMIN" | "SUPPORT_AGENT" | "FINANCE_ANALYST";
}

interface PlatformAdminAuthState {
  token: string | null;
  admin: PlatformAdminSessionAdmin | null;
}

interface PlatformAdminAuthContextValue extends PlatformAdminAuthState {
  isAuthenticated: boolean;
  setSession: (token: string, admin: PlatformAdminSessionAdmin) => void;
  clearSession: () => void;
}

const PlatformAdminAuthContext = createContext<PlatformAdminAuthContextValue | undefined>(undefined);

export function PlatformAdminAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PlatformAdminAuthState>({
    token: getStoredPlatformAdminToken(),
    admin: null,
  });

  const setSession = useCallback((token: string, admin: PlatformAdminSessionAdmin) => {
    setStoredPlatformAdminToken(token);
    setState({ token, admin });
  }, []);

  const clearSession = useCallback(() => {
    setStoredPlatformAdminToken(null);
    setState({ token: null, admin: null });
  }, []);

  return (
    <PlatformAdminAuthContext.Provider value={{ ...state, isAuthenticated: Boolean(state.token), setSession, clearSession }}>
      {children}
    </PlatformAdminAuthContext.Provider>
  );
}

export function usePlatformAdminAuth(): PlatformAdminAuthContextValue {
  const ctx = useContext(PlatformAdminAuthContext);
  if (!ctx) {
    throw new Error("usePlatformAdminAuth deve ser usado dentro de um PlatformAdminAuthProvider.");
  }
  return ctx;
}

// apps/web/src/auth/AuthContext.tsx
// Contexto real de sessão do frontend: guarda token + dados de tenant/user vindos do
// login/signup real da API (Capítulo 3.5/7.1), nunca estado mockado.
import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { AuthResponse, getStoredToken, setStoredToken } from "../api/client";

interface AuthState {
  token: string | null;
  tenant: AuthResponse["tenant"] | null;
  user: AuthResponse["user"] | null;
}

interface AuthContextValue extends AuthState {
  isAuthenticated: boolean;
  setSession: (response: AuthResponse) => void;
  clearSession: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    token: getStoredToken(),
    tenant: null,
    user: null,
  });

  const setSession = useCallback((response: AuthResponse) => {
    setStoredToken(response.token);
    setState({ token: response.token, tenant: response.tenant, user: response.user });
  }, []);

  const clearSession = useCallback(() => {
    setStoredToken(null);
    setState({ token: null, tenant: null, user: null });
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, isAuthenticated: Boolean(state.token), setSession, clearSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth deve ser usado dentro de um AuthProvider.");
  }
  return ctx;
}

// apps/web/src/shared/ui/ErrorBoundary.tsx
// Fonte: fa-w4-obs-no-frontend-error-boundary — nenhum Error Boundary de topo
// existia; um erro de render em qualquer componente desmontava a árvore inteira do
// React e deixava o usuário com uma tela branca sem nenhum feedback. React exige que
// Error Boundaries sejam componentes de classe (não há equivalente em hooks ainda).
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Sentry, isSentryEnabled } from "../../lib/sentry";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // fa-w4-obs-no-error-tracking-apm — reporta ao Sentry quando configurado (ver
    // lib/sentry.ts); se `VITE_SENTRY_DSN` não estiver definido, `isSentryEnabled()`
    // é false e caímos no fallback de `console.error`, garantindo que o erro nunca
    // seja silenciado mesmo sem APM configurado.
    if (isSentryEnabled()) {
      Sentry.captureException(error, { extra: { componentStack: errorInfo.componentStack } });
    } else {
      // eslint-disable-next-line no-console
      console.error("[ErrorBoundary] erro não tratado na árvore de renderização:", error, errorInfo);
    }
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "100vh",
            padding: "2rem",
            textAlign: "center",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <h1 style={{ fontSize: "1.25rem", marginBottom: "0.75rem" }}>Algo deu errado.</h1>
          <p style={{ marginBottom: "1.5rem", color: "#555" }}>Por favor recarregue a página.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              padding: "0.6rem 1.25rem",
              borderRadius: "6px",
              border: "none",
              background: "#1d4ed8",
              color: "#fff",
              fontSize: "1rem",
              cursor: "pointer",
            }}
          >
            Recarregar página
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

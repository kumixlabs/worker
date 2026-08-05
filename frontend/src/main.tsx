import { Component, type ReactNode, StrictMode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import ReactDOM from "react-dom/client";

import { Providers as SharedProviders } from "@/components/Providers";
import { queryClient } from "@/lib/api";
import { App } from "./app";

import "./styles.css";

class RootErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: unknown) {
    if (import.meta.env.DEV) console.error("[kumix-worker] Uncaught render error:", error);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background px-4">
          <div className="max-w-md text-center">
            <h1 className="font-semibold text-xl">Something went wrong</h1>
            <p className="mt-2 text-muted-foreground text-sm">
              The dashboard encountered an unexpected error.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-6 rounded-md bg-primary px-4 py-2 text-primary-foreground text-sm"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <SharedProviders>
          <App />
        </SharedProviders>
        {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
      </QueryClientProvider>
    </RootErrorBoundary>
  </StrictMode>,
);

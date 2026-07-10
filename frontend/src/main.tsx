import { StrictMode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import ReactDOM from "react-dom/client";

import { Providers as SharedProviders } from "@/components/Providers";
import { queryClient } from "@/lib/api";
import { App } from "./app";

import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SharedProviders>
        <App />
      </SharedProviders>
    </QueryClientProvider>
  </StrictMode>,
);

import { resolve } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "../public",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
      },
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react/") || id.includes("node_modules/react-dom"))
            return "react";
          if (id.includes("node_modules/@tanstack")) return "router";
          if (id.includes("node_modules/lucide-react")) return "icons";
          if (
            id.includes("node_modules/framer-motion") ||
            id.includes("node_modules/@kumix/ui/dist/components/motion") ||
            id.includes("node_modules/@kumix/ui/dist/components/custom")
          )
            return "motion";
          if (id.includes("node_modules/@kumix") || id.includes("node_modules/@base-ui"))
            return "ui";
        },
      },
    },
  },
  server: {
    port: 8000,
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
        xfwd: true,
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
});

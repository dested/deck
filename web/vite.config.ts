import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import path from "node:path";

const root = path.resolve(import.meta.dirname);

// Dev: Vite serves the SPA on 12346 and proxies /api + /ws to the Fastify
// server on 12345 (§1). Prod: `vite build` emits web/dist which the server
// serves statically.
export default defineConfig({
  root,
  plugins: [react(), tailwind()],
  resolve: {
    alias: {
      "@deck/shared": path.resolve(root, "..", "shared", "src", "index.ts"),
      "@": path.resolve(root, "src"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 12346,
    strictPort: true,
    proxy: {
      "/api": { target: "http://127.0.0.1:12345", changeOrigin: true },
      "/ws": {
        target: "ws://127.0.0.1:12345",
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: path.resolve(root, "dist"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
  },
});

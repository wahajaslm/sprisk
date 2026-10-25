import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The browser talks to the local Rust API through this proxy. changeOrigin rewrites Host to
// 127.0.0.1:7420, so the API's Host check cannot protect this path; the dev server itself must
// stay on loopback with Vite's default host allow-list. Never set host: true or allowedHosts: true.
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    strictPort: true,
    proxy: {
      "/api": {
        // Another worktree's API may hold 7420; the port can move, the host stays loopback.
        target: `http://127.0.0.1:${process.env.SPRISK_API_PORT ?? "7420"}`,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
  },
});

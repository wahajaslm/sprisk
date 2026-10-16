import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The browser talks to the local Rust API through this proxy. changeOrigin sends
// Host: 127.0.0.1:7420, which the API's local-host check accepts.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:7420",
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

import { readFile } from "node:fs/promises";

import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vitest/config";

/** JupyterLab's packages import their icons as SVG text (their webpack build uses raw-loader).
 * Vite would import a URL instead, so give them the text (ADR-0034). */
const jupyterlabSvgText: Plugin = {
  name: "jupyterlab-svg-text",
  enforce: "pre",
  async load(id) {
    if (!id.includes("@jupyterlab") || !id.endsWith(".svg")) return null;
    return `export default ${JSON.stringify(await readFile(id, "utf8"))};`;
  },
};

// The browser talks to the local Rust API through this proxy. changeOrigin rewrites Host to
// 127.0.0.1:7420, so the API's Host check cannot protect this path; the dev server itself must
// stay on loopback with Vite's default host allow-list. Never set host: true or allowedHosts: true.
export default defineConfig({
  plugins: [jupyterlabSvgText, react()],
  // JupyterLab's cells and editors must share one copy of yjs, or edits do not bind.
  resolve: { dedupe: ["yjs", "@codemirror/state", "@codemirror/view"] },
  server: {
    host: "127.0.0.1",
    strictPort: true,
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
    // JupyterLab's packages import their icons as SVG text: Vite must transform them, not Node.
    server: { deps: { inline: [/@jupyterlab\//] } },
  },
});

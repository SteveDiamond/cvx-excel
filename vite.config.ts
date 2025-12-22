import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import { resolve } from "path";
import { readFileSync } from "fs";
import { homedir } from "os";

// Office Add-in dev certificates
const certDir = resolve(homedir(), ".office-addin-dev-certs");

export default defineConfig({
  plugins: [wasm(), topLevelAwait()],

  build: {
    rollupOptions: {
      input: {
        taskpane: resolve(__dirname, "taskpane.html"),
        functions: resolve(__dirname, "src/functions/functions.ts"),
      },
      output: {
        entryFileNames: "[name].js",
      },
      // Externalize Node.js-specific module (not used in browser)
      external: ["clarabel-wasm-nodejs"],
    },
    outDir: "dist",
    sourcemap: true,
    target: "esnext",
  },

  server: {
    port: 3000,
    https: {
      key: readFileSync(resolve(certDir, "localhost.key")),
      cert: readFileSync(resolve(certDir, "localhost.crt")),
    },
  },

  resolve: {
    alias: {
      // Redirect Node.js WASM to browser WASM (never actually imported in browser)
      "clarabel-wasm-nodejs": "clarabel-wasm",
    },
  },

  optimizeDeps: {
    exclude: ["cvxjs"],
  },
});

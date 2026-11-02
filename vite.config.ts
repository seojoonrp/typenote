/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    watch: { ignored: ["**/src-tauri/**", "**/spike/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  // mupdf finds its .wasm via new URL(..., import.meta.url); pre-bundling would break that.
  optimizeDeps: { exclude: ["mupdf"] },
  worker: { format: "es" },
  build: { target: "es2022" },
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});

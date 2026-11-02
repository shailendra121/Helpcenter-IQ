import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],

  // The build is packaged inside the Zendesk app (zendesk-app/assets) and
  // uploaded with ZCLI. It is NOT served by the backend.
  base: "./",
  build: {
    outDir: "../zendesk-app/assets/dashboard",
    emptyOutDir: true,
    rollupOptions: {
      input: "iframe.html",
    },
  },

  server: {
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },

  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    globals: true,
  },
});
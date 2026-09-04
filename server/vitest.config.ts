import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      GEMINI_MIN_INTERVAL_MS: "0",
    },
  },
});
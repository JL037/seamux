// The tests' own config, so Vitest doesn't load vite.config.ts and with it
// the React Router plugin and the board's middleware.

import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "~": fileURLToPath(new URL("./app", import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    environment: "node",
    // Each file gets its own process, so its fake cmux and its imports of
    // seamux's modules start fresh.
    pool: "forks",
  },
});

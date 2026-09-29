// The vendor contract: tests-cmux/ against a real cmux, from a cmux terminal
// (`npm run test:cmux`). Kept out of `npm test` and CI, which run tests/
// against the fake.

import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "~": fileURLToPath(new URL("./app", import.meta.url)) },
  },
  test: {
    include: ["tests-cmux/**/*.test.ts"],
    setupFiles: ["tests-cmux/setup.ts"],
    environment: "node",
    // One at a time: each opens and closes workspaces in the real cmux.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});

import { defineConfig } from "vitest/config";

/**
 * A config of its own, because `vite.config.ts` sets `root` to the UI
 * directory for the browser bundle. Vitest would inherit that root and find no
 * tests.
 */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});

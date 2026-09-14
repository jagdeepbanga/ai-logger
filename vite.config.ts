import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * The UI is a static bundle that the CLI's own HTTP server hands out, so it
 * builds into `dist/ui` alongside the compiled server and ships in the same
 * package. That is what keeps the installed tool free of runtime dependencies:
 * React is bundled here at build time, never resolved on the user's machine.
 */
export default defineConfig({
  root: "ui",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "../dist/ui",
    emptyOutDir: true,
  },
  server: {
    port: 5199,
    // `npm run dev` serves the UI with hot reload and talks to a running
    // `ai-logger ui` for data, so the UI can be worked on without rebuilding.
    proxy: { "/api": "http://127.0.0.1:4747" },
  },
});

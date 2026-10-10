import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const src = fileURLToPath(new URL("./src", import.meta.url));
const emptyModule = fileURLToPath(new URL("./tests/support/empty.ts", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${src}/` },
      // `server-only` throws outside the React server runtime; tests import server modules directly.
      { find: /^server-only$/, replacement: emptyModule },
    ],
  },
  test: {
    globals: true,
    setupFiles: ["tests/support/setup.ts"],
    testTimeout: 30_000,
    projects: [
      {
        extends: true,
        test: { name: "node", include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"], environment: "node" },
      },
      {
        extends: true,
        test: { name: "dom", include: ["tests/unit/**/*.test.tsx"], environment: "jsdom" },
      },
    ],
  },
});

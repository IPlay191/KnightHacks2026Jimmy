import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Only the data-access layer may touch the Drizzle client directly (design §7.5).
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/server/db/**", "src/server/pipeline/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [{ name: "@/server/db/client", message: "Use the query modules in src/server/db/queries instead." }],
          patterns: [
            { group: ["@/server/db/client"], message: "Use the query modules in src/server/db/queries instead." },
          ],
        },
      ],
    },
  },
  {
    // Client-side code must never import server modules (NFR-2.1). This also
    // covers the db client, since it lives under src/server.
    files: ["src/components/**/*.{ts,tsx}", "src/lib/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@/server/*", "@/server/**", "**/server/**"], message: "Client code can't import server modules." },
          ],
        },
      ],
    },
  },
  {
    files: ["tests/**/*.{ts,tsx}", "scripts/**/*.ts"],
    rules: { "no-restricted-imports": "off" },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "drizzle/**", "public/worklets/**", "playwright-report/**", "test-results/**"]),
]);

export default eslintConfig;

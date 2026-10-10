import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local", quiet: true });

// Migrations use the direct (unpooled) connection string (R14.8).
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: url ?? "" },
  strict: true,
  verbose: true,
});

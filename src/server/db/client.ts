import "server-only";
import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { getEnv } from "@/server/env";
import * as schema from "./schema";

export type Db = NeonHttpDatabase<typeof schema>;

let db: Db | null = null;

/**
 * Drizzle over Neon's HTTP driver, using the pooled connection string
 * (design §7.1). Each query is one HTTPS round-trip; `db.batch` runs as a
 * single non-interactive transaction.
 */
export function getDb(): Db {
  if (!db) {
    db = drizzle(neon(getEnv().DATABASE_URL), { schema });
  }
  return db;
}

/** Test seam: use a specific database (for example, the Neon test branch). */
export function setDbForTests(next: Db | null): void {
  db = next;
}

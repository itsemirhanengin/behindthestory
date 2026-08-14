import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

/**
 * A real connection pool rather than Neon's HTTP driver.
 *
 * The HTTP driver was the right call on serverless, where every invocation is
 * a fresh process. In a long-lived container it costs a round trip per query
 * and, more importantly, cannot open an interactive transaction — which auth
 * needs the moment a first sign-in creates a user and a session together.
 *
 * Keeping this on the standard Postgres wire protocol also means the eventual
 * move off Neon is a connection-string change and nothing else.
 */
function createDb() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  const pool = new Pool({
    connectionString,
    // Only supply TLS settings when the URL doesn't already carry an `sslmode`.
    // pg reads that parameter itself, and passing both makes it warn that the
    // two sources disagree about what `require` means.
    ...(/[?&]sslmode=/.test(connectionString)
      ? {}
      : { ssl: { rejectUnauthorized: true } }),
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  // A pool error with no listener takes the process down; Neon closing an idle
  // connection during scale-to-zero is a routine reason for one.
  pool.on("error", (error) => {
    console.error("[db] idle client error", error);
  });

  return drizzle(pool, { schema });
}

let _db: ReturnType<typeof createDb> | null = null;

export function getDb() {
  if (!_db) _db = createDb();
  return _db;
}

export * from "./schema";

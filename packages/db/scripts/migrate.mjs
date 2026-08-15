/**
 * Applies pending migrations from the command line.
 *
 * The API applies them itself on boot; this is for local development and for
 * running a migration against an environment without deploying to it.
 *
 *   node --env-file=../../apps/api/.env scripts/migrate.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

// Resolved against this file, not the shell's cwd: the script is also invoked
// from `apps/studio`, which is where the local .env lives.
const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../migrations",
);

/**
 * The dev stack from `docker-compose.yml`, used when nothing else is set.
 *
 * A default rather than an error because the alternative — remembering to
 * export a URL every time — is how a migration ends up pointed at production
 * by muscle memory. This one cannot reach anything but the local container.
 */
const DEV_DATABASE_URL = "postgres://bts:bts@127.0.0.1:55432/bts?sslmode=disable";

const connectionString = process.env.DATABASE_URL ?? DEV_DATABASE_URL;
if (!process.env.DATABASE_URL) {
  console.log("DATABASE_URL not set — using the local dev stack.\n");
}

const pool = new pg.Pool({
  connectionString,
  ssl: /localhost|127\.0\.0\.1/.test(connectionString)
    ? undefined
    : { rejectUnauthorized: true },
});
const db = drizzle(pool);

try {
  await db.execute("create extension if not exists vector");
} catch (error) {
  console.warn("· could not create the vector extension:", error.message);
}

await migrate(db, { migrationsFolder });
console.log("migrations applied");

await pool.end();

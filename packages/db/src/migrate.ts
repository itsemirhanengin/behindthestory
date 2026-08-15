import path from "node:path";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Pool, PoolClient } from "pg";

import { getDb } from "./index";

/**
 * Where the generated `.sql` files live at runtime.
 *
 * Resolved against this module rather than the shell's cwd, which differs
 * between the two ways this runs and is never `packages/db`:
 *
 *   dev        tsx loads the TypeScript directly, so this is
 *              `packages/db/src/migrate.ts` → `packages/db/migrations`
 *   container  esbuild inlines this into `/app/dist/index.js`, so it is
 *              `/app/migrations` — which is where the Dockerfile copies them
 *
 * Both land on the right folder. `DB_MIGRATIONS_DIR` overrides for anything
 * that does neither.
 */
export const MIGRATIONS_FOLDER =
  process.env.DB_MIGRATIONS_DIR ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");

/**
 * An arbitrary but stable key. Two API replicas starting at the same moment
 * would otherwise both try to apply the same migration; drizzle's bookkeeping
 * table has no lock of its own, so the second one fails on a duplicate object
 * and takes the container down mid-deploy.
 */
const MIGRATION_LOCK_KEY = 4_197_233_105;

/**
 * Applies pending migrations. Safe to call on every boot: drizzle records what
 * it has run and skips it next time.
 *
 * `vector` is created here rather than in a migration because `CREATE
 * EXTENSION` needs a privilege the migration runner may not have on every
 * environment, and failing to create it must not look like a failed migration.
 */
export async function runMigrations(
  migrationsFolder = MIGRATIONS_FOLDER,
): Promise<void> {
  /**
   * One connection, checked out and held for the whole thing.
   *
   * This matters more than it looks. `pg_advisory_lock` is scoped to a
   * *session*, and every query issued through the pool may land on a different
   * one. Taking the lock through the pool therefore locks a connection that is
   * immediately handed back, leaves the migration itself unprotected, and
   * strands the lock on a connection nobody will unlock. It appears to work
   * only because an idle pool keeps reusing the same socket.
   *
   * Holding one client makes the lock mean what it says, and is also what lets
   * this run against a transaction-mode connection pooler, where the
   * pool-per-statement assumption is not merely fragile but wrong.
   */
  const pool = getDb().$client as Pool;
  const client = await pool.connect();

  try {
    try {
      await client.query("create extension if not exists vector");
    } catch (error) {
      console.warn(
        "[db] could not ensure the vector extension; assuming it already exists",
        error,
      );
    }

    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    await runLocked(client, migrationsFolder);
  } finally {
    // Best effort: if the connection died the lock died with it, which is the
    // behaviour we want anyway.
    await client
      .query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY])
      .catch(() => {});
    client.release();
  }
}

async function runLocked(client: Pool | PoolClient, migrationsFolder: string) {
  try {
    await migrate(drizzle(client), { migrationsFolder });
  } catch (error) {
    /**
     * The one failure worth translating.
     *
     * `42P07` is "relation already exists", which on the first migration means
     * a database built by the old `drizzle-kit push` workflow with no record
     * of what it has. The baseline is written to be a no-op on exactly that
     * database, so reaching here means it drifted from the schema the baseline
     * describes — and the raw stack trace says none of that.
     */
    if ((error as { cause?: { code?: string } })?.cause?.code === "42P07") {
      throw new Error(
        "A migration tried to create something that already exists. This " +
          "database was probably built with `drizzle-kit push` and has since " +
          "drifted from the baseline. Compare it against " +
          "packages/db/migrations/0000_baseline.sql, or mark the migrations " +
          "already applied with `pnpm --filter @behindthestory/db db:baseline --apply`.",
        { cause: error },
      );
    }
    throw error;
  }
}

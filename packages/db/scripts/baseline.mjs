/**
 * Marks every existing migration as already applied, without running it.
 *
 * An escape hatch, not a step. The normal path needs nothing: the baseline
 * migration is written with `IF NOT EXISTS` throughout, so a database built by
 * the old `drizzle-kit push` workflow migrates cleanly on its own.
 *
 * Reach for this only when that is not true — a database that drifted from the
 * baseline, where the safe move is to declare it already migrated and fix the
 * drift by hand rather than let a migration guess.
 *
 *   node --env-file=../../apps/api/.env scripts/baseline.mjs
 *   node --env-file=../../apps/api/.env scripts/baseline.mjs --apply
 *
 * Reports by default; only writes with --apply.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const APPLY = process.argv.includes("--apply");

// Resolved against this file, not the shell's cwd.
const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../migrations",
);

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set. Pass --env-file=<path to .env>");
  process.exit(1);
}

const journalPath = path.join(migrationsFolder, "meta/_journal.json");
if (!fs.existsSync(journalPath)) {
  console.error(`No ${journalPath}. Run \`pnpm db:generate\` first.`);
  process.exit(1);
}

const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
const entries = journal.entries.map((entry) => ({
  tag: entry.tag,
  when: entry.when,
  hash: crypto
    .createHash("sha256")
    .update(
      fs.readFileSync(path.join(migrationsFolder, `${entry.tag}.sql`), "utf8"),
    )
    .digest("hex"),
}));

const pool = new pg.Pool({
  connectionString,
  ssl: /localhost|127\.0\.0\.1/.test(connectionString)
    ? undefined
    : { rejectUnauthorized: true },
});

// Same shape drizzle's own migrator creates, so it recognises what we wrote.
await pool.query(`create schema if not exists "drizzle"`);
await pool.query(`
  create table if not exists "drizzle"."__drizzle_migrations" (
    id serial primary key,
    hash text not null,
    created_at bigint
  )
`);

const { rows: applied } = await pool.query(
  `select hash from "drizzle"."__drizzle_migrations"`,
);
const appliedHashes = new Set(applied.map((row) => row.hash));
const pending = entries.filter((entry) => !appliedHashes.has(entry.hash));

if (!pending.length) {
  console.log("· every migration is already recorded");
} else {
  for (const entry of pending) console.log(`· ${entry.tag}`);
  if (APPLY) {
    for (const entry of pending) {
      await pool.query(
        `insert into "drizzle"."__drizzle_migrations" ("hash", "created_at") values ($1, $2)`,
        [entry.hash, entry.when],
      );
    }
    console.log(`\n${pending.length} migration(s) marked as applied`);
  } else {
    console.log(
      `\n${pending.length} migration(s) would be marked as applied without running. Re-run with --apply.`,
    );
  }
}

await pool.end();

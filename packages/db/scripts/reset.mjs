/**
 * Drops everything and rebuilds the schema from the migrations.
 *
 * Refuses to run against anything but a local database. That guard is not
 * paranoia: every local .env in this repo pointed at the production Neon
 * instance until the dev stack existed, and the failure mode of getting this
 * wrong is other people's manuscripts.
 *
 *   docker compose up -d
 *   pnpm db:reset
 *
 * `--force` overrides the host check. Only reach for it if you are certain,
 * and never with a URL you did not type yourself.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const FORCE = process.argv.includes("--force");
const here = path.dirname(fileURLToPath(import.meta.url));

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

const host = (() => {
  try {
    return new URL(connectionString).hostname;
  } catch {
    return "";
  }
})();

const isLocal = ["localhost", "127.0.0.1", "::1", "postgres"].includes(host);

if (!isLocal && !FORCE) {
  console.error(
    `Refusing to reset a non-local database.\n\n` +
      `  host: ${host}\n\n` +
      `This drops every table. If you meant a local database, start the dev\n` +
      `stack with \`docker compose up -d\` and point DATABASE_URL at\n` +
      `127.0.0.1. If you genuinely meant this one, re-run with --force.`,
  );
  process.exit(1);
}

if (!isLocal) {
  console.warn(`⚠️  Resetting a REMOTE database at ${host} because --force was given.\n`);
}

const pool = new pg.Pool({
  connectionString,
  ssl: isLocal ? undefined : { rejectUnauthorized: true },
});

// `drizzle` holds the migration journal; dropping it too is what makes the
// rebuild start from nothing rather than from "already migrated".
await pool.query(`drop schema if exists "drizzle" cascade`);
await pool.query(`drop schema if exists "public" cascade`);
await pool.query(`create schema "public"`);
await pool.end();

console.log("schema dropped, rebuilding from migrations…\n");

const result = spawnSync(process.execPath, [path.join(here, "migrate.mjs")], {
  stdio: "inherit",
  env: process.env,
});
process.exit(result.status ?? 1);

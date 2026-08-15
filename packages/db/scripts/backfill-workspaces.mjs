/**
 * Gives every existing account a personal workspace and moves its novels into it.
 *
 * Migration `0004_backfill_workspaces` already does this, so on a normal
 * upgrade there is nothing here to run. What it is for is the second pass:
 * novels whose `owner_id` was also null predate authentication and cannot be
 * placed automatically, so `db:claim` assigns them to an account and *then*
 * this moves them into that account's workspace.
 *
 *   node --env-file=../../apps/api/.env scripts/backfill-workspaces.mjs
 *   node --env-file=../../apps/api/.env scripts/backfill-workspaces.mjs --apply
 *
 * Reports by default; only writes with --apply. Safe to re-run: accounts that
 * already have a workspace are skipped, and only null-workspace novels move.
 *
 * Novels whose `owner_id` is also null predate auth entirely. They are left
 * alone and reported — assign them with `db:claim` first, then re-run this.
 */
import crypto from "node:crypto";
import pg from "pg";

const APPLY = process.argv.includes("--apply");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set. Pass --env-file=<path to .env>");
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString,
  ssl: /localhost|127\.0\.0\.1/.test(connectionString)
    ? undefined
    : { rejectUnauthorized: true },
});

function slugify(input) {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return base || "workspace";
}

const { rows: accounts } = await pool.query(`
  select u.id, u.email, u.display_name
    from users u
   where not exists (
     select 1 from workspace_members m where m.user_id = u.id
   )
   order by u.created_at
`);

const { rows: [orphanCount] } = await pool.query(`
  select count(*)::int as n from novels where workspace_id is null and owner_id is null
`);

const { rows: [pendingNovels] } = await pool.query(`
  select count(*)::int as n from novels where workspace_id is null and owner_id is not null
`);

console.log(`accounts without a workspace: ${accounts.length}`);
console.log(`novels awaiting a workspace:  ${pendingNovels.n}`);
if (orphanCount.n) {
  console.log(
    `novels with no owner at all:  ${orphanCount.n} — run db:claim first, these are skipped`,
  );
}

if (!APPLY) {
  console.log("\nDry run. Re-run with --apply to write.");
  await pool.end();
  process.exit(0);
}

const client = await pool.connect();
try {
  await client.query("begin");

  for (const account of accounts) {
    const label =
      account.display_name || account.email.split("@")[0] || "My workspace";
    const slug = `${slugify(label)}-${crypto.randomBytes(3).toString("hex")}`;

    const {
      rows: [workspace],
    } = await client.query(
      `insert into workspaces (name, slug) values ($1, $2) returning id`,
      [label, slug],
    );
    await client.query(
      `insert into workspace_members (workspace_id, user_id, role)
       values ($1, $2, 'owner')`,
      [workspace.id, account.id],
    );
  }

  // Every novel goes to its owner's *oldest* workspace, which after the loop
  // above is the personal one. Written as a single statement so a large shelf
  // does not turn into one round trip per novel.
  const { rowCount: moved } = await client.query(`
    update novels n
       set workspace_id = m.workspace_id
      from (
        select distinct on (user_id) user_id, workspace_id
          from workspace_members
         order by user_id, created_at
      ) m
     where n.workspace_id is null
       and n.owner_id = m.user_id
  `);

  await client.query("commit");
  console.log(`\n${accounts.length} workspace(s) created, ${moved} novel(s) moved`);
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  client.release();
}

await pool.end();

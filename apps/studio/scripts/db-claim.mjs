/**
 * Assigns every ownerless novel to one account.
 *
 * Novels written before auth existed have `owner_id = null`, and the ownership
 * check never matches null — so without this they are invisible to everyone,
 * including you.
 *
 *   node --env-file=.env.local scripts/db-claim.mjs you@example.com
 *   node --env-file=.env.local scripts/db-claim.mjs you@example.com --apply
 *
 * Reports by default; only writes with --apply.
 */
import pg from "pg";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const email = args.find((arg) => !arg.startsWith("--"))?.trim().toLowerCase();

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Run with --env-file=.env.local");
  process.exit(1);
}
if (!email) {
  console.error("Usage: node scripts/db-claim.mjs <email> [--apply]");
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("localhost")
    ? undefined
    : { rejectUnauthorized: true },
});

const { rows: users } = await pool.query(
  "select id from users where email = $1",
  [email],
);
if (!users.length) {
  console.error(
    `No account for ${email}. Sign in once through the app first — the account is created on first successful code entry.`,
  );
  await pool.end();
  process.exit(1);
}

const { rows: orphans } = await pool.query(
  "select id, title from novels where owner_id is null order by created_at",
);

if (!orphans.length) {
  console.log("· every novel already has an owner");
} else {
  for (const novel of orphans) console.log(`· ${novel.title} (${novel.id})`);
  if (APPLY) {
    const { rowCount } = await pool.query(
      "update novels set owner_id = $1 where owner_id is null",
      [users[0].id],
    );
    console.log(`\n${rowCount} novel(s) assigned to ${email}`);
  } else {
    console.log(`\n${orphans.length} novel(s) would be assigned to ${email}. Re-run with --apply.`);
  }
}

await pool.end();

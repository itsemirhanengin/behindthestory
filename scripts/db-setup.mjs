// Prepares Postgres extensions that `drizzle-kit push` cannot create itself.
// Run before `db:push` whenever the schema gains a pgvector column.
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Run with --env-file=.env.local");
  process.exit(1);
}

const sql = neon(url);
await sql`create extension if not exists vector`;

const [{ installed_version: version }] = await sql`
  select installed_version from pg_available_extensions where name = 'vector'
`;
console.log(`pgvector ready (version ${version})`);

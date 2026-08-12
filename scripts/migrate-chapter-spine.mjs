/**
 * Moves chapters from the free-form graph model to the linear spine model.
 *
 *   removed: mode, parent_chapter_id, pos_x, pos_y
 *   added:   variant_label, is_active, continues_from_previous, act
 *
 * Reading order is now `number` alone, and duplicate numbers are impossible:
 * one active chapter per (novel, number), enforced by a partial unique index.
 *
 * Safe to re-run — every statement is guarded.
 */
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Run with --env-file=.env.local");
  process.exit(1);
}
const sql = neon(url);

const columns = await sql`
  select column_name from information_schema.columns where table_name = 'chapters'
`;
const has = (name) => columns.some((c) => c.column_name === name);

// --- 1. New columns ------------------------------------------------------
await sql`alter table chapters add column if not exists variant_label text not null default ''`;
await sql`alter table chapters add column if not exists is_active boolean not null default true`;
await sql`alter table chapters add column if not exists continues_from_previous boolean not null default true`;
await sql`alter table chapters add column if not exists act integer not null default 1`;
console.log("· new columns ready");

// --- 2. Carry over what the old model actually meant ----------------------
if (has("mode")) {
  await sql`update chapters set continues_from_previous = (mode = 'continuation')`;
  console.log("· continues_from_previous backfilled from mode");
}

// --- 3. Collapse duplicate and gapped numbering into a clean 1..N spine ---
const before = await sql`
  select novel_id, number, count(*)::int as n
  from chapters group by novel_id, number having count(*) > 1
`;
if (before.length) {
  console.log(
    `· found ${before.length} duplicated slot(s): ${before
      .map((r) => `#${r.number}×${r.n}`)
      .join(", ")}`,
  );
}

await sql`
  with ordered as (
    select id, row_number() over (
      partition by novel_id order by number, created_at
    ) as rn
    from chapters
  )
  update chapters c set number = o.rn from ordered o
  where c.id = o.id and c.number <> o.rn
`;
console.log("· chapters renumbered sequentially");

// --- 4. Drop the graph ---------------------------------------------------
for (const column of ["mode", "parent_chapter_id", "pos_x", "pos_y"]) {
  if (has(column)) {
    // Column names cannot be bound as parameters; the list above is literal.
    await sql.query(`alter table chapters drop column if exists ${column}`);
    console.log(`· dropped ${column}`);
  }
}

// --- 5. Make duplicate slots impossible from here on ---------------------
await sql`
  create unique index if not exists chapters_active_slot_idx
  on chapters (novel_id, number) where is_active
`;
await sql`
  create unique index if not exists chapters_variant_slot_idx
  on chapters (novel_id, number, variant_label)
`;
console.log("· slot uniqueness enforced");

const rows = await sql`
  select novel_id, number, variant_label, is_active, title
  from chapters order by novel_id, number, variant_label
`;
console.log(`\n${rows.length} chapter(s):`);
for (const r of rows) {
  console.log(
    `  #${r.number}${r.variant_label ? r.variant_label : ""} ${r.is_active ? "●" : "○"} ${r.title}`,
  );
}

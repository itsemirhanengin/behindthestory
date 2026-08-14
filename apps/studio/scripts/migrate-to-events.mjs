/**
 * Moves existing relationship and character state onto the event timeline,
 * WITHOUT dropping anything.
 *
 *   node --env-file=.env.local scripts/migrate-to-events.mjs --dry
 *   node --env-file=.env.local scripts/migrate-to-events.mjs
 *
 * Run this BEFORE `npm run db:push -- --force`. The push drops
 * `relationships.type`, `relationships.closeness`, `relationships.key_moments`
 * and `characters.status`; this reads those columns first and writes their
 * content into `story_events`, so nothing is lost when they go.
 *
 * Idempotent: a relationship that already has events is skipped, so a second
 * run is a no-op rather than a duplicate timeline.
 *
 * What the conversion can and cannot preserve:
 *  · The current type and closeness become the bond's opening event. The old
 *    schema had no idea when the bond started, so it is anchored at chapter 0
 *    ("before the novel opened") — the only honest choice available.
 *  · Each key moment becomes an event at its own chapter, carrying the state
 *    unchanged, because the old schema never recorded what a moment changed it
 *    TO. The text and the chapter citation survive; the state transition was
 *    never stored and cannot be invented.
 *  · A non-alive status becomes an event at chapter 0 with no cause, for the
 *    same reason: the old column had nowhere to put one.
 */
import { neon } from "@neondatabase/serverless";

const DRY = process.argv.includes("--dry");
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Run with --env-file=.env.local");
  process.exit(1);
}
const sql = neon(url);

async function hasColumn(table, column) {
  const rows = await sql`
    select 1 from information_schema.columns
    where table_name = ${table} and column_name = ${column}`;
  return rows.length > 0;
}

// --- 1. The events table must exist before anything can be written to it ---
// Created here rather than by the push, so the backfill can run while the old
// columns are still present. `db:push` afterwards reconciles the rest.
await sql`
  create table if not exists story_events (
    id uuid primary key default gen_random_uuid(),
    novel_id uuid not null references novels(id) on delete cascade,
    relationship_id uuid references relationships(id) on delete cascade,
    character_id uuid references characters(id) on delete cascade,
    chapter_id uuid references chapters(id) on delete set null,
    chapter_number integer not null default 0,
    rel_type text,
    closeness integer,
    char_status text,
    cause text not null default '',
    driver_character_ids jsonb not null default '[]'::jsonb,
    impact text not null default 'major',
    origin text not null default 'user',
    created_at timestamp not null default now()
  )`;

const [{ count: existing }] = await sql`select count(*) from story_events`;
console.log(`· story_events ready (${existing} rows already present)`);

// --- 2. Relationships -----------------------------------------------------
const relsHaveState = await hasColumn("relationships", "type");
let openings = 0;
let moments = 0;

if (!relsHaveState) {
  console.log("· relationships.type is already gone — nothing to backfill");
} else {
  const rels = await sql`
    select id, novel_id, type, closeness, key_moments from relationships`;

  for (const r of rels) {
    const already = await sql`
      select 1 from story_events where relationship_id = ${r.id} limit 1`;
    if (already.length) continue;

    // Chapter numbers for the cited moments, so ordering survives the move.
    const keyMoments = Array.isArray(r.key_moments) ? r.key_moments : [];
    const chapterNumbers = new Map();
    for (const m of keyMoments) {
      if (!m?.chapterId || chapterNumbers.has(m.chapterId)) continue;
      const [ch] = await sql`
        select number from chapters where id = ${m.chapterId}`;
      chapterNumbers.set(m.chapterId, ch?.number ?? 0);
    }

    if (DRY) {
      console.log(
        `  would open ${r.id} as ${r.type}/${r.closeness} at Ch.0` +
          (keyMoments.length ? ` + ${keyMoments.length} moment event(s)` : ""),
      );
      openings++;
      moments += keyMoments.length;
      continue;
    }

    await sql`
      insert into story_events (
        novel_id, relationship_id, chapter_number, rel_type, closeness,
        cause, impact, origin
      ) values (
        ${r.novel_id}, ${r.id}, 0, ${r.type}, ${r.closeness},
        'Carried over from before the timeline existed — start chapter unknown.',
        'major', 'user'
      )`;
    openings++;

    for (const m of keyMoments) {
      if (!m?.text) continue;
      await sql`
        insert into story_events (
          novel_id, relationship_id, chapter_id, chapter_number,
          rel_type, closeness, cause, impact, origin
        ) values (
          ${r.novel_id}, ${r.id}, ${m.chapterId ?? null},
          ${chapterNumbers.get(m.chapterId) ?? 0},
          ${r.type}, ${r.closeness}, ${m.text}, 'major', 'user'
        )`;
      moments++;
    }
  }
}
console.log(
  `· ${openings} opening event(s), ${moments} key moment(s) converted` +
    (DRY ? " (dry run)" : ""),
);

// --- 3. Character status --------------------------------------------------
const charsHaveStatus = await hasColumn("characters", "status");
let fates = 0;

if (!charsHaveStatus) {
  console.log("· characters.status is already gone — nothing to backfill");
} else {
  // 'alive' is the derived default, so only the exceptions need an event.
  const chars = await sql`
    select id, novel_id, name, status from characters where status <> 'alive'`;
  for (const c of chars) {
    const already = await sql`
      select 1 from story_events where character_id = ${c.id} limit 1`;
    if (already.length) continue;
    if (DRY) {
      console.log(`  would record ${c.name} as ${c.status} at Ch.0`);
      fates++;
      continue;
    }
    await sql`
      insert into story_events (
        novel_id, character_id, chapter_number, char_status,
        cause, impact, origin
      ) values (
        ${c.novel_id}, ${c.id}, 0, ${c.status},
        'Carried over from before the timeline existed — chapter and cause unknown.',
        'pivotal', 'user'
      )`;
    fates++;
  }
}
console.log(`· ${fates} fate event(s) converted` + (DRY ? " (dry run)" : ""));

console.log(
  DRY
    ? "\nDry run: no events written. (The empty story_events table was created —" +
      " that step is additive and needed either way.) Drop --dry to apply."
    : "\nBackfill complete. Now run:  npm run db:push -- --force",
);

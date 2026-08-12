/**
 * Repairs the invariants the app relies on but that predate the constraints
 * enforcing them, and reports everything it touched.
 *
 *   node --env-file=.env.local scripts/db-clean.mjs          # report only
 *   node --env-file=.env.local scripts/db-clean.mjs --apply  # write changes
 *
 * Read-only by default: nothing is written unless --apply is passed.
 */
import { neon } from "@neondatabase/serverless";

const APPLY = process.argv.includes("--apply");
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Run with --env-file=.env.local");
  process.exit(1);
}
const sql = neon(url);

const findings = [];
const note = (message, count = 1) => {
  if (count > 0) findings.push(`${message} (${count})`);
};

const normalize = (s) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

// --- 1. Orphans the foreign keys would now prevent ------------------------
const orphanChunks = await sql`
  select cc.id from canon_chunks cc
  left join chapters c on c.id = cc.source_id where c.id is null`;
note("orphaned canon chunks removed", orphanChunks.length);
if (APPLY && orphanChunks.length) {
  await sql`delete from canon_chunks where id = any(${orphanChunks.map((r) => r.id)})`;
}

// --- 2. Contiguous 1..N slots per novel -----------------------------------
const gappy = await sql`
  with ranked as (
    select id, novel_id, number,
           dense_rank() over (partition by novel_id order by number) as rn
    from chapters
  )
  select count(*)::int as n from ranked where number <> rn`;
note("chapter slots renumbered to close gaps", gappy[0].n);
if (APPLY && gappy[0].n > 0) {
  // Park in the negative range so the unique index is never violated mid-way.
  await sql`
    with ranked as (
      select id, dense_rank() over (partition by novel_id order by number) as rn
      from chapters
    )
    update chapters c set number = -r.rn from ranked r
    where c.id = r.id and c.number <> r.rn`;
  await sql`update chapters set number = -number where number < 0`;
}

// --- 3. Exactly one active variant per slot -------------------------------
const headless = await sql`
  select novel_id, number from chapters
  group by novel_id, number having bool_or(is_active) = false`;
note("slots with no active take repaired", headless.length);
if (APPLY) {
  for (const slot of headless) {
    // Promote the original take ("" sorts first), else the earliest created.
    const [first] = await sql`
      select id from chapters
      where novel_id = ${slot.novel_id} and number = ${slot.number}
      order by variant_label asc, created_at asc limit 1`;
    if (first) {
      await sql`update chapters set is_active = true where id = ${first.id}`;
    }
  }
}

// --- 4. Duplicate story elements ------------------------------------------
const elements = await sql`
  select id, novel_id, title, description, status, created_at
  from story_elements order by novel_id, created_at`;
const seenElement = new Set();
const dupElements = [];
for (const e of elements) {
  const key = `${e.novel_id}:${normalize(e.title)}`;
  if (seenElement.has(key)) dupElements.push(e.id);
  else seenElement.add(key);
}
note("duplicate story elements removed", dupElements.length);
if (APPLY && dupElements.length) {
  await sql`delete from story_elements where id = any(${dupElements})`;
}

// --- 5. Duplicate and self-referential relationships ----------------------
const rels = await sql`
  select id, novel_id, source_character_id, target_character_id, created_at
  from relationships order by novel_id, created_at`;
const seenPair = new Set();
const dupRels = [];
for (const r of rels) {
  if (r.source_character_id === r.target_character_id) {
    dupRels.push(r.id);
    continue;
  }
  const key = [r.source_character_id, r.target_character_id].sort().join(":");
  const scoped = `${r.novel_id}:${key}`;
  if (seenPair.has(scoped)) dupRels.push(r.id);
  else seenPair.add(scoped);
}
note("duplicate or self-referential relationships removed", dupRels.length);
if (APPLY && dupRels.length) {
  await sql`delete from relationships where id = any(${dupRels})`;
}

// --- 6. Closeness outside the documented 1-10 scale -----------------------
const [outOfRange] = await sql`
  select count(*)::int as n from relationships where closeness < 1 or closeness > 10`;
note("relationship closeness clamped to 1-10", outOfRange.n);
if (APPLY && outOfRange.n > 0) {
  await sql`update relationships set closeness = least(10, greatest(1, closeness))
            where closeness < 1 or closeness > 10`;
}

// --- 7. Revision history beyond the retained window -----------------------
const MAX_REVISIONS = 40;
const excess = await sql`
  select id from (
    select id, row_number() over (
      partition by chapter_id order by created_at desc
    ) as rn from chapter_revisions
  ) t where rn > ${MAX_REVISIONS}`;
note(`revisions pruned beyond the newest ${MAX_REVISIONS} per chapter`, excess.length);
if (APPLY && excess.length) {
  await sql`delete from chapter_revisions where id = any(${excess.map((r) => r.id)})`;
}

// --- 8. Elements marked resolved with nothing to point at -----------------
const [halfResolved] = await sql`
  select count(*)::int as n from story_elements
  where status = 'resolved' and resolved_in_chapter_id is null`;
note("elements marked resolved without a payoff chapter reopened", halfResolved.n);
if (APPLY && halfResolved.n > 0) {
  await sql`update story_elements set status = 'planted'
            where status = 'resolved' and resolved_in_chapter_id is null`;
}

// --- Report ---------------------------------------------------------------
console.log(APPLY ? "Applied:" : "Would change (run with --apply):");
if (findings.length === 0) {
  console.log("  nothing — the database is already consistent.");
} else {
  for (const f of findings) console.log(`  · ${f}`);
}

const [counts] = await sql`
  select
    (select count(*) from novels)::int as novels,
    (select count(*) from chapters)::int as chapters,
    (select count(*) from characters)::int as characters,
    (select count(*) from relationships)::int as relationships,
    (select count(*) from locations)::int as locations,
    (select count(*) from story_elements)::int as elements,
    (select count(*) from character_facts)::int as facts,
    (select count(*) from chapter_revisions)::int as revisions,
    (select count(*) from canon_chunks)::int as chunks`;
console.log("\nCurrent contents:");
for (const [table, n] of Object.entries(counts)) console.log(`  ${table}: ${n}`);

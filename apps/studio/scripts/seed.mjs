/**
 * Loads the seed novel from `seed-data.mjs`.
 *
 *   npm run db:seed              # add the seed novel alongside existing ones
 *   npm run db:seed -- --replace # delete a previous copy of it first
 *   npm run db:seed -- --reset   # delete ALL novels, then seed
 *   npm run db:seed -- --index   # also embed the written chapters for retrieval
 *
 * `--index` needs the dev server running; it reuses the app's own indexing
 * endpoint rather than duplicating the embedding pipeline here.
 */
import { neon } from "@neondatabase/serverless";
import seed from "./seed-data.mjs";

const args = process.argv.slice(2);
const REPLACE = args.includes("--replace");
const RESET = args.includes("--reset");
const INDEX = args.includes("--index");
const BASE_URL = process.env.SEED_BASE_URL ?? "http://localhost:3001";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Run with --env-file=.env.local");
  process.exit(1);
}
const sql = neon(url);

// --- Clear ---------------------------------------------------------------
if (RESET) {
  await sql`delete from novels`;
  console.log("· all novels deleted");
} else if (REPLACE) {
  const gone = await sql`delete from novels where title = ${seed.novel.title} returning id`;
  if (gone.length) console.log(`· removed ${gone.length} previous copy of the seed novel`);
}

// --- Novel ---------------------------------------------------------------
const n = seed.novel;
const [novel] = await sql`
  insert into novels (title, premise, genre, tone, pov, tense, target_chapter_words, style_notes)
  values (${n.title}, ${n.premise}, ${n.genre}, ${n.tone}, ${n.pov}, ${n.tense},
          ${n.targetChapterWords}, ${n.styleNotes})
  returning id`;
const novelId = novel.id;
console.log(`· novel "${n.title}"`);

// --- Characters ----------------------------------------------------------
const characterId = {};
for (const c of seed.characters) {
  const [row] = await sql`
    insert into characters (
      novel_id, name, role, summary, backstory, traits, appearance, secrets,
      voice, speech_sample, motivation, arc, origin, color, pos_x, pos_y
    ) values (
      ${novelId}, ${c.name}, ${c.role}, ${c.summary}, ${c.backstory},
      ${JSON.stringify(c.traits)}, ${c.appearance}, ${c.secrets},
      ${c.voice}, ${c.speechSample}, ${c.motivation}, ${c.arc},
      'user', ${c.color}, ${c.posX}, ${c.posY}
    ) returning id`;
  characterId[c.key] = row.id;
}
console.log(`· ${seed.characters.length} characters`);

// --- Locations -----------------------------------------------------------
const locationId = {};
for (const l of seed.locations) {
  const [row] = await sql`
    insert into locations (
      novel_id, name, description, atmosphere, significance,
      character_ids, origin, pos_x, pos_y
    ) values (
      ${novelId}, ${l.name}, ${l.description}, ${l.atmosphere}, ${l.significance},
      '[]'::jsonb, 'user', ${l.posX}, ${l.posY}
    ) returning id`;
  locationId[l.key] = row.id;
}
for (const link of seed.locationLinks) {
  await sql`
    insert into location_links (novel_id, source_location_id, target_location_id, label)
    values (${novelId}, ${locationId[link.source]}, ${locationId[link.target]}, ${link.label})`;
}
console.log(`· ${seed.locations.length} locations, ${seed.locationLinks.length} links`);

// --- Chapters ------------------------------------------------------------
// Keyed by "number" for the active take and "number:LABEL" for variants, so
// elements and facts can reference a slot without caring about takes.
const chapterId = {};
for (const ch of seed.chapters) {
  const label = ch.variantLabel ?? "";
  const [row] = await sql`
    insert into chapters (
      novel_id, number, variant_label, is_active, act, title, summary, content,
      outline, beats, continues_from_previous, status
    ) values (
      ${novelId}, ${ch.number}, ${label}, ${ch.isActive ?? true}, ${ch.act},
      ${ch.title}, ${ch.summary}, ${ch.content}, ${ch.outline},
      ${JSON.stringify(
        (ch.beats ?? []).map((text, i) => ({
          id: `${ch.number}${label}-beat-${i + 1}`,
          text,
          done: false,
        })),
      )},
      ${ch.continuesFromPrevious}, ${ch.status}
    ) returning id`;
  chapterId[label ? `${ch.number}:${label}` : String(ch.number)] = row.id;
}
const written = seed.chapters.filter((c) => c.content.trim()).length;
console.log(`· ${seed.chapters.length} chapters (${written} written)`);

// --- Relationships and their timelines -----------------------------------
// A bond carries no state of its own; every "what it was in chapter N" comes
// from these events. Written after the chapters so each one can cite its slot.
const insertEvent = (e) => sql`
  insert into story_events (
    novel_id, relationship_id, character_id, chapter_id, chapter_number,
    rel_type, closeness, char_status, cause, driver_character_ids, impact, origin
  ) values (
    ${novelId}, ${e.relationshipId ?? null}, ${e.characterId ?? null},
    ${e.chapter > 0 ? (chapterId[String(e.chapter)] ?? null) : null}, ${e.chapter},
    ${e.type ?? null}, ${e.closeness ?? null}, ${e.status ?? null},
    ${e.cause ?? ""},
    ${JSON.stringify((e.drivenBy ?? []).map((k) => characterId[k]).filter(Boolean))},
    ${e.impact ?? "major"}, 'user'
  )`;

let relEvents = 0;
for (const r of seed.relationships) {
  const [row] = await sql`
    insert into relationships (
      novel_id, source_character_id, target_character_id,
      significance, description, origin
    ) values (
      ${novelId}, ${characterId[r.source]}, ${characterId[r.target]},
      ${r.significance ?? ""}, ${r.description}, 'user'
    ) returning id`;
  for (const e of r.timeline) {
    await insertEvent({ ...e, relationshipId: row.id });
    relEvents++;
  }
}
console.log(
  `· ${seed.relationships.length} relationships (${relEvents} timeline events)`,
);

// --- Character fate ------------------------------------------------------
let fateEvents = 0;
for (const c of seed.characters) {
  for (const e of c.fate ?? []) {
    await insertEvent({ ...e, characterId: characterId[c.key] });
    fateEvents++;
  }
}
console.log(`· ${fateEvents} fate events (deaths, disappearances)`);

// --- Story elements ------------------------------------------------------
for (const e of seed.storyElements) {
  await sql`
    insert into story_elements (
      novel_id, type, title, description, status,
      introduced_in_chapter_id, resolved_in_chapter_id, related_character_ids, origin
    ) values (
      ${novelId}, ${e.type}, ${e.title}, ${e.description}, ${e.status},
      ${chapterId[String(e.introducedIn)] ?? null},
      ${e.resolvedIn ? (chapterId[String(e.resolvedIn)] ?? null) : null},
      ${JSON.stringify((e.related ?? []).map((k) => characterId[k]).filter(Boolean))},
      'ai'
    )`;
}
const open = seed.storyElements.filter((e) => e.status !== "resolved").length;
console.log(
  `· ${seed.storyElements.length} threads (${open} open, ${seed.storyElements.length - open} paid off)`,
);

// --- Character facts -----------------------------------------------------
for (const f of seed.characterFacts) {
  await sql`
    insert into character_facts (novel_id, character_id, chapter_id, fact, origin)
    values (${novelId}, ${characterId[f.character]}, ${chapterId[String(f.chapter)] ?? null},
            ${f.fact}, 'ai')`;
}
console.log(`· ${seed.characterFacts.length} established facts`);

// --- Revisions -----------------------------------------------------------
for (const r of seed.revisions) {
  const words = r.content.trim() ? r.content.trim().split(/\s+/).length : 0;
  await sql`
    insert into chapter_revisions (chapter_id, content, label, word_count)
    values (${chapterId[String(r.chapter)]}, ${r.content}, ${r.label}, ${words})`;
}
console.log(`· ${seed.revisions.length} revision snapshots`);

// --- Optional: make the written chapters retrievable ---------------------
if (INDEX) {
  const targets = seed.chapters
    .filter((c) => c.content.trim() && !c.variantLabel)
    .map((c) => ({ number: c.number, id: chapterId[String(c.number)] }));
  let indexed = 0;
  for (const t of targets) {
    try {
      const res = await fetch(`${BASE_URL}/api/chapters/${t.id}/index`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      indexed += body.chunks ?? 0;
    } catch (error) {
      console.warn(
        `  ! could not index chapter ${t.number}: ${error.message}. Is the dev server running on ${BASE_URL}?`,
      );
    }
  }
  if (indexed) console.log(`· ${indexed} passages embedded for retrieval`);
}

console.log(`\nSeeded. Open /novels/${novelId}/story`);

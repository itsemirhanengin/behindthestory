/**
 * Moves characters off the old bright Tailwind palette and onto the platform's
 * earthy one, so rows created before the design system change stop clashing
 * with the paper and ink themes.
 *
 *   node --env-file=.env.local scripts/recolor-characters.mjs          # report only
 *   node --env-file=.env.local scripts/recolor-characters.mjs --apply  # write changes
 *
 * Read-only by default: nothing is written unless --apply is passed. Colours
 * the author picked deliberately from the new palette are already correct and
 * are left alone; only the eight retired values are remapped, each to its
 * closest counterpart so a cast stays visually distinguishable.
 */
import { neon } from "@neondatabase/serverless";

const APPLY = process.argv.includes("--apply");
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Run with --env-file=.env.local");
  process.exit(1);
}
const sql = neon(url);

/** Retired value -> nearest colour in the current palette. */
const REMAP = {
  "#8b5cf6": "#6b4c7a", // violet   -> plum
  "#ec4899": "#a34a5e", // pink     -> dusty rose
  "#f59e0b": "#b07d48", // amber    -> ochre
  "#22c55e": "#5c6e4a", // green    -> olive
  "#3b82f6": "#3f5e6b", // blue     -> slate teal
  "#ef4444": "#8c3a2b", // red      -> terracotta
  "#14b8a6": "#4a6b5c", // teal     -> sage
  "#f97316": "#a85c4a", // orange   -> clay
};

const rows = await sql`
  select color, count(*)::int as count
  from characters
  where color = any(${Object.keys(REMAP)})
  group by color
  order by count desc
`;

if (rows.length === 0) {
  console.log("No characters are using a retired colour. Nothing to do.");
  process.exit(0);
}

const total = rows.reduce((n, r) => n + r.count, 0);
console.log(`${total} character(s) on retired colours:\n`);
for (const { color, count } of rows) {
  console.log(`  ${color} -> ${REMAP[color]}  (${count})`);
}

if (!APPLY) {
  console.log("\nReport only. Re-run with --apply to write these changes.");
  process.exit(0);
}

let updated = 0;
for (const { color } of rows) {
  const changed = await sql`
    update characters set color = ${REMAP[color]} where color = ${color}
    returning id
  `;
  updated += changed.length;
}
console.log(`\nRecoloured ${updated} character(s).`);

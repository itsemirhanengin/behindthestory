import { NextResponse } from "next/server";
import { and, eq, ilike, or } from "drizzle-orm";
import {
  getDb,
  chapters,
  characters,
  characterFacts,
  locations,
  storyElements,
} from "@behindthestory/db";
import { loadStoryEvents } from "@behindthestory/core/story-events";
import { charactersAsOf } from "@behindthestory/core/story-state";

type Params = { params: Promise<{ novelId: string }> };

export type SearchHit = {
  kind: "chapter" | "character" | "location" | "element" | "fact";
  id: string;
  /** Where to navigate. Empty for entities that open in a canvas. */
  href: string;
  title: string;
  subtitle: string;
  snippet: string;
};

/** A window of text around the match, so a hit is readable in the list. */
function snippet(text: string, query: string, width = 90): string {
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  if (at === -1) return text.slice(0, width * 2).trim();
  const start = Math.max(0, at - width / 2);
  const end = Math.min(text.length, at + query.length + width);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

/** How many times the query occurs, so the best chapter sorts first. */
function countOccurrences(text: string, query: string): number {
  if (!query) return 0;
  let count = 0;
  let from = 0;
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) break;
    count++;
    from = at + needle.length;
  }
  return count;
}

/**
 * Searches the whole novel — prose, cast, places and threads — in one pass.
 * "Where did I mention the broken seal?" is the question a novelist asks most
 * often, and until now the app had no answer for it.
 */
export async function GET(req: Request, { params }: Params) {
  const { novelId } = await params;
  const query = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 2) return NextResponse.json({ hits: [] });

  const like = `%${query}%`;
  const db = getDb();

  const [chapterRows, characterRows, factRows, locationRows, elementRows] =
    await Promise.all([
      db
        .select()
        .from(chapters)
        .where(
          and(
            eq(chapters.novelId, novelId),
            or(
              ilike(chapters.content, like),
              ilike(chapters.title, like),
              ilike(chapters.summary, like),
              ilike(chapters.outline, like),
            ),
          ),
        ),
      db
        .select()
        .from(characters)
        .where(
          and(
            eq(characters.novelId, novelId),
            or(
              ilike(characters.name, like),
              ilike(characters.summary, like),
              ilike(characters.backstory, like),
              ilike(characters.secrets, like),
              ilike(characters.voice, like),
            ),
          ),
        ),
      db
        .select()
        .from(characterFacts)
        .where(
          and(
            eq(characterFacts.novelId, novelId),
            ilike(characterFacts.fact, like),
          ),
        ),
      db
        .select()
        .from(locations)
        .where(
          and(
            eq(locations.novelId, novelId),
            or(
              ilike(locations.name, like),
              ilike(locations.description, like),
              ilike(locations.significance, like),
            ),
          ),
        ),
      db
        .select()
        .from(storyElements)
        .where(
          and(
            eq(storyElements.novelId, novelId),
            or(
              ilike(storyElements.title, like),
              ilike(storyElements.description, like),
            ),
          ),
        ),
    ]);

  const characterName = new Map(characterRows.map((c) => [c.id, c.name]));

  // Search spans the whole novel, so a character's *latest* status is the right
  // one to show — this is not a view pinned to a chapter.
  const stateById = charactersAsOf(
    characterRows,
    await loadStoryEvents(novelId),
  );

  const hits: SearchHit[] = [
    ...chapterRows
      .map((ch) => ({
        chapter: ch,
        occurrences: countOccurrences(ch.content, query),
      }))
      .sort(
        (a, b) =>
          b.occurrences - a.occurrences || a.chapter.number - b.chapter.number,
      )
      .map(({ chapter: ch, occurrences }) => ({
        kind: "chapter" as const,
        id: ch.id,
        href: `/novels/${novelId}/write/${ch.id}`,
        title: `Chapter ${ch.number}${ch.variantLabel ? ` · take ${ch.variantLabel}` : ""}: ${ch.title}`,
        subtitle: occurrences > 1 ? `${occurrences} mentions` : "",
        snippet: snippet(ch.content || ch.summary, query),
      })),
    ...characterRows.map((c) => ({
      kind: "character" as const,
      id: c.id,
      href: `/novels/${novelId}/characters`,
      title: c.name,
      subtitle: `${c.role} · ${stateById.get(c.id)?.status ?? "alive"}`,
      snippet: snippet(
        [c.summary, c.backstory, c.secrets, c.voice].filter(Boolean).join(" "),
        query,
      ),
    })),
    ...factRows.map((f) => ({
      kind: "fact" as const,
      id: f.id,
      href: `/novels/${novelId}/characters`,
      title: characterName.get(f.characterId) ?? "Character fact",
      subtitle: "established fact",
      snippet: snippet(f.fact, query),
    })),
    ...locationRows.map((l) => ({
      kind: "location" as const,
      id: l.id,
      href: `/novels/${novelId}/locations`,
      title: l.name,
      subtitle: l.atmosphere,
      snippet: snippet(
        [l.description, l.significance].filter(Boolean).join(" "),
        query,
      ),
    })),
    ...elementRows.map((e) => ({
      kind: "element" as const,
      id: e.id,
      href: `/novels/${novelId}/story`,
      title: e.title,
      subtitle: `${e.type.replace("_", " ")} · ${e.status}`,
      snippet: snippet(e.description, query),
    })),
  ];

  return NextResponse.json({ hits: hits.slice(0, 40) });
}

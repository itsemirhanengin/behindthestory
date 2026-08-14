import {
  characters,
  relationships,
  storyEvents,
  locations,
  locationLinks,
  chapters,
  storyElements,
  characterFacts,
  chapterRevisions,
} from "./schema";

/**
 * Tables reachable by id through the generic `/api/entities/[entity]/[id]`
 * routes. Every table here is safe to read, patch and delete by primary key.
 */
export const entityTables = {
  characters,
  relationships,
  "story-events": storyEvents,
  locations,
  "location-links": locationLinks,
  chapters,
  "story-elements": storyElements,
  "character-facts": characterFacts,
  "chapter-revisions": chapterRevisions,
} as const;

export type EntityName = keyof typeof entityTables;

export function isEntityName(value: string): value is EntityName {
  return value in entityTables;
}

/**
 * The subset that carries a `novelId`, so it can be listed and created through
 * `/api/novels/[novelId]/[entity]`. Revisions hang off a chapter instead and
 * are deliberately excluded.
 *
 * `relationships` and `story-events` are excluded too, but for a different
 * reason: creating either one has an invariant a generic insert cannot hold. A
 * relationship must be born with its opening event, and an event is authored by
 * chapter number rather than chapter id. Both have their own static routes,
 * which shadow this one — listing them here would be dead configuration that
 * reads as if it worked.
 */
export const novelEntityTables = {
  characters,
  locations,
  "location-links": locationLinks,
  chapters,
  "story-elements": storyElements,
  "character-facts": characterFacts,
} as const;

export type NovelEntityName = keyof typeof novelEntityTables;

export function isNovelEntityName(value: string): value is NovelEntityName {
  return value in novelEntityTables;
}

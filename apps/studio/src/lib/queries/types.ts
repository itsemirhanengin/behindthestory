import type {
  Chapter as DbChapter,
  Character as DbCharacter,
  CharacterFact as DbCharacterFact,
  ChapterRevision as DbChapterRevision,
  Location as DbLocation,
  LocationLink as DbLocationLink,
  Novel as DbNovel,
  Relationship as DbRelationship,
  StoryElement as DbStoryElement,
  StoryEvent as DbStoryEvent,
} from "@behindthestory/db/schema";

/**
 * A row as it arrives over the wire.
 *
 * The database types carry `Date`, but JSON has no date — every timestamp
 * reaches the client as an ISO string. The old fetch wrapper asserted the
 * database type directly, so the client believed it held `Date` objects it had
 * never been sent; the RPC client types the response honestly, which is what
 * surfaced this.
 *
 * Naming the conversion here means components keep one import and the
 * serialisation boundary stays visible instead of being papered over.
 */
export type Wire<T> = {
  [K in keyof T]: T[K] extends Date
    ? string
    : T[K] extends Date | null
      ? string | null
      : T[K];
};

export type Novel = Wire<DbNovel>;
export type Chapter = Wire<DbChapter>;
export type Character = Wire<DbCharacter>;
export type CharacterFact = Wire<DbCharacterFact>;
export type ChapterRevision = Wire<DbChapterRevision>;
export type Location = Wire<DbLocation>;
export type LocationLink = Wire<DbLocationLink>;
export type Relationship = Wire<DbRelationship>;
export type StoryElement = Wire<DbStoryElement>;
export type StoryEvent = Wire<DbStoryEvent>;

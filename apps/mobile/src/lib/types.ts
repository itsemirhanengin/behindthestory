import type {
  Chapter as DbChapter,
  Character as DbCharacter,
  Location as DbLocation,
  Novel as DbNovel,
} from '@behindthestory/db/schema';

/**
 * A row as it arrives over the wire — the same mapper the studio uses. The
 * database types carry `Date`, but JSON has no date: every timestamp reaches
 * the client as an ISO string, and naming that conversion here keeps the
 * serialisation boundary visible instead of papered over.
 */
export type Wire<T> = {
  [K in keyof T]: T[K] extends Date ? string : T[K] extends Date | null ? string | null : T[K];
};

export type Novel = Wire<DbNovel>;
export type Chapter = Wire<DbChapter>;
export type Character = Wire<DbCharacter>;
export type Location = Wire<DbLocation>;

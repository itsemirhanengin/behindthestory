import type { User, WritingGoal } from "@behindthestory/db/schema";
import { POV_OPTIONS } from "./onboarding";

/**
 * The account profile: what the writer says about themselves, and what other
 * people are allowed to see of it.
 *
 * Two shapes, one row. `PublicProfile` is what a byline, an invitation or a
 * collaborator list will read; `PrivateProfile` is that plus the parts that
 * belong only to the account holder. Deriving both from `User` means adding a
 * column and forgetting to decide which side it belongs on is a type error
 * rather than a leak.
 *
 * No zod here, and no database access: the studio imports this to render the
 * form and the API imports it to project the row, so it has to stay loadable
 * in a browser bundle. The zod schemas live next to the route that validates
 * with them.
 */

/** Everything a signed-in stranger may see. Email is deliberately absent. */
export type PublicProfile = Pick<
  User,
  | "id"
  | "username"
  | "displayName"
  | "bio"
  | "favoriteGenres"
  | "preferredPov"
  | "writingGoal"
  | "influences"
  | "avoids"
> & {
  /** Absolute, already resolved against the bucket. `null` when unset. */
  avatarUrl: string | null;
  /** ISO string: the wire has no date type. */
  createdAt: string;
};

/** The account holder's own view. */
export type PrivateProfile = PublicProfile & {
  email: string;
};

/** The fields the profile form owns. Everything else changes through its own
 *  flow — email needs a code, the avatar needs an upload. */
export type ProfileEdit = {
  displayName: string;
  username: string;
  bio: string;
  favoriteGenres: string[];
  preferredPov: User["preferredPov"];
  writingGoal: WritingGoal | null;
  influences: string;
  avoids: string;
};

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/**
 * Ceilings, shared so the textarea's counter and the server's validator cannot
 * disagree about what fits.
 *
 * `bio` is a paragraph, not a page: it is read in a list next to other people,
 * and the length at which it stops being scannable is the real limit.
 */
export const PROFILE_LIMITS = {
  displayName: 60,
  bio: 400,
  influences: 300,
  avoids: 300,
  favoriteGenres: 6,
  genreLength: 40,
} as const;

// ---------------------------------------------------------------------------
// The questions
// ---------------------------------------------------------------------------

/**
 * A starting vocabulary, not a closed list.
 *
 * The writer can type anything — `favoriteGenres` is free text server-side —
 * but a blank field asking "which genres?" gets abandoned, and these are the
 * answers that make the next writer's list of suggestions useful.
 */
export const GENRE_SUGGESTIONS = [
  "Literary fiction",
  "Science fiction",
  "Fantasy",
  "Horror",
  "Crime",
  "Thriller",
  "Mystery",
  "Romance",
  "Historical",
  "Speculative",
  "Magical realism",
  "Young adult",
  "Western",
  "Satire",
] as const;

export const WRITING_GOAL_OPTIONS: {
  value: WritingGoal;
  label: string;
  hint: string;
}[] = [
  {
    value: "first_novel",
    label: "Finishing my first novel",
    hint: "The whole job is reaching the end of one book.",
  },
  {
    value: "publishing",
    label: "Publishing it",
    hint: "Querying agents, or going indie on purpose.",
  },
  {
    value: "serial",
    label: "Writing a serial",
    hint: "Chapters on a schedule, readers waiting.",
  },
  {
    value: "craft",
    label: "Getting better at the craft",
    hint: "The sentences matter more than the deadline.",
  },
  {
    value: "hobby",
    label: "Writing for myself",
    hint: "No plan beyond enjoying it.",
  },
];

export const writingGoalLabel = (value: WritingGoal | null) =>
  WRITING_GOAL_OPTIONS.find((option) => option.value === value)?.label ?? null;

/**
 * The narration question reuses the novel wizard's own options rather than
 * declaring a second list — the two would drift, and a writer who said "third
 * limited" here should see the same words when they start a book.
 */
export const POV_PREFERENCE_OPTIONS = POV_OPTIONS;

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

/**
 * Row to public shape.
 *
 * `avatarUrl` is resolved here, from a base the caller supplies, because the
 * bucket's public origin is deployment configuration rather than data.
 */
export function toPublicProfile(
  user: User,
  avatarBaseUrl: string | null,
): PublicProfile {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    bio: user.bio,
    favoriteGenres: user.favoriteGenres,
    preferredPov: user.preferredPov,
    writingGoal: user.writingGoal,
    influences: user.influences,
    avoids: user.avoids,
    avatarUrl:
      user.avatarKey && avatarBaseUrl
        ? `${avatarBaseUrl.replace(/\/$/, "")}/${user.avatarKey}`
        : null,
    createdAt: user.createdAt.toISOString(),
  };
}

export function toPrivateProfile(
  user: User,
  avatarBaseUrl: string | null,
): PrivateProfile {
  return { ...toPublicProfile(user, avatarBaseUrl), email: user.email };
}

/**
 * What to show when there is no avatar and no display name — which is every
 * account's first minute. Falls back through the handle so it is never empty.
 */
export function profileInitial(profile: {
  displayName: string;
  username: string;
}): string {
  const source = profile.displayName.trim() || profile.username;
  return source.slice(0, 1).toUpperCase();
}

/** The name to print. The handle is the fallback, never a blank line. */
export function profileName(profile: {
  displayName: string;
  username: string;
}): string {
  return profile.displayName.trim() || profile.username;
}

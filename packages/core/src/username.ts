/**
 * Handles: minting, normalising, validating.
 *
 * Pure and dependency-free, because both sides need the same answer — the
 * studio disables the Save button on an invalid handle, and the API refuses
 * one — and a rule that lives in two places is a rule that will disagree with
 * itself.
 *
 * ## Why the system mints it
 *
 * Asking someone to invent a unique handle before they have written a sentence
 * is a form to fill in, not a welcome. Every account therefore starts with a
 * working name it never had to think about, and changing it is a deliberate
 * later act rather than a gate on the way in.
 */

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;

/**
 * Lower-case, digits, and single interior hyphens.
 *
 * No underscores and no dots: the handle has to survive being a path segment,
 * a subdomain label and the local part of a future `@handle` mention without
 * needing three different escaping rules.
 */
const SHAPE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Names the platform needs for itself, or that would let a handle impersonate
 * one of its own pages.
 *
 * This list is checked against the *normalised* handle, and it is deliberately
 * longer than today's route table: a handle is permanent in other people's
 * links, so a name reclaimed later is a broken URL rather than an edit.
 */
const RESERVED = new Set([
  "admin",
  "administrator",
  "api",
  "auth",
  "avatar",
  "behindthestory",
  "billing",
  "bible",
  "chapter",
  "chapters",
  "character",
  "characters",
  "dashboard",
  "docs",
  "draft",
  "drafts",
  "help",
  "home",
  "location",
  "locations",
  "login",
  "logout",
  "me",
  "novel",
  "novels",
  "profile",
  "read",
  "root",
  "settings",
  "signin",
  "sign-in",
  "signout",
  "signup",
  "sign-up",
  "story",
  "studio",
  "support",
  "system",
  "team",
  "terms",
  "privacy",
  "user",
  "users",
  "workspace",
  "workspaces",
  "write",
  "you",
]);

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export type UsernameProblem =
  | "too_short"
  | "too_long"
  | "shape"
  | "reserved";

/** `null` means the handle is usable, subject only to uniqueness. */
export function usernameProblem(value: string): UsernameProblem | null {
  const handle = normalizeUsername(value);
  if (handle.length < USERNAME_MIN) return "too_short";
  if (handle.length > USERNAME_MAX) return "too_long";
  if (!SHAPE.test(handle)) return "shape";
  if (RESERVED.has(handle)) return "reserved";
  return null;
}

/** One sentence per problem, written to be shown verbatim under the field. */
export const USERNAME_PROBLEM_MESSAGE: Record<UsernameProblem, string> = {
  too_short: `At least ${USERNAME_MIN} characters.`,
  too_long: `At most ${USERNAME_MAX} characters.`,
  shape:
    "Lower-case letters, numbers and single hyphens between them — nothing else.",
  reserved: "That handle is reserved.",
};

/**
 * The mint's vocabulary. Two lists, both drawn from the world of books and
 * manuscripts, so a handle nobody chose still reads like it belongs here
 * rather than like `user_8134`.
 */
const QUALIFIERS = [
  "quiet", "amber", "hollow", "gilded", "distant", "patient", "restless",
  "midnight", "vellum", "candid", "wandering", "brittle", "steady", "sable",
  "lucid", "narrow", "roving", "sudden", "solemn", "wintry", "kindly",
  "unruly", "clever", "faded", "certain", "hushed", "keen", "stray",
] as const;

const NOUNS = [
  "folio", "quill", "margin", "prologue", "epigraph", "ledger", "colophon",
  "chapter", "spine", "inkwell", "codex", "atlas", "almanac", "fable",
  "canto", "stanza", "gazette", "cipher", "archive", "annal", "octavo",
  "vignette", "preface", "epilogue", "footnote", "signature", "leaflet",
] as const;

function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length)]!;
}

/**
 * A candidate handle, e.g. `quiet-folio-4127`.
 *
 * The four-digit tail is what makes collisions rare rather than impossible:
 * ~28 × 27 × 10,000 is about 7.5 million names, so the caller still has to
 * check uniqueness and ask again. `mintUsername` is where that loop lives.
 */
export function usernameCandidate(random: () => number = Math.random): string {
  const tail = String(1000 + Math.floor(random() * 9000));
  return `${pick(QUALIFIERS, random)}-${pick(NOUNS, random)}-${tail}`;
}

/**
 * Mints a handle that is actually free.
 *
 * `isTaken` is injected rather than imported so this stays free of the
 * database — the API passes a real query, tests pass a set.
 *
 * The last attempt appends a uuid fragment instead of trying another pretty
 * name. Sign-in is the caller, and an account that cannot be created because
 * the dice were unkind is far worse than an ugly handle the writer can change
 * on their profile page a minute later.
 */
export async function mintUsername(
  isTaken: (candidate: string) => Promise<boolean>,
  attempts = 5,
  random: () => number = Math.random,
): Promise<string> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const candidate = usernameCandidate(random);
    if (!(await isTaken(candidate))) return candidate;
  }

  const fallback = `writer-${Math.floor(random() * 1e12).toString(36)}`;
  return fallback.slice(0, USERNAME_MAX);
}

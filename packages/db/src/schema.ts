import {
  pgTable,
  text,
  integer,
  real,
  boolean,
  timestamp,
  jsonb,
  uuid,
  index,
  uniqueIndex,
  check,
  numeric,
  vector,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * The version a client checks its copy against.
 *
 * Every table reachable through the generic entity routes carries one, because
 * the mobile app edits offline and reconnects with writes that were composed
 * against a row it read some time ago. Without a value to compare, the last
 * device to sync would silently overwrite whatever the other one wrote.
 *
 * `$onUpdate` means Drizzle stamps it on every `.set()`, so no write path has
 * to remember to — and a path that bypasses Drizzle would be a bug regardless.
 */
function updatedAtColumn() {
  return timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
}

export const POV_VALUES = ["first", "third_limited", "third_omniscient"] as const;
export const TENSE_VALUES = ["past", "present"] as const;
export const AI_SUGGESTION_DECISIONS = ["accepted", "rejected"] as const;
export const AI_SUGGESTION_MODES = ["insert", "replace"] as const;

export const REL_TYPE_VALUES = [
  "family",
  "romance",
  "friendship",
  "rivalry",
  "mentor",
  "enemy",
  "ally",
  "other",
] as const;

export const CHAR_STATUS_VALUES = ["alive", "dead", "unknown"] as const;

export const SESSION_CLIENT_VALUES = ["web", "mobile"] as const;

/**
 * What the writer is actually here to do. Coarse on purpose: it exists to be
 * shown on a profile and, later, to match collaborators — not to branch logic.
 */
export const WRITING_GOAL_VALUES = [
  "first_novel",
  "publishing",
  "serial",
  "craft",
  "hobby",
] as const;

/**
 * How much an event mattered. This is the ranking signal that makes a
 * 600-chapter relationship readable: `pivotal` events are the ones the "why"
 * trace walks and the ones that always survive the prompt's token budget.
 */
export const EVENT_IMPACT_VALUES = ["minor", "major", "pivotal"] as const;

/**
 * Accounts are passwordless: an address that can receive a code is the whole
 * credential, so there is nothing here to hash, rotate or reset.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Always stored lower-cased; compare against `normalizeEmail()` output. */
    email: text("email").notNull(),
    displayName: text("display_name").notNull().default(""),

    /**
     * The handle. Minted by the system at first sign-in and changeable
     * afterwards, always stored lower-cased.
     *
     * This is the account's stable public name, and the one thing here that
     * collaboration will need before anything else: an invitation, a comment
     * byline and a shared workspace all have to address a writer by something
     * that is unique, safe in a URL and not their email address.
     */
    username: text("username").notNull(),

    // --- Public profile ----------------------------------------------------

    /**
     * Object key in the avatar bucket, not a URL. The bucket's public base is
     * deployment configuration, and baking it into the row would make moving
     * buckets a data migration.
     */
    avatarKey: text("avatar_key").notNull().default(""),
    bio: text("bio").notNull().default(""),

    /**
     * The writer's own taste, in the platform's existing vocabulary.
     *
     * Kept as columns rather than a jsonb blob because these are meant to be
     * queried — "who else writes third-limited horror" is the shape of every
     * collaboration feature that follows — and because a blob is where
     * undocumented keys go to accumulate.
     */
    favoriteGenres: text("favorite_genres").array().notNull().default(sql`'{}'`),
    /** Empty string means "no preference stated", not a default of `first`. */
    preferredPov: text("preferred_pov", { enum: POV_VALUES }),
    writingGoal: text("writing_goal", { enum: WRITING_GOAL_VALUES }),
    /** Authors and books that shaped them. Free text; it is a person talking. */
    influences: text("influences").notNull().default(""),
    /**
     * Prose the writer does not want. The same idea as a novel's `styleNotes`,
     * one level up — an account-wide default a new novel can start from instead
     * of the author retyping their own dislikes into every book.
     */
    avoids: text("avoids").notNull().default(""),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: updatedAtColumn(),
    lastSeenAt: timestamp("last_seen_at"),
  },
  (t) => [
    uniqueIndex("users_email_idx").on(t.email),
    uniqueIndex("users_username_idx").on(t.username),
  ],
);

/**
 * One row per signed-in device. Sessions live in Postgres rather than Redis so
 * they survive a cache flush, can be listed back to the writer as "my devices",
 * and can be revoked one at a time.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 of the token. The raw token is shown once and never stored. */
    tokenHash: text("token_hash").notNull(),
    /** Which client the session was minted for — web uses a cookie, mobile a
     *  bearer token, and knowing which lets us present the device list. */
    client: text("client", { enum: SESSION_CLIENT_VALUES })
      .notNull()
      .default("web"),
    userAgent: text("user_agent").notNull().default(""),
    ip: text("ip").notNull().default(""),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at").notNull().defaultNow(),
    expiresAt: timestamp("expires_at").notNull(),
    revokedAt: timestamp("revoked_at"),
  },
  (t) => [
    uniqueIndex("sessions_token_idx").on(t.tokenHash),
    index("sessions_user_idx").on(t.userId),
  ],
);

/**
 * The billing and tenancy subject.
 *
 * Everything that costs money — the plan, the word balance, the Polar customer
 * — hangs off a workspace rather than a user, because a Team plan is a shared
 * pool that several writers draw from. A solo writer never sees the concept:
 * signing in creates a personal workspace and they are its only member.
 */
export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    /**
     * Which model prose generations use. Null means "whatever the plan
     * defaults to", which is also the only possibility on Free — that plan
     * does not render a model picker.
     */
    defaultModel: text("default_model"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [uniqueIndex("workspaces_slug_idx").on(t.slug)],
);

export const WORKSPACE_ROLE_VALUES = ["owner", "admin", "member"] as const;

/**
 * Who may act inside a workspace. `owner` is the billing contact and cannot be
 * removed; `admin` may buy and cancel; `member` may only write.
 */
export const workspaceMembers = pgTable(
  "workspace_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: WORKSPACE_ROLE_VALUES })
      .notNull()
      .default("member"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("workspace_members_unique_idx").on(t.workspaceId, t.userId),
    index("workspace_members_user_idx").on(t.userId),
  ],
);

export const novels = pgTable(
  "novels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * The single authorisation edge for the whole graph. Every other table
     * reaches a novel through `novel_id`, so "may this account touch this
     * data" is one check here rather than a column on all thirteen tables.
     *
     * This used to be `owner_id`. Moving it to the workspace is what makes a
     * shared plan possible: two writers on the same Team see the same novels
     * without anything else in the graph changing.
     *
     * Nullable only to carry rows across the migration; a null workspace is
     * unreachable for every caller until the backfill assigns it.
     */
    workspaceId: uuid("workspace_id").references(() => workspaces.id, {
      onDelete: "cascade",
    }),
    /**
     * Who created it. No longer load-bearing for authorisation — kept because
     * attribution inside a shared workspace is worth having. Nulled rather
     * than cascaded when an account goes away: in a shared workspace one
     * member leaving must not take the team's novels with them.
     */
    ownerId: uuid("owner_id").references(() => users.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    premise: text("premise").notNull().default(""),

    // --- Style profile: compiled into every AI prompt for this novel. -------
    genre: text("genre").notNull().default(""),
    /** Freeform mood descriptors, e.g. "bleak, wry, slow-burn dread". */
    tone: text("tone").notNull().default(""),
    pov: text("pov", { enum: POV_VALUES }).notNull().default("third_limited"),
    tense: text("tense", { enum: TENSE_VALUES }).notNull().default("past"),
    targetChapterWords: integer("target_chapter_words").notNull().default(1800),
    /** Prose rules, influences, things to avoid. Passed through verbatim. */
    styleNotes: text("style_notes").notNull().default(""),

    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("novels_workspace_idx").on(t.workspaceId)],
);

/**
 * The new-novel wizard's work in progress, one row per unfinished novel.
 *
 * The wizard used to hold everything in client state until the final step, so
 * a closed tab took the premise — and the AI reading the workspace had already
 * paid for — with it. This row is that state, snapshotted whole on a debounce.
 * "New novel" mints a row and the wizard lives at its id, so an author can
 * keep any number of novels half-described at once. It hangs off the user
 * rather than a workspace because it is pre-novel scratch: nothing here is
 * shared, billed, or reachable by anyone else, and the workspace edge is only
 * decided at publish, by `POST /api/novels`.
 *
 * The jsonb columns are deliberately untyped at this layer. Their shapes
 * (`Reading`, `StyleFields`, …) live in `@behindthestory/core/onboarding`,
 * which imports types from this file — typing them here would close that
 * cycle. The API route validates them with zod schemas that `satisfies` the
 * core types, so drift still fails the build, just one package over.
 */
export const novelDrafts = pgTable(
  "novel_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    /** Where the author stood, so a restore reopens the same step. */
    step: integer("step").notNull().default(0),
    maxStep: integer("max_step").notNull().default(0),

    title: text("title").notNull().default(""),
    /** Whether the title came from the AI's suggestions — keeps the badge honest. */
    titleFromAi: boolean("title_from_ai").notNull().default(false),
    description: text("description").notNull().default(""),

    /** The AI's `Reading`, null until step two has run. */
    reading: jsonb("reading"),
    readingRevision: integer("reading_revision").notNull().default(0),
    /** `WizardTurn[]` — the correction history behind the current reading. */
    turns: jsonb("turns").notNull().default([]),

    /** `StyleFields` as the author has edited them, null until step three. */
    style: jsonb("style"),
    /** The untouched `StyleProposal`, kept so rationales survive a restore. */
    styleProposal: jsonb("style_proposal"),
    /** Which reading revision the style derives from; -1 means none yet. */
    styleFrom: integer("style_from").notNull().default(-1),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [index("novel_drafts_user_idx").on(t.userId)],
);

export const characters = pgTable(
  "characters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    novelId: uuid("novel_id")
      .notNull()
      .references(() => novels.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    role: text("role", { enum: ["main", "side", "minor"] })
      .notNull()
      .default("side"),
    summary: text("summary").notNull().default(""),
    backstory: text("backstory").notNull().default(""),
    traits: jsonb("traits").$type<string[]>().notNull().default([]),
    appearance: text("appearance").notNull().default(""),
    secrets: text("secrets").notNull().default(""),

    // --- Voice: what stops every character sounding like the same narrator. -
    /** Speech patterns, diction, verbal tics, what they never say. */
    voice: text("voice").notNull().default(""),
    /** A few example lines of dialogue, quoted verbatim into the prompt. */
    speechSample: text("speech_sample").notNull().default(""),
    /** What they want right now — drives their behaviour in a scene. */
    motivation: text("motivation").notNull().default(""),
    /** Where they are headed across the novel. */
    arc: text("arc").notNull().default(""),

    // No `status` column: whether a character is alive at a given point in the
    // novel is derived from `storyEvents`. A character with no status event has
    // been alive since the novel opened. See `lib/story-state.ts`.
    origin: text("origin", { enum: ["user", "ai"] })
      .notNull()
      .default("user"),
    color: text("color").notNull().default("#8c3a2b"),
    posX: real("pos_x").notNull().default(0),
    posY: real("pos_y").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [index("characters_novel_idx").on(t.novelId)],
);

/**
 * The *identity* of a bond between two characters, plus the author's timeless
 * notes about it. Deliberately holds no type and no closeness: what the bond
 * currently *is* changes across the novel and lives in `storyEvents`.
 *
 * Every relationship has at least one event — the one that establishes what it
 * was when the pair first appeared. A relationship with no event as of chapter N
 * simply has not formed yet at that point in the story, and correctly renders
 * nowhere.
 */
export const relationships = pgTable(
  "relationships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    novelId: uuid("novel_id")
      .notNull()
      .references(() => novels.id, { onDelete: "cascade" }),
    sourceCharacterId: uuid("source_character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "cascade" }),
    targetCharacterId: uuid("target_character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "cascade" }),
    /** Timeless framing of the pair — not a snapshot of the current state. */
    description: text("description").notNull().default(""),
    significance: text("significance").notNull().default(""),
    origin: text("origin", { enum: ["user", "ai"] })
      .notNull()
      .default("user"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [index("relationships_novel_idx").on(t.novelId)],
);

/**
 * A point in the novel where a relationship's or a character's state changed,
 * and *why* it changed.
 *
 * Two rules make this readable at 600+ chapters:
 *
 *  1. A row is a SNAPSHOT, not a delta — it records the full state *after* the
 *     event. "What was this in chapter 128?" is then a single row lookup
 *     (`chapterNumber <= 128`, last one wins) instead of folding 127 deltas,
 *     and editing one event cannot corrupt the ones after it.
 *  2. `cause`, `driverCharacterIds` and `impact` are first-class. The state
 *     alone answers "are they friends?"; these answer "why, and who did it" —
 *     which is the question an author actually has 500 chapters later.
 *
 * `chapterNumber` 0 means "true before the novel opens" — a character already
 * dead in chapter 1, or what a pair were to each other when they first walked
 * on. Everything else is anchored to the chapter that changed it.
 */
export const storyEvents = pgTable(
  "story_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    novelId: uuid("novel_id")
      .notNull()
      .references(() => novels.id, { onDelete: "cascade" }),

    // --- Subject: exactly one of these is set (enforced below) -------------
    relationshipId: uuid("relationship_id").references(() => relationships.id, {
      onDelete: "cascade",
    }),
    characterId: uuid("character_id").references(() => characters.id, {
      onDelete: "cascade",
    }),

    // --- Position on the spine --------------------------------------------
    /** The citation. Survives its chapter being deleted; only the link is lost. */
    chapterId: uuid("chapter_id").references(() => chapters.id, {
      onDelete: "set null",
    }),
    /**
     * Denormalised so ordering and "as of chapter N" keep working after a
     * chapter is deleted or renumbered, without a join on every read.
     */
    chapterNumber: integer("chapter_number").notNull().default(0),

    // --- State AFTER this event -------------------------------------------
    // Which of these apply is decided by the subject, not by convention: the
    // check constraint below makes the wrong combination unstorable.
    relType: text("rel_type", { enum: REL_TYPE_VALUES }),
    closeness: integer("closeness"),
    charStatus: text("char_status", { enum: CHAR_STATUS_VALUES }),

    // --- Causality: the entire point of this table -------------------------
    /** What happened. "Marit pulled Ione out of the well; the feud ended there." */
    cause: text("cause").notNull().default(""),
    /**
     * Who drove the change. This is what separates "B died" from "B died
     * because A misread the tide" and "B died shielding A" — the attribution
     * an author needs when reconciling chapter 685 with chapter 128.
     */
    driverCharacterIds: jsonb("driver_character_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    impact: text("impact", { enum: EVENT_IMPACT_VALUES })
      .notNull()
      .default("major"),
    origin: text("origin", { enum: ["user", "ai"] })
      .notNull()
      .default("user"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("story_events_novel_idx").on(t.novelId),
    index("story_events_relationship_idx").on(t.relationshipId),
    index("story_events_character_idx").on(t.characterId),
    // "What happened in chapter 128?" across the whole novel.
    index("story_events_chapter_idx").on(t.novelId, t.chapterNumber),
    // One subject per row, and a complete state snapshot for that subject.
    // Without this, a half-filled event would read as a silent state reset.
    check(
      "story_events_subject_state",
      sql`(
        ${t.relationshipId} is not null and ${t.characterId} is null
          and ${t.relType} is not null and ${t.closeness} is not null
          and ${t.charStatus} is null
      ) or (
        ${t.characterId} is not null and ${t.relationshipId} is null
          and ${t.charStatus} is not null
          and ${t.relType} is null and ${t.closeness} is null
      )`,
    ),
    check(
      "story_events_closeness_range",
      sql`${t.closeness} is null or (${t.closeness} >= 1 and ${t.closeness} <= 10)`,
    ),
    check("story_events_chapter_number", sql`${t.chapterNumber} >= 0`),
  ],
);

export const locations = pgTable(
  "locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    novelId: uuid("novel_id")
      .notNull()
      .references(() => novels.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    atmosphere: text("atmosphere").notNull().default(""),
    significance: text("significance").notNull().default(""),
    characterIds: jsonb("character_ids").$type<string[]>().notNull().default([]),
    origin: text("origin", { enum: ["user", "ai"] })
      .notNull()
      .default("user"),
    posX: real("pos_x").notNull().default(0),
    posY: real("pos_y").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [index("locations_novel_idx").on(t.novelId)],
);

export const locationLinks = pgTable("location_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  novelId: uuid("novel_id")
    .notNull()
    .references(() => novels.id, { onDelete: "cascade" }),
  sourceLocationId: uuid("source_location_id")
    .notNull()
    .references(() => locations.id, { onDelete: "cascade" }),
  targetLocationId: uuid("target_location_id")
    .notNull()
    .references(() => locations.id, { onDelete: "cascade" }),
  label: text("label").notNull().default(""),
  updatedAt: updatedAtColumn(),
});

/** A planned unit of action inside a chapter, authored or AI-drafted. */
export type Beat = { id: string; text: string; done: boolean };

/**
 * A chapter occupies a slot on the novel's spine. Reading order is `number`
 * and nothing else — there is no chapter graph.
 *
 * A slot may hold several drafts of the same chapter, distinguished by
 * `variantLabel` ("" is the original, then "B", "C", ...). Exactly one variant
 * per slot is `isActive`, and that is the one the reader, the export and every
 * AI context sees. Both rules are enforced by unique indexes in the database.
 */
export const chapters = pgTable(
  "chapters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    novelId: uuid("novel_id")
      .notNull()
      .references(() => novels.id, { onDelete: "cascade" }),
    /** Position in reading order, 1-based. Shared by a slot's variants. */
    number: integer("number").notNull(),
    /** "" for the original draft; "B", "C", ... for alternative takes. */
    variantLabel: text("variant_label").notNull().default(""),
    /** The variant that counts. Exactly one per (novel, number). */
    isActive: boolean("is_active").notNull().default(true),
    /** Structural grouping on the spine. */
    act: integer("act").notNull().default(1),
    title: text("title").notNull().default("Untitled Chapter"),
    summary: text("summary").notNull().default(""),
    /** Markdown. Plain prose is valid Markdown, so pre-Tiptap rows still load. */
    content: text("content").notNull().default(""),
    /** Freeform plan for the chapter, written before the prose. */
    outline: text("outline").notNull().default(""),
    beats: jsonb("beats").$type<Beat[]>().notNull().default([]),
    /**
     * Whether the prose picks up directly from the previous chapter. False for
     * a time jump, a POV switch or a flashback — the AI then gets the previous
     * chapter's summary instead of its closing text.
     */
    continuesFromPrevious: boolean("continues_from_previous")
      .notNull()
      .default(true),
    status: text("status", { enum: ["draft", "final"] })
      .notNull()
      .default("draft"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("chapters_novel_idx").on(t.novelId),
    uniqueIndex("chapters_variant_slot_idx").on(
      t.novelId,
      t.number,
      t.variantLabel,
    ),
    // Exactly one active variant per slot — this is what makes duplicate
    // chapter numbers impossible rather than merely discouraged.
    uniqueIndex("chapters_active_slot_idx")
      .on(t.novelId, t.number)
      .where(sql`${t.isActive}`),
  ],
);

export const storyElements = pgTable(
  "story_elements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    novelId: uuid("novel_id")
      .notNull()
      .references(() => novels.id, { onDelete: "cascade" }),
    type: text("type", {
      enum: ["twist", "foreshadowing", "plot_thread", "event"],
    }).notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: text("status", { enum: ["planted", "developing", "resolved"] })
      .notNull()
      .default("planted"),
    // A deleted chapter must not leave a thread pointing at nothing — the
    // story map places threads by these two columns.
    introducedInChapterId: uuid("introduced_in_chapter_id").references(
      () => chapters.id,
      { onDelete: "set null" },
    ),
    resolvedInChapterId: uuid("resolved_in_chapter_id").references(
      () => chapters.id,
      { onDelete: "set null" },
    ),
    relatedCharacterIds: jsonb("related_character_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    origin: text("origin", { enum: ["user", "ai"] })
      .notNull()
      .default("ai"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [index("story_elements_novel_idx").on(t.novelId)],
);

/**
 * Canon facts revealed about a character by a specific chapter. Kept separate
 * from `characters.backstory` so an analysis merge stays reversible and the
 * authored backstory never gets silently rewritten.
 */
export const characterFacts = pgTable(
  "character_facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    novelId: uuid("novel_id")
      .notNull()
      .references(() => novels.id, { onDelete: "cascade" }),
    characterId: uuid("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "cascade" }),
    /** The fact survives its chapter being deleted; only the citation is lost. */
    chapterId: uuid("chapter_id").references(() => chapters.id, {
      onDelete: "set null",
    }),
    fact: text("fact").notNull(),
    origin: text("origin", { enum: ["user", "ai"] })
      .notNull()
      .default("ai"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("character_facts_novel_idx").on(t.novelId),
    index("character_facts_character_idx").on(t.characterId),
  ],
);

/** Point-in-time snapshot of a chapter's prose, so AI writes are reversible. */
export const chapterRevisions = pgTable(
  "chapter_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    /** Why the snapshot was taken, e.g. "before AI draft", "manual". */
    label: text("label").notNull().default("manual"),
    wordCount: integer("word_count").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("chapter_revisions_chapter_idx").on(t.chapterId)],
);

export const CANON_SOURCE_TYPES = ["chapter"] as const;

/**
 * Embedded prose passages, used to retrieve the parts of earlier chapters that
 * actually matter for the scene being written instead of dumping every chapter.
 */
export const canonChunks = pgTable(
  "canon_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    novelId: uuid("novel_id")
      .notNull()
      .references(() => novels.id, { onDelete: "cascade" }),
    sourceType: text("source_type", { enum: CANON_SOURCE_TYPES })
      .notNull()
      .default("chapter"),
    /**
     * Chunks die with their chapter. Without this, deleting a chapter left its
     * prose in the index and retrieval kept feeding deleted text to the model.
     * Widening CANON_SOURCE_TYPES beyond chapters means revisiting this.
     */
    sourceId: uuid("source_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    /** Denormalised so retrieval can order and label results without a join. */
    chapterNumber: integer("chapter_number").notNull().default(0),
    chapterTitle: text("chapter_title").notNull().default(""),
    /** Position of this chunk within its source, for stable ordering. */
    seq: integer("seq").notNull().default(0),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("canon_chunks_novel_idx").on(t.novelId),
    index("canon_chunks_source_idx").on(t.sourceId),
    index("canon_chunks_embedding_idx").using(
      "hnsw",
      t.embedding.op("vector_cosine_ops"),
    ),
  ],
);

export const USAGE_SOURCE_VALUES = ["platform", "byok"] as const;

/**
 * Usage log for every AI call, so generation cost is visible rather than magic.
 *
 * This started as analytics and is now also the evidence behind a bill, which
 * changed two things about it. `novel_id` no longer cascades: deleting a novel
 * used to erase what its generations cost, which is fine for a usage panel and
 * unacceptable for a record of what somebody was charged. And every row now
 * carries the workspace, so per-account totals are a scan of one index rather
 * than a join through a nullable owner.
 */
export const aiGenerations = pgTable(
  "ai_generations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Who pays. Nullable only so the column could be added ahead of backfill. */
    workspaceId: uuid("workspace_id").references(() => workspaces.id, {
      onDelete: "cascade",
    }),
    /** Who asked. Attribution inside a shared workspace; not an authorisation edge. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    novelId: uuid("novel_id").references(() => novels.id, {
      onDelete: "set null",
    }),
    chapterId: uuid("chapter_id").references(() => chapters.id, {
      onDelete: "set null",
    }),
    /** Which endpoint produced this, e.g. "chapter", "inline", "continuity". */
    route: text("route").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    /** Subset of `input_tokens` served from the provider's cache. */
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    /** Subset of `input_tokens` written to it, which some providers surcharge. */
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    /** Subset of `output_tokens`. Recorded for visibility, never billed twice. */
    reasoningTokens: integer("reasoning_tokens").notNull().default(0),
    /** What the provider charged us, in USD. Six decimals holds a $0.000001 call. */
    usdCost: numeric("usd_cost", { precision: 12, scale: 6 }).notNull().default("0"),
    /** What the workspace was charged, in words. */
    wordsCharged: integer("words_charged").notNull().default(0),
    /** Reserved for bring-your-own-key, which does not draw down the allowance. */
    source: text("source", { enum: USAGE_SOURCE_VALUES })
      .notNull()
      .default("platform"),
    /**
     * The caller's idempotency key, shared with the ledger rows for the same
     * generation. Unique so a retried settle cannot bill twice.
     */
    requestId: text("request_id"),
    durationMs: integer("duration_ms").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("ai_generations_novel_idx").on(t.novelId),
    index("ai_generations_workspace_idx").on(t.workspaceId, t.createdAt),
    uniqueIndex("ai_generations_request_idx").on(t.requestId),
  ],
);

/**
 * The spendable balance, kept as two counters rather than a pile of grants.
 *
 * Plan words reset at each billing period; top-up words never do. Because the
 * spend order is fixed — plan first, then top-ups — a debit needs no
 * allocation pass over grant rows, which is what lets it be the single
 * conditional UPDATE that makes concurrent generations safe without a lock.
 */
export const workspaceBalances = pgTable("workspace_balances", {
  workspaceId: uuid("workspace_id")
    .primaryKey()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  planSlug: text("plan_slug").notNull().default("free"),
  planWordsRemaining: integer("plan_words_remaining").notNull().default(0),
  topupWordsRemaining: integer("topup_words_remaining").notNull().default(0),
  /** Reserved by generations that have started but not finished. */
  wordsHeld: integer("words_held").notNull().default(0),
  periodStart: timestamp("period_start").notNull().defaultNow(),
  periodEnd: timestamp("period_end"),
  updatedAt: updatedAtColumn(),
});

/**
 * Who the payment provider thinks this workspace is.
 *
 * `provider` is a column rather than an assumption because the marketplace
 * this product wants eventually cannot run on Polar — their acceptable-use
 * policy prohibits selling other people's work through your account — so a
 * second provider alongside this one is a matter of when, not if.
 */
export const billingCustomers = pgTable("billing_customers", {
  workspaceId: uuid("workspace_id")
    .primaryKey()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  provider: text("provider").notNull().default("polar"),
  /** Their id for our workspace. We are their `external_id` in return. */
  providerCustomerId: text("provider_customer_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: updatedAtColumn(),
});

/**
 * The subscription as the provider last described it.
 *
 * A cache, not a source of truth — the provider is. It exists so that reading
 * a workspace's plan is a local query rather than a network call on the path
 * of every generation.
 */
export const billingSubscriptions = pgTable("billing_subscriptions", {
  workspaceId: uuid("workspace_id")
    .primaryKey()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  provider: text("provider").notNull().default("polar"),
  providerSubscriptionId: text("provider_subscription_id").notNull(),
  providerProductId: text("provider_product_id").notNull().default(""),
  planSlug: text("plan_slug").notNull(),
  /** Verbatim from the provider; interpreted by the billing layer, not here. */
  status: text("status").notNull(),
  currentPeriodStart: timestamp("current_period_start"),
  currentPeriodEnd: timestamp("current_period_end"),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  updatedAt: updatedAtColumn(),
});

/**
 * Webhook deliveries already seen, keyed by the provider's own event id.
 *
 * Polar retries up to ten times and guarantees no ordering, so the same event
 * arriving twice is routine rather than exceptional. The balance movements are
 * separately idempotent; this stops the cheaper work from repeating too, and
 * gives support something to point at when asked whether an event arrived.
 */
export const billingWebhookEvents = pgTable("billing_webhook_events", {
  /** The `webhook-id` header — stable across every retry of one event. */
  id: text("id").primaryKey(),
  provider: text("provider").notNull().default("polar"),
  type: text("type").notNull(),
  receivedAt: timestamp("received_at").notNull().defaultNow(),
});

export const WORD_LEDGER_REASONS = [
  "grant",
  "hold",
  "settle",
  "release",
  "expire",
  "refund",
] as const;

/**
 * Append-only record of every movement, for support and reconciliation.
 *
 * The balance above is the authority on what can be spent; this is the audit
 * trail explaining how it got there. Keeping them separate is deliberate — a
 * ledger you have to sum to answer "can this generation run" is a ledger you
 * end up caching, and then the cache is the real balance anyway.
 */
export const wordLedger = pgTable(
  "word_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    /** Negative debits, positive credits. `plan_delta + topup_delta`. */
    delta: integer("delta").notNull(),
    /**
     * How the movement split across the two counters.
     *
     * Recorded because a release has to put words back where they came from.
     * Refunding a top-up-funded hold into the plan counter would quietly
     * convert words somebody paid for outright into words that expire at the
     * end of the month.
     */
    planDelta: integer("plan_delta").notNull().default(0),
    topupDelta: integer("topup_delta").notNull().default(0),
    reason: text("reason", { enum: WORD_LEDGER_REASONS }).notNull(),
    /**
     * Stable per logical operation: a generation's hold and settle share one,
     * and a Polar order uses `polar_order:<id>`. Combined with the unique index
     * below this is what makes a redelivered webhook a no-op.
     */
    requestId: text("request_id").notNull(),
    generationId: uuid("generation_id").references(() => aiGenerations.id, {
      onDelete: "set null",
    }),
    note: text("note").notNull().default(""),
    planWordsAfter: integer("plan_words_after").notNull().default(0),
    topupWordsAfter: integer("topup_words_after").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("word_ledger_idempotency_idx").on(
      t.workspaceId,
      t.requestId,
      t.reason,
    ),
    index("word_ledger_workspace_idx").on(t.workspaceId, t.createdAt),
    // Drives the sweep that releases holds abandoned by a dropped connection.
    index("word_ledger_reason_idx").on(t.reason, t.createdAt),
  ],
);

/**
 * One row per author decision on an AI prose suggestion. Rating and comment
 * remain nullable because most decisions are sampled rather than interrupted.
 */
export const aiSuggestionFeedback = pgTable(
  "ai_suggestion_feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    suggestionId: uuid("suggestion_id").notNull().unique(),
    novelId: uuid("novel_id")
      .notNull()
      .references(() => novels.id, { onDelete: "cascade" }),
    chapterId: uuid("chapter_id").references(() => chapters.id, {
      onDelete: "set null",
    }),
    decision: text("decision", { enum: AI_SUGGESTION_DECISIONS }).notNull(),
    mode: text("mode", { enum: AI_SUGGESTION_MODES }).notNull(),
    route: text("route").notNull(),
    label: text("label").notNull(),
    suggestionText: text("suggestion_text").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    feedbackPrompted: boolean("feedback_prompted").notNull().default(false),
    rating: integer("rating"),
    comment: text("comment"),
    decidedAt: timestamp("decided_at").notNull().defaultNow(),
    feedbackSubmittedAt: timestamp("feedback_submitted_at"),
  },
  (t) => [
    index("ai_suggestion_feedback_novel_idx").on(t.novelId),
    index("ai_suggestion_feedback_chapter_idx").on(t.chapterId),
    index("ai_suggestion_feedback_decision_idx").on(t.novelId, t.decision),
    check(
      "ai_suggestion_feedback_rating_range",
      sql`${t.rating} is null or (${t.rating} >= 1 and ${t.rating} <= 5)`,
    ),
  ],
);

export type User = typeof users.$inferSelect;
export type WritingGoal = (typeof WRITING_GOAL_VALUES)[number];
export type Novel = typeof novels.$inferSelect;
export type NovelDraft = typeof novelDrafts.$inferSelect;
export type Character = typeof characters.$inferSelect;
export type Relationship = typeof relationships.$inferSelect;
export type StoryEvent = typeof storyEvents.$inferSelect;
export type RelType = (typeof REL_TYPE_VALUES)[number];
export type CharStatus = (typeof CHAR_STATUS_VALUES)[number];
export type EventImpact = (typeof EVENT_IMPACT_VALUES)[number];
export type Location = typeof locations.$inferSelect;
export type LocationLink = typeof locationLinks.$inferSelect;
export type Chapter = typeof chapters.$inferSelect;
export type StoryElement = typeof storyElements.$inferSelect;
export type CharacterFact = typeof characterFacts.$inferSelect;
export type ChapterRevision = typeof chapterRevisions.$inferSelect;
export type CanonChunk = typeof canonChunks.$inferSelect;
export type AiGeneration = typeof aiGenerations.$inferSelect;
export type AiSuggestionFeedback = typeof aiSuggestionFeedback.$inferSelect;
export type Workspace = typeof workspaces.$inferSelect;
export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
export type WorkspaceRole = (typeof WORKSPACE_ROLE_VALUES)[number];
export type WorkspaceBalance = typeof workspaceBalances.$inferSelect;
export type WordLedgerEntry = typeof wordLedger.$inferSelect;
export type WordLedgerReason = (typeof WORD_LEDGER_REASONS)[number];
export type UsageSource = (typeof USAGE_SOURCE_VALUES)[number];
export type BillingCustomer = typeof billingCustomers.$inferSelect;
export type BillingSubscription = typeof billingSubscriptions.$inferSelect;

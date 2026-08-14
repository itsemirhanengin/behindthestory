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
  vector,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

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
    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at"),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
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

export const novels = pgTable("novels", {
  id: uuid("id").primaryKey().defaultRandom(),
  /**
   * The single ownership edge for the whole graph. Every other table reaches a
   * novel through `novel_id`, so authorisation is one check here rather than a
   * column on all thirteen tables.
   *
   * Nullable only to carry pre-auth rows across; a null owner is unreachable
   * for every caller until `db:claim` assigns it.
   */
  ownerId: uuid("owner_id").references(() => users.id, {
    onDelete: "cascade",
  }),
  title: text("title").notNull(),
  premise: text("premise").notNull().default(""),

  // --- Style profile: compiled into every AI prompt for this novel. ---------
  genre: text("genre").notNull().default(""),
  /** Freeform mood descriptors, e.g. "bleak, wry, slow-burn dread". */
  tone: text("tone").notNull().default(""),
  pov: text("pov", { enum: POV_VALUES }).notNull().default("third_limited"),
  tense: text("tense", { enum: TENSE_VALUES }).notNull().default("past"),
  targetChapterWords: integer("target_chapter_words").notNull().default(1800),
  /** Prose rules, influences, things to avoid. Passed through verbatim. */
  styleNotes: text("style_notes").notNull().default(""),

  createdAt: timestamp("created_at").notNull().defaultNow(),
});

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

/** Usage log for every AI call, so generation cost is visible rather than magic. */
export const aiGenerations = pgTable(
  "ai_generations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    novelId: uuid("novel_id")
      .notNull()
      .references(() => novels.id, { onDelete: "cascade" }),
    chapterId: uuid("chapter_id").references(() => chapters.id, {
      onDelete: "set null",
    }),
    /** Which endpoint produced this, e.g. "chapter", "inline", "continuity". */
    route: text("route").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    durationMs: integer("duration_ms").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("ai_generations_novel_idx").on(t.novelId)],
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

export type Novel = typeof novels.$inferSelect;
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

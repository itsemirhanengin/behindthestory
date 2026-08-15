import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { generateText, Output } from "ai";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import {
  CHAR_STATUS_VALUES,
  EVENT_IMPACT_VALUES,
  REL_TYPE_VALUES,
  aiSuggestionFeedback,
  getDb,
} from "@behindthestory/db";
import { NOVELIST_PERSONA } from "@behindthestory/ai";
import {
  activeSpine,
  buildStoryContext,
  estimateTokens,
  loadNovelBundle,
} from "@behindthestory/core/context-builder";
import { buildSceneContext } from "@behindthestory/core/scene-context";
import {
  eventsByRelationship,
  relationshipStateAsOf,
} from "@behindthestory/core/story-state";

import { assertNovel, requireAuth, type AuthEnv } from "#middleware/auth";
import { openMeter } from "#lib/billing/meter";

const ISSUE_TYPES = [
  "contradiction",
  "continuity",
  "voice",
  "canon_drift",
  "unearned",
] as const;

const issueSchema = z.object({
  severity: z.enum(["high", "medium", "low"]),
  type: z.enum(ISSUE_TYPES).describe(
    [
      "contradiction: the text states something the story bible says is false (a dead character acting, a resolved thread re-planted, a changed fact)",
      "continuity: timeline, geography or object tracking does not add up against earlier chapters",
      "voice: a character speaks or behaves against their documented voice, motivation or arc",
      "canon_drift: prose breaks the style contract (POV, tense, tone)",
      "unearned: a turn happens with no setup anywhere in the established story",
    ].join("; "),
  ),
  quote: z
    .string()
    .describe(
      "The exact span of text from the chapter that is wrong, copied verbatim, at most one or two sentences. Must appear in the chapter character for character.",
    ),
  issue: z.string().describe("What is wrong, and what it contradicts"),
  suggestion: z.string().describe("A concrete fix the author could apply"),
});

export type ContinuityIssue = z.infer<typeof issueSchema>;

const analysisSchema = z.object({
  chapterSummary: z
    .string()
    .describe("3-5 sentence summary of what happens in this chapter"),
  newElements: z.array(
    z.object({
      type: z.enum(["twist", "foreshadowing", "plot_thread", "event"]),
      title: z.string(),
      description: z.string(),
      relatedCharacterIds: z.array(z.string()),
    }),
  ),
  resolvedElementIds: z
    .array(z.string())
    .describe("Ids of existing story elements that this chapter pays off / resolves"),
  relationshipUpdates: z.array(
    z.object({
      relationshipId: z.string(),
      newType: z
        .enum(REL_TYPE_VALUES)
        .describe(
          "What the bond IS after this chapter. Repeat the current type if the kind of bond did not change",
        ),
      closeness: z
        .number()
        .describe("1-10, how close/intense the bond is AFTER this chapter"),
      cause: z
        .string()
        .describe(
          "What in THIS chapter changed the bond. Concrete and specific, e.g. 'Marit pulled Ione out of the well and named her brother's killer'",
        ),
      driverCharacterIds: z
        .array(z.string())
        .describe("Who caused the change. Empty if circumstance, not a person"),
      impact: z
        .enum(EVENT_IMPACT_VALUES)
        .describe(
          "pivotal = the bond turned or the story pivoted on it; major = a real shift; minor = small drift",
        ),
    }),
  ),
  /**
   * Death, disappearance and return. Split out from facts because it is a state
   * change with a cause, and the cause is the part an author comes back for.
   */
  characterStatusChanges: z.array(
    z.object({
      characterId: z.string(),
      newStatus: z.enum(CHAR_STATUS_VALUES),
      cause: z
        .string()
        .describe(
          "Why the status changed, with the agency made explicit — 'shielded Ione from the fall' is very different from 'fell because Ione misread the tide'",
        ),
      driverCharacterIds: z
        .array(z.string())
        .describe(
          "Who is responsible, including the character themselves if it was their own choice",
        ),
      impact: z.enum(EVENT_IMPACT_VALUES),
    }),
  ),
  newRelationships: z.array(
    z.object({
      sourceCharacterId: z.string(),
      targetCharacterId: z.string(),
      type: z.enum(REL_TYPE_VALUES),
      closeness: z.number(),
      description: z.string(),
      cause: z.string().describe("What in this chapter established the bond"),
      impact: z.enum(EVENT_IMPACT_VALUES),
    }),
  ),
  characterFacts: z.array(
    z.object({
      characterId: z.string(),
      fact: z
        .string()
        .describe("New canon fact about this character revealed this chapter"),
    }),
  ),
});

export type ChapterAnalysis = z.infer<typeof analysisSchema>;

const suggestionSchema = z.object({
  suggestions: z.array(
    z.object({
      sourceCharacterId: z.string(),
      targetCharacterId: z.string(),
      type: z.enum(REL_TYPE_VALUES),
      closeness: z.number().describe("1-10, how close/intense the bond is"),
      description: z.string(),
      reasoning: z.string().describe("Which chapter events or facts support this"),
      // A bond enters the timeline somewhere. Guessing "chapter 1" for a pair
      // who only meet in chapter 40 would backdate the relationship across the
      // whole novel, so the model is asked where it actually starts.
      startChapterNumber: z
        .number()
        .describe(
          "The earliest chapter where this bond is evident. Use 0 if it predates the novel (e.g. family, shared history)",
        ),
    }),
  ),
});

/** Ceiling for the raw chapter prose used as evidence, in estimated tokens. */
const EVIDENCE_BUDGET = 30_000;

function shouldRequestFeedback(
  decision: "accepted" | "rejected",
  decisionCount: number,
) {
  if (decisionCount === 1) return true;
  return decision === "rejected"
    ? decisionCount % 3 === 0
    : decisionCount % 9 === 0;
}

export const aiReviewRoutes = new Hono<AuthEnv>()
  .use("*", requireAuth)
  /**
   * Reads a chapter against the story bible and reports where it breaks canon.
   * Extraction (the analyze route) records what a chapter established; this asks
   * the opposite question — what did it get wrong?
   */
  .post(
    "/continuity",
    zValidator("json", z.object({ novelId: z.uuid(), chapterId: z.uuid() })),
    async (c) => {
      const { novelId, chapterId } = c.req.valid("json");
      await assertNovel(c.get("user").id, novelId);

      const { chapter, context } = await buildSceneContext({
        novelId,
        chapterId,
        // Retrieval is steered by the chapter's own prose: pull up whatever the
        // earlier text says about the same people, places and objects.
        draftTail: "",
      });
      if (!chapter) throw new HTTPException(404, { message: "Chapter not found" });
      if (!chapter.content.trim()) return c.json({ issues: [] });

      const meter = await openMeter({
        userId: c.get("user").id,
        route: "continuity",
        novelId,
      });
      const { output, usage } = await generateText({
        model: meter.model,
        maxOutputTokens: meter.maxOutputTokens,
        instructions:
          NOVELIST_PERSONA +
          ` You are acting as a continuity editor, not a writing coach. Report only concrete, checkable conflicts against the provided story context — never taste, pacing or general suggestions for improvement. Every quote must be copied verbatim from the chapter. If the chapter is consistent, return an empty list; a clean chapter is a valid and common result.`,
        output: Output.object({ schema: z.object({ issues: z.array(issueSchema) }) }),
        prompt: `${context.text}

---
## Chapter ${chapter.number}: "${chapter.title}" — the text to check
${chapter.content}

---
Task: Find every place where this chapter conflicts with the story context above — established character facts and status, relationship state, resolved or planted threads, timeline and geography, documented character voice, and the binding style contract. Order the issues by severity.`,
      }).catch(meter.abort);

      await meter.settle({ usage, chapterId });

      // The model occasionally paraphrases a quote; a quote that is not in the
      // chapter cannot be highlighted, so mark it rather than silently failing.
      return c.json({
        issues: output.issues.map((issue) => ({
          ...issue,
          locatable: chapter.content.includes(issue.quote.trim()),
        })),
      });
    },
  )
  .post(
    "/analyze",
    zValidator("json", z.object({ novelId: z.uuid(), chapterId: z.uuid() })),
    async (c) => {
      const { novelId, chapterId } = c.req.valid("json");
      await assertNovel(c.get("user").id, novelId);

      const bundle = await loadNovelBundle(novelId);
      const chapter = bundle.chapters.find((ch) => ch.id === chapterId);
      if (!chapter || !chapter.content.trim()) {
        return c.json({ error: "chapter not found or empty" }, 400);
      }

      const context = buildStoryContext(bundle, { currentChapter: chapter });
      const roster = bundle.characters.map((ch) => `${ch.id} = ${ch.name}`).join("\n");
      // The state going *into* this chapter, so the model reports what the
      // chapter changed rather than restating what was already true.
      const asOf = chapter.number - 1;
      const relEventsById = eventsByRelationship(bundle.storyEvents);
      const relRoster = bundle.relationships
        .flatMap((r) => {
          const state = relationshipStateAsOf(relEventsById.get(r.id) ?? [], asOf);
          if (!state) return []; // not formed yet as of this chapter
          const a = bundle.characters.find((ch) => ch.id === r.sourceCharacterId);
          const b = bundle.characters.find((ch) => ch.id === r.targetCharacterId);
          return [
            `${r.id} = ${a?.name} ↔ ${b?.name} — entering this chapter: ${state.type}, closeness ${state.closeness}/10`,
          ];
        })
        .join("\n");
      const elementRoster = bundle.storyElements
        .filter((e) => e.status !== "resolved")
        .map((e) => `${e.id} = [${e.type}] ${e.title}`)
        .join("\n");

      const meter = await openMeter({
        userId: c.get("user").id,
        route: "analyze",
        novelId,
      });
      const { output, usage } = await generateText({
        model: meter.model,
        maxOutputTokens: meter.maxOutputTokens,
        instructions:
          NOVELIST_PERSONA +
          ` You are acting as a meticulous story-bible keeper. Extract only what the chapter text actually establishes. Use ONLY the ids provided in the rosters; never invent ids. If nothing applies to a category, return an empty array for it.` +
          ` Relationship and status changes are recorded as a timeline the author will read hundreds of chapters later, so every one needs a CAUSE — what in this chapter did it — and, where a person is responsible, who. Report a change only if this chapter actually moved it; unchanged bonds belong in no array at all.`,
        output: Output.object({ schema: analysisSchema }),
        prompt: `${context.text}\n\n## Character ids\n${roster}\n\n## Relationship ids and their state entering this chapter\n${relRoster || "(none)"}\n\n## Open story element ids\n${elementRoster || "(none)"}\n\n---\n## Chapter ${chapter.number}: "${chapter.title}" — full text to analyze\n${chapter.content}\n\n---\nTask: Analyze this chapter and extract story-memory updates: a summary, new story elements (twists, planted foreshadowing, plot threads, notable events), which open elements it resolves, relationship changes (with their cause), character status changes such as a death or disappearance (with who is responsible and how), brand-new relationships, and new character facts.`,
      }).catch(meter.abort);

      await meter.settle({ usage, chapterId });

      return c.json(output);
    },
  )
  .post(
    "/relationships",
    zValidator("json", z.object({ novelId: z.uuid() })),
    async (c) => {
      const { novelId } = c.req.valid("json");
      await assertNovel(c.get("user").id, novelId);

      const bundle = await loadNovelBundle(novelId);
      const context = buildStoryContext(bundle);
      const roster = bundle.characters.map((ch) => `${ch.id} = ${ch.name}`).join("\n");
      const existingPairs = new Set(
        bundle.relationships.flatMap((r) => [
          `${r.sourceCharacterId}:${r.targetCharacterId}`,
          `${r.targetCharacterId}:${r.sourceCharacterId}`,
        ]),
      );

      // Newest chapters are the best evidence for what a relationship is *now*,
      // so they get the full text and older ones degrade to their summary.
      const written = activeSpine(bundle.chapters).filter((ch) => ch.content.trim());
      const blocks: string[] = [];
      let spent = 0;
      let degraded = 0;
      for (const ch of [...written].reverse()) {
        const full = `### Chapter ${ch.number}: ${ch.title}\n${ch.content}`;
        const cost = estimateTokens(full);
        if (spent + cost <= EVIDENCE_BUDGET) {
          blocks.unshift(full);
          spent += cost;
        } else {
          degraded++;
          if (ch.summary) {
            blocks.unshift(
              `### Chapter ${ch.number}: ${ch.title} (summary only)\n${ch.summary}`,
            );
          }
        }
      }
      const evidence = blocks.length
        ? blocks.join("\n\n") +
          (degraded
            ? `\n\n(${degraded} earlier chapter(s) shown as summary only to stay within the context budget)`
            : "")
        : "(no chapters written yet — infer from character profiles and premise)";

      const meter = await openMeter({
        userId: c.get("user").id,
        route: "relationships",
        novelId,
      });
      const { output, usage } = await generateText({
        model: meter.model,
        maxOutputTokens: meter.maxOutputTokens,
        instructions: NOVELIST_PERSONA,
        output: Output.object({ schema: suggestionSchema }),
        prompt: `${context.text}\n\n## Chapter evidence\n${evidence}\n\n---\nTask: Suggest relationships between characters that are implied by the story but NOT yet recorded in the Relationships section. Use ONLY these character ids:\n${roster}\n\nDo not suggest a pair that already has a relationship. Return an empty list if nothing new is implied.`,
      }).catch(meter.abort);

      await meter.settle({ usage });

      const validIds = new Set(bundle.characters.map((ch) => ch.id));
      return c.json({
        suggestions: output.suggestions.filter(
          (s) =>
            validIds.has(s.sourceCharacterId) &&
            validIds.has(s.targetCharacterId) &&
            s.sourceCharacterId !== s.targetCharacterId &&
            !existingPairs.has(`${s.sourceCharacterId}:${s.targetCharacterId}`),
        ),
      });
    },
  )
  /** Record every accept/reject so sampling remains stable across sessions. */
  .post(
    "/feedback",
    zValidator(
      "json",
      z.object({
        suggestionId: z.uuid(),
        novelId: z.uuid(),
        chapterId: z.uuid(),
        decision: z.enum(["accepted", "rejected"]),
        mode: z.enum(["insert", "replace"]),
        route: z.string().min(1).max(80),
        label: z.string().min(1).max(160),
        suggestionText: z.string().min(1).max(100_000),
        inputTokens: z.number().int().nonnegative().default(0),
        outputTokens: z.number().int().nonnegative().default(0),
      }),
    ),
    async (c) => {
      const input = c.req.valid("json");
      await assertNovel(c.get("user").id, input.novelId);

      const db = getDb();
      const [existing] = await db
        .select({
          id: aiSuggestionFeedback.id,
          feedbackPrompted: aiSuggestionFeedback.feedbackPrompted,
        })
        .from(aiSuggestionFeedback)
        .where(eq(aiSuggestionFeedback.suggestionId, input.suggestionId));

      if (existing) {
        return c.json({ id: existing.id, shouldPrompt: existing.feedbackPrompted });
      }

      const [totals] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(aiSuggestionFeedback)
        .where(
          and(
            eq(aiSuggestionFeedback.novelId, input.novelId),
            eq(aiSuggestionFeedback.decision, input.decision),
          ),
        );
      const decisionCount = (totals?.count ?? 0) + 1;
      const feedbackPrompted = shouldRequestFeedback(input.decision, decisionCount);

      const [row] = await db
        .insert(aiSuggestionFeedback)
        .values({ ...input, feedbackPrompted })
        .returning({ id: aiSuggestionFeedback.id });

      return c.json({ id: row.id, shouldPrompt: feedbackPrompted, decisionCount }, 201);
    },
  )
  /** Attach the optional sampled rating and written feedback to its decision. */
  .patch(
    "/feedback",
    zValidator(
      "json",
      z.object({
        id: z.uuid(),
        rating: z.number().int().min(1).max(5),
        comment: z.string().trim().max(2_000).default(""),
      }),
    ),
    async (c) => {
      const { id, rating, comment } = c.req.valid("json");

      // Scoped to a row whose novel this account owns — without the join a
      // caller could rate another writer's suggestions by guessing ids.
      const db = getDb();
      const [target] = await db
        .select({ novelId: aiSuggestionFeedback.novelId })
        .from(aiSuggestionFeedback)
        .where(eq(aiSuggestionFeedback.id, id));
      if (!target) throw new HTTPException(404, { message: "Feedback event not found" });
      await assertNovel(c.get("user").id, target.novelId);

      await db
        .update(aiSuggestionFeedback)
        .set({
          rating,
          comment: comment || null,
          feedbackSubmittedAt: new Date(),
        })
        .where(eq(aiSuggestionFeedback.id, id));

      return c.json({ ok: true });
    },
  );

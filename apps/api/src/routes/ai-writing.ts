import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { streamText } from "ai";
import { z } from "zod";

import { MODELS, NOVELIST_PERSONA, logGeneration } from "@behindthestory/ai";
import { proseStreamResponse } from "@behindthestory/core/prose-stream";
import { buildSceneContext } from "@behindthestory/core/scene-context";

import { assertNovel, requireAuth, type AuthEnv } from "#middleware/auth";

const INLINE_ACTIONS = {
  rewrite: {
    label: "Rewrite",
    directive:
      "Rewrite the passage. Keep every story beat and fact identical; change only the prose — rhythm, word choice, imagery. Roughly the same length.",
  },
  expand: {
    label: "Expand",
    directive:
      "Expand the passage. Slow it down: add sensory detail, interiority and beats of physical action that were skipped. Roughly two to three times the length. Introduce no new plot facts.",
  },
  shorten: {
    label: "Tighten",
    directive:
      "Tighten the passage. Cut throat-clearing, redundant beats and adverbs. Keep every story fact. Roughly half the length.",
  },
  dialogue: {
    label: "Sharpen dialogue",
    directive:
      "Sharpen the dialogue. Give each speaker their documented voice, cut on-the-nose lines, let subtext carry the meaning, and trim dialogue tags to what is needed for clarity.",
  },
  describe: {
    label: "Deepen setting",
    directive:
      "Deepen the setting. Ground the passage in the physical place using the documented atmosphere of the location. Keep the action and dialogue intact.",
  },
} as const;

type InlineAction = keyof typeof INLINE_ACTIONS;

const selectionFields = {
  selectedCharacterIds: z.array(z.uuid()).default([]),
  selectedLocationIds: z.array(z.uuid()).default([]),
  selectedElementIds: z.array(z.uuid()).default([]),
};

/**
 * The two streaming routes.
 *
 * `proseStreamResponse` already returns a web `Response`, so Hono hands it
 * straight back — the token stream is untouched by the framework, which is what
 * keeps the editor's typing effect intact end to end.
 */
export const aiWritingRoutes = new Hono<AuthEnv>()
  .use("*", requireAuth)
  .post(
    "/chapter",
    zValidator(
      "json",
      z.object({
        novelId: z.uuid(),
        chapterId: z.uuid(),
        instruction: z.string().max(4000).optional(),
        ...selectionFields,
        existingContent: z.string().default(""),
        placement: z.enum(["cursor", "end"]).default("end"),
        before: z.string().max(5000).default(""),
        after: z.string().max(5000).default(""),
        /** When set, the model writes only this beat rather than the whole chapter. */
        beatId: z.string().optional(),
      }),
    ),
    async (c) => {
      const {
        novelId,
        chapterId,
        instruction,
        selectedCharacterIds,
        selectedLocationIds,
        selectedElementIds,
        existingContent,
        placement,
        before,
        after,
        beatId,
      } = c.req.valid("json");
      await assertNovel(c.get("user").id, novelId);

      const started = Date.now();
      let generationRoute = "chapter";

      return proseStreamResponse(
        async ({ status }) => {
          status("context", "Building story context");
          const { chapter, context, retrievedCount } = await buildSceneContext({
            novelId,
            chapterId,
            selectedCharacterIds,
            selectedLocationIds,
            selectedElementIds,
            instruction,
            draftTail: placement === "cursor" ? before : existingContent,
          });
          if (!chapter) throw new Error("Chapter not found");

          const beat = beatId
            ? chapter.beats.find((candidate) => candidate.id === beatId)
            : undefined;
          const draft = existingContent.trim();
          generationRoute = beat ? "chapter:beat" : "chapter";

          let task: string;
          if (placement === "cursor") {
            task = `Write a new passage at the marked insertion point inside Chapter ${chapter.number} ("${chapter.title}").${beat ? ` Cover exactly this beat and no further:\n\n> ${beat.text}\n` : ""}

### Immediately before the insertion point
${before || "(this is the start of the chapter)"}

### Immediately after the insertion point
${after || "(this is the end of the chapter)"}

Join seamlessly at both edges. Do not repeat either surrounding passage. Output only the new prose.`;
          } else if (beat) {
            task = draft
              ? `Write the next passage of Chapter ${chapter.number} ("${chapter.title}"), covering exactly this beat and no further:\n\n> ${beat.text}\n\nContinue seamlessly from where the draft below stops. Do not repeat or rewrite what is already there — output only the new passage.\n\n## Draft so far\n${draft}`
              : `Open Chapter ${chapter.number} ("${chapter.title}") by writing exactly this beat and no further:\n\n> ${beat.text}`;
          } else if (draft) {
            task = `Continue Chapter ${chapter.number} ("${chapter.title}") from where the draft below stops. Write the next passage seamlessly — do not repeat or rewrite what is already there, output only the continuation.\n\n## Draft so far\n${draft}`;
          } else {
            task = `Write the opening passage of Chapter ${chapter.number} ("${chapter.title}"). Produce polished narrative prose with dialogue where natural. Establish the scene and stop at a natural handoff point.`;
          }

          status(
            "model",
            retrievedCount
              ? `Context ready · ${retrievedCount} earlier passage${retrievedCount === 1 ? "" : "s"} retrieved`
              : "Context ready",
          );
          const result = streamText({
            model: MODELS.writing,
            abortSignal: c.req.raw.signal,
            instructions:
              NOVELIST_PERSONA +
              ` Obey the style contract exactly. Output only the chapter prose itself — no headings, no meta commentary, no author notes. Use Markdown only for emphasis and scene breaks (---); never wrap the prose in code fences.`,
            prompt: `${context.text}\n\n---\n${task}${instruction ? `\n\nAuthor's direction for this passage: ${instruction}` : ""}`,
          });
          return result.fullStream;
        },
        {
          onFinish: (usage) =>
            logGeneration({
              novelId,
              chapterId,
              route: generationRoute,
              model: MODELS.writing,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              durationMs: Date.now() - started,
            }),
        },
      );
    },
  )
  .post(
    "/inline",
    zValidator(
      "json",
      z.object({
        novelId: z.uuid(),
        chapterId: z.uuid(),
        action: z.enum(
          Object.keys(INLINE_ACTIONS) as [InlineAction, ...InlineAction[]],
        ),
        selection: z.string().min(1).max(20_000),
        /** Surrounding prose, so the rewrite joins seamlessly at both edges. */
        before: z.string().max(4000).default(""),
        after: z.string().max(4000).default(""),
        instruction: z.string().max(2000).optional(),
        ...selectionFields,
      }),
    ),
    async (c) => {
      const {
        novelId,
        chapterId,
        action,
        selection,
        before,
        after,
        instruction,
        selectedCharacterIds,
        selectedLocationIds,
        selectedElementIds,
      } = c.req.valid("json");
      await assertNovel(c.get("user").id, novelId);

      const started = Date.now();
      return proseStreamResponse(
        async ({ status }) => {
          status("context", "Building story context");
          const { chapter, context, retrievedCount } = await buildSceneContext({
            novelId,
            chapterId,
            selectedCharacterIds,
            selectedLocationIds,
            selectedElementIds,
            instruction,
            // Retrieval is steered by the passage being revised, not the tail.
            draftTail: selection,
            // The surrounding prose is supplied directly, so the parent tail
            // would only duplicate context. Trim the budget accordingly.
            budgetTokens: 20_000,
          });
          if (!chapter) throw new Error("Chapter not found");

          status(
            "model",
            retrievedCount
              ? `Context ready · ${retrievedCount} earlier passage${retrievedCount === 1 ? "" : "s"} retrieved`
              : "Context ready",
          );
          const result = streamText({
            model: MODELS.writing,
            abortSignal: c.req.raw.signal,
            instructions:
              NOVELIST_PERSONA +
              ` You are revising one passage inside an existing chapter. Obey the style contract. Output ONLY the replacement prose — no preamble, no explanation, no quotation marks around it, no code fences. It must read seamlessly against the text before and after it.`,
            prompt: `${context.text}

---
## The passage sits inside Chapter ${chapter.number} ("${chapter.title}")

### Immediately before (do not rewrite, do not repeat)
${before || "(this is the start of the chapter)"}

### The passage to revise
${selection}

### Immediately after (do not rewrite, do not repeat)
${after || "(this is the end of the chapter)"}

---
Task: ${INLINE_ACTIONS[action].directive}${instruction ? `\n\nAuthor's direction: ${instruction}` : ""}`,
          });
          return result.fullStream;
        },
        {
          onFinish: (usage) =>
            logGeneration({
              novelId,
              chapterId,
              route: `inline:${action}`,
              model: MODELS.writing,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              durationMs: Date.now() - started,
            }),
        },
      );
    },
  );

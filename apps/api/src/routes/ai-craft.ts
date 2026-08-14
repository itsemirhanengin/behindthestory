import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { generateText, Output } from "ai";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { POV_VALUES, TENSE_VALUES, getDb, novels } from "@behindthestory/db";
import { MODELS, NOVELIST_PERSONA, logGeneration } from "@behindthestory/ai";
import {
  buildStoryContext,
  loadNovelBundle,
} from "@behindthestory/core/context-builder";
import { buildSceneContext } from "@behindthestory/core/scene-context";

import { assertNovel, requireAuth, type AuthEnv } from "#middleware/auth";

const selectionFields = {
  selectedCharacterIds: z.array(z.uuid()).default([]),
  selectedLocationIds: z.array(z.uuid()).default([]),
  selectedElementIds: z.array(z.uuid()).default([]),
};

const characterSchema = z.object({
  name: z.string(),
  role: z.enum(["main", "side", "minor"]),
  summary: z.string().describe("One or two sentences capturing the character"),
  backstory: z.string().describe("2-4 paragraphs of backstory"),
  traits: z.array(z.string()).describe("3-6 personality traits"),
  appearance: z.string(),
  secrets: z
    .string()
    .describe("Hidden motives or secrets, usable for future twists"),
  voice: z
    .string()
    .describe(
      "How this character speaks: diction, rhythm, verbal tics, what they never say",
    ),
  speechSample: z
    .string()
    .describe(
      "Two or three example lines of their dialogue, one per line, no quotation marks",
    ),
  motivation: z.string().describe("What they want right now, in one sentence"),
  arc: z.string().describe("Where they are headed across the novel"),
});

const locationSchema = z.object({
  name: z.string(),
  description: z.string().describe("1-2 paragraphs describing the place"),
  atmosphere: z.string().describe("Mood and sensory feel, a short phrase"),
  significance: z.string().describe("Why this place matters to the story"),
});

const styleSchema = z.object({
  genre: z.string().describe("Genre and subgenre, e.g. 'literary thriller'"),
  tone: z.string().describe("Three to five mood descriptors, comma separated"),
  pov: z.enum(POV_VALUES),
  tense: z.enum(TENSE_VALUES),
  targetChapterWords: z
    .number()
    .describe("Sensible chapter length for this genre, between 800 and 5000"),
  styleNotes: z
    .string()
    .describe(
      "Concrete prose rules for this novel: sentence rhythm, imagery density, dialogue style, comparable authors, and what to avoid. Written as directives to a writer.",
    ),
});

const outlineSchema = z.object({
  title: z
    .string()
    .describe("A chapter title that does not give away the ending"),
  outline: z
    .string()
    .describe(
      "Two or three sentences: what this chapter is for in the novel, and how it moves the story",
    ),
  beats: z
    .array(z.string())
    .describe(
      "4-8 beats, each one sentence describing a concrete unit of action, in order. Not summary — what actually happens on the page.",
    ),
});

export const aiCraftRoutes = new Hono<AuthEnv>()
  .use("*", requireAuth)
  /**
   * Returns exactly what the model would be shown for the current selection.
   * The point is that "what does the AI actually know?" stops being a guess.
   */
  .post(
    "/context",
    zValidator(
      "json",
      z.object({
        novelId: z.uuid(),
        chapterId: z.uuid().optional(),
        ...selectionFields,
        instruction: z.string().max(4000).optional(),
        draftTail: z.string().max(8000).optional(),
      }),
    ),
    async (c) => {
      const body = c.req.valid("json");
      await assertNovel(c.get("user").id, body.novelId);

      const { context, retrievedCount } = await buildSceneContext(body);
      return c.json({ ...context, retrievedCount });
    },
  )
  .post(
    "/character",
    zValidator(
      "json",
      z.object({
        novelId: z.uuid(),
        characterId: z.uuid().optional(),
        hint: z.string().max(2000).optional(),
      }),
    ),
    async (c) => {
      const { novelId, characterId, hint } = c.req.valid("json");
      await assertNovel(c.get("user").id, novelId);

      const bundle = await loadNovelBundle(novelId);
      const context = buildStoryContext(bundle);
      const existing = characterId
        ? bundle.characters.find((ch) => ch.id === characterId)
        : undefined;

      const task = existing
        ? `Enrich the existing character "${existing.name}". Keep every already-filled field consistent (you may polish wording, never contradict). Fill in the empty fields with compelling material that fits the story. Current data: ${JSON.stringify(
            {
              name: existing.name,
              role: existing.role,
              summary: existing.summary,
              backstory: existing.backstory,
              traits: existing.traits,
              appearance: existing.appearance,
              secrets: existing.secrets,
              voice: existing.voice,
              speechSample: existing.speechSample,
              motivation: existing.motivation,
              arc: existing.arc,
            },
          )}`
        : `Invent a brand-new character that would enrich this story. They must not duplicate an existing character.`;

      const started = Date.now();
      const { output, usage } = await generateText({
        model: MODELS.writing,
        instructions:
          NOVELIST_PERSONA +
          ` The voice and speechSample fields matter most: they are what stops every character in this novel sounding like the same narrator. Make them specific and distinguishable from the existing cast.`,
        output: Output.object({ schema: characterSchema }),
        prompt: `${context.text}\n\n---\nTask: ${task}${hint ? `\nAuthor's direction: ${hint}` : ""}`,
      });

      await logGeneration({
        novelId,
        route: "character",
        model: MODELS.writing,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        durationMs: Date.now() - started,
      });

      return c.json(output);
    },
  )
  .post(
    "/location",
    zValidator(
      "json",
      z.object({
        novelId: z.uuid(),
        locationId: z.uuid().optional(),
        hint: z.string().max(2000).optional(),
      }),
    ),
    async (c) => {
      const { novelId, locationId, hint } = c.req.valid("json");
      await assertNovel(c.get("user").id, novelId);

      const bundle = await loadNovelBundle(novelId);
      const context = buildStoryContext(bundle);
      const existing = locationId
        ? bundle.locations.find((l) => l.id === locationId)
        : undefined;

      const task = existing
        ? `Enrich the existing location "${existing.name}". Never contradict filled fields; fill the empty ones. Current data: ${JSON.stringify(
            {
              name: existing.name,
              description: existing.description,
              atmosphere: existing.atmosphere,
              significance: existing.significance,
            },
          )}`
        : `Invent a new location that fits this story and would be a compelling setting for future scenes.`;

      const started = Date.now();
      const { output, usage } = await generateText({
        model: MODELS.writing,
        instructions: NOVELIST_PERSONA,
        output: Output.object({ schema: locationSchema }),
        prompt: `${context.text}\n\n---\nTask: ${task}${hint ? `\nAuthor's direction: ${hint}` : ""}`,
      });

      await logGeneration({
        novelId,
        route: "location",
        model: MODELS.writing,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        durationMs: Date.now() - started,
      });

      return c.json(output);
    },
  )
  /** Proposes a style profile from the premise. The author always confirms it. */
  .post("/style", zValidator("json", z.object({ novelId: z.uuid() })), async (c) => {
    const { novelId } = c.req.valid("json");
    await assertNovel(c.get("user").id, novelId);

    const [novel] = await getDb()
      .select()
      .from(novels)
      .where(eq(novels.id, novelId));
    if (!novel.premise.trim()) {
      return c.json(
        { error: "Write a premise first — there is nothing to derive a style from." },
        400,
      );
    }

    const started = Date.now();
    const { output, usage } = await generateText({
      model: MODELS.writing,
      instructions:
        NOVELIST_PERSONA +
        ` You are advising on the house style for a new novel. Be opinionated and specific — a style profile that would fit any book is useless.`,
      output: Output.object({ schema: styleSchema }),
      prompt: `# Novel: ${novel.title}\nPremise: ${novel.premise}\n\n---\nTask: Propose the style profile this novel should be written in.`,
    });

    await logGeneration({
      novelId,
      route: "style",
      model: MODELS.writing,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      durationMs: Date.now() - started,
    });

    return c.json({
      ...output,
      targetChapterWords: Math.min(
        5000,
        Math.max(800, Math.round(output.targetChapterWords)),
      ),
    });
  })
  /**
   * Plans a chapter before a word of it is written. Turns one unguided
   * generation into plan → write, which the author can steer at the plan stage.
   */
  .post(
    "/outline",
    zValidator(
      "json",
      z.object({
        novelId: z.uuid(),
        chapterId: z.uuid(),
        instruction: z.string().max(4000).optional(),
        ...selectionFields,
      }),
    ),
    async (c) => {
      const { novelId, chapterId, instruction, ...selections } =
        c.req.valid("json");
      await assertNovel(c.get("user").id, novelId);

      const { chapter, context } = await buildSceneContext({
        novelId,
        chapterId,
        instruction,
        ...selections,
      });
      if (!chapter) throw new HTTPException(404, { message: "Chapter not found" });

      const started = Date.now();
      const { output, usage } = await generateText({
        model: MODELS.writing,
        instructions:
          NOVELIST_PERSONA +
          ` You are planning a chapter, not writing it. Beats must be concrete and dramatic — a thing that happens, not a theme. Advance at least one open thread from the story memory, and set up or pay off something. Respect the target chapter length when deciding how many beats fit.`,
        output: Output.object({ schema: outlineSchema }),
        prompt: `${context.text}

---
Task: Plan Chapter ${chapter.number}${chapter.title && chapter.title !== `Chapter ${chapter.number}` ? ` ("${chapter.title}")` : ""}.${instruction ? `\n\nAuthor's direction: ${instruction}` : ""}`,
      });

      await logGeneration({
        novelId,
        chapterId,
        route: "outline",
        model: MODELS.writing,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        durationMs: Date.now() - started,
      });

      return c.json(output);
    },
  );

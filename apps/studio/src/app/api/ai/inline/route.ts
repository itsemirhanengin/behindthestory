import { streamText } from "ai";
import { z } from "zod";
import { MODELS, NOVELIST_PERSONA, logGeneration } from "@/lib/ai";
import { buildSceneContext } from "@/lib/scene-context";
import { proseStreamResponse } from "@/lib/prose-stream";

export const maxDuration = 300;

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

const bodySchema = z.object({
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
  selectedCharacterIds: z.array(z.uuid()).default([]),
  selectedLocationIds: z.array(z.uuid()).default([]),
  selectedElementIds: z.array(z.uuid()).default([]),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json(
      { error: `Invalid request: ${parsed.error.issues[0]?.message}` },
      { status: 400 },
    );
  }
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
  } = parsed.data;

  const started = Date.now();
  return proseStreamResponse(async ({ status }) => {
    status("context", "Building story context");
    const { chapter, context, retrievedCount } = await buildSceneContext({
      novelId,
      chapterId,
      selectedCharacterIds,
      selectedLocationIds,
      selectedElementIds,
      instruction,
      // Retrieval is steered by the passage being revised, not the chapter tail.
      draftTail: selection,
      // The surrounding prose is supplied directly, so the parent tail would
      // only duplicate context. Trim the budget accordingly.
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
      abortSignal: req.signal,
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
  }, {
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
  });
}

import {
  loadNovelBundle,
  buildStoryContext,
  type BuiltContext,
  type NovelBundle,
} from "./context-builder";
import { buildRetrievalQuery, retrievePassages } from "./canon-index";
import type { Chapter } from "@/db";

export type SceneContextInput = {
  novelId: string;
  chapterId?: string;
  selectedCharacterIds?: string[];
  selectedLocationIds?: string[];
  selectedElementIds?: string[];
  /** The author's direction for this passage, used to steer retrieval. */
  instruction?: string;
  /** Tail of the draft, so retrieval matches where the prose actually is. */
  draftTail?: string;
  budgetTokens?: number;
  /** Set false for cheap calls that do not need earlier prose. */
  retrieve?: boolean;
};

/**
 * The one place that assembles everything a generation needs: the story bible,
 * the current selection, and the semantically retrieved prose from earlier
 * chapters. Every writing endpoint goes through here so they cannot drift.
 */
export async function buildSceneContext(input: SceneContextInput): Promise<{
  bundle: NovelBundle;
  chapter?: Chapter;
  context: BuiltContext;
  retrievedCount: number;
}> {
  const bundle = await loadNovelBundle(input.novelId);
  const chapter = input.chapterId
    ? bundle.chapters.find((ch) => ch.id === input.chapterId)
    : undefined;

  const selectedCharacterIds = input.selectedCharacterIds ?? [];
  const selectedLocationIds = input.selectedLocationIds ?? [];
  const selectedElementIds = input.selectedElementIds ?? [];

  let retrieved: Awaited<ReturnType<typeof retrievePassages>> = [];
  if (input.retrieve !== false) {
    const names = [
      ...bundle.characters
        .filter((c) => selectedCharacterIds.includes(c.id))
        .map((c) => c.name),
      ...bundle.locations
        .filter((l) => selectedLocationIds.includes(l.id))
        .map((l) => l.name),
      ...bundle.storyElements
        .filter((e) => selectedElementIds.includes(e.id))
        .map((e) => e.title),
    ];
    const query = buildRetrievalQuery({
      chapterTitle: chapter?.title,
      instruction: input.instruction,
      entityNames: names,
      draftTail: input.draftTail,
    });
    try {
      retrieved = await retrievePassages(input.novelId, query, {
        excludeChapterId: chapter?.id,
      });
    } catch (error) {
      // Retrieval is an enhancement; never let it take a generation down.
      console.error("[scene-context] retrieval failed", error);
    }
  }

  const context = buildStoryContext(bundle, {
    selectedCharacterIds,
    selectedLocationIds,
    selectedElementIds,
    currentChapter: chapter,
    retrieved,
    budgetTokens: input.budgetTokens,
  });

  return { bundle, chapter, context, retrievedCount: retrieved.length };
}

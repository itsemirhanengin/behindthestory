"use client";

import { RiFileSearchLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { Beat } from "@behindthestory/db/schema";
import type { Chapter, Character, Location, StoryElement } from "@/lib/queries/types";
import { ContextPanel, type ContextSelection } from "./context-panel";
import { ContinuityPanel } from "./continuity-panel";
import { PlanPanel } from "./plan-panel";

export function WritingToolsPanel({
  panel,
  novelId,
  chapterId,
  chapter,
  characters,
  locations,
  elements,
  selection,
  disabled,
  onPanelChange,
  onToggleContext,
  onChapterUpdate,
  onWriteBeat,
  onAnalyze,
  onLocate,
}: {
  panel: string;
  novelId: string;
  chapterId: string;
  chapter: Chapter;
  characters: Character[];
  locations: Location[];
  elements: StoryElement[];
  selection: ContextSelection;
  disabled: boolean;
  onPanelChange: (panel: string) => void;
  onToggleContext: (
    kind: "character" | "location" | "element",
    id: string,
  ) => void;
  onChapterUpdate: (chapter: Chapter) => void;
  onWriteBeat: (beat: Beat) => void;
  onAnalyze: () => void;
  onLocate: (quote: string) => boolean;
}) {
  return (
    <Tabs
      value={panel}
      onValueChange={onPanelChange}
      className="flex min-h-0 flex-1 flex-col gap-0"
    >
      <div className="h-[49px] shrink-0 overflow-x-auto border-b px-3">
        <TabsList
          variant="line"
          className="min-w-max items-stretch rounded-none p-0 group-data-horizontal/tabs:h-12"
        >
          <TabsTrigger
            className={cn(
              "h-full rounded-none border-0 border-b-2 border-b-transparent px-3 after:hidden",
              panel === "plan" && "border-b-foreground",
            )}
            value="plan"
          >
            Plan
          </TabsTrigger>
          <TabsTrigger
            className={cn(
              "h-full rounded-none border-0 border-b-2 border-b-transparent px-3 after:hidden",
              panel === "notes" && "border-b-foreground",
            )}
            value="notes"
          >
            Notes & sources
          </TabsTrigger>
          <TabsTrigger
            className={cn(
              "h-full rounded-none border-0 border-b-2 border-b-transparent px-3 after:hidden",
              panel === "review" && "border-b-foreground",
            )}
            value="review"
          >
            Review
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="plan" className="min-h-0 flex-1">
        <PlanPanel
          key={chapter.id}
          novelId={novelId}
          chapterId={chapterId}
          chapter={chapter}
          selection={selection}
          instruction=""
          disabled={disabled}
          onChapterUpdate={onChapterUpdate}
          onWriteBeat={onWriteBeat}
        />
      </TabsContent>

      <TabsContent value="notes" className="min-h-0 flex-1">
        <ContextPanel
          characters={characters}
          locations={locations}
          elements={elements}
          selection={selection}
          onToggle={onToggleContext}
        />
      </TabsContent>

      <TabsContent value="review" className="min-h-0 flex-1">
        <div className="flex h-full min-h-0 flex-col">
          <div className="border-b p-3">
            <h2 className="text-sm font-medium">Chapter review</h2>
            <p className="mt-1 text-base/7 text-muted-foreground sm:text-sm/6">
              Check continuity and review what this chapter should add to the
              story bible.
            </p>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="mt-3 w-full"
              onClick={onAnalyze}
              disabled={disabled}
            >
              <RiFileSearchLine data-icon="inline-start" /> Review story bible updates
            </Button>
          </div>
          <div className="min-h-0 flex-1">
            <ContinuityPanel
              novelId={novelId}
              chapterId={chapterId}
              disabled={disabled}
              onLocate={onLocate}
              compact
            />
          </div>
        </div>
      </TabsContent>
    </Tabs>
  );
}

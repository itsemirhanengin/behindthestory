"use client";

import { useState } from "react";
import { toast } from "sonner";
import { RiCheckLine, RiLoader4Line, RiSearchEyeLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { elementStyles } from "@/components/flow/element-node";
import { relationshipColors } from "@/components/flow/relationship-edge";
import { useAiAnalyze } from "@/lib/queries/ai";
import { useMergeAnalysis } from "@/lib/queries/story";
import { useIndexChapter } from "@/lib/queries/chapters";
import { cn } from "@/lib/utils";
import type { CharStatus, EventImpact, RelType } from "@behindthestory/db/schema";
import type { Character, Relationship, StoryElement, StoryEvent } from "@/lib/queries/types";
import { eventsByRelationship, relationshipStateAsOf } from "@behindthestory/core/story-state";

type Analysis = {
  chapterSummary: string;
  newElements: {
    type: StoryElement["type"];
    title: string;
    description: string;
    relatedCharacterIds: string[];
  }[];
  resolvedElementIds: string[];
  relationshipUpdates: {
    relationshipId: string;
    newType: RelType;
    closeness: number;
    cause: string;
    driverCharacterIds: string[];
    impact: EventImpact;
  }[];
  characterStatusChanges: {
    characterId: string;
    newStatus: CharStatus;
    cause: string;
    driverCharacterIds: string[];
    impact: EventImpact;
  }[];
  newRelationships: {
    sourceCharacterId: string;
    targetCharacterId: string;
    type: RelType;
    closeness: number;
    description: string;
    cause: string;
    impact: EventImpact;
  }[];
  characterFacts: { characterId: string; fact: string }[];
};

type Props = {
  novelId: string;
  chapterId: string;
  /** Where this chapter sits on the spine, so changes can show what they move from. */
  chapterNumber: number;
  characters: Character[];
  relationships: Relationship[];
  storyEvents: StoryEvent[];
  elements: StoryElement[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onMerged: () => void;
};

const impactStyles: Record<EventImpact, string> = {
  pivotal: "border-primary/60 bg-primary/10 text-primary",
  major: "border-muted-foreground/40 text-muted-foreground",
  minor: "border-muted-foreground/20 text-muted-foreground/60",
};

function ImpactChip({ impact }: { impact: EventImpact }) {
  return (
    <span
      className={cn(
        "rounded-none border px-1.5 text-[10px] capitalize",
        impactStyles[impact],
      )}
    >
      {impact}
    </span>
  );
}

function SuggestionRow({
  checked,
  onToggle,
  children,
}: {
  checked: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onToggle}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-lg border p-2.5 text-left transition-colors",
        checked
          ? "border-primary/50 bg-primary/5"
          : "border-border opacity-60 hover:opacity-100",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border",
          checked ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground",
        )}
      >
        {checked && <RiCheckLine className="size-3" />}
      </span>
      <div className="min-w-0 flex-1 text-sm">{children}</div>
    </button>
  );
}

export function AnalyzeDialog({
  novelId,
  chapterId,
  chapterNumber,
  characters,
  relationships,
  storyEvents,
  elements,
  open,
  onOpenChange,
  onMerged,
}: Props) {
  const [busy, setBusy] = useState(false);
  const analyze = useAiAnalyze();
  const merge = useMergeAnalysis(novelId);
  const indexChapter = useIndexChapter(chapterId);
  const [applying, setApplying] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [rejected, setRejected] = useState<Set<string>>(new Set());

  const nameOf = (id: string) =>
    characters.find((c) => c.id === id)?.name ?? "?";
  const relLabel = (id: string) => {
    const r = relationships.find((x) => x.id === id);
    return r
      ? `${nameOf(r.sourceCharacterId)} ↔ ${nameOf(r.targetCharacterId)}`
      : "?";
  };
  /** The state going into this chapter, so a proposed change reads as a move. */
  const relEventsById = eventsByRelationship(storyEvents);
  const stateBefore = (relationshipId: string) =>
    relationshipStateAsOf(
      relEventsById.get(relationshipId) ?? [],
      chapterNumber - 1,
    );
  const elementTitle = (id: string) =>
    elements.find((e) => e.id === id)?.title ?? "?";

  const isOn = (key: string) => !rejected.has(key);
  const toggle = (key: string) =>
    setRejected((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  async function run() {
    setBusy(true);
    setRejected(new Set());
    try {
      const out = await analyze.mutateAsync({ novelId, chapterId });
      setAnalysis(out as Analysis);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!analysis) return;
    setApplying(true);
    try {
      const result = await merge.mutateAsync({
          chapterId,
          chapterSummary: isOn("summary") ? analysis.chapterSummary : undefined,
          newElements: analysis.newElements.filter((_, i) => isOn(`el-${i}`)),
          resolvedElementIds: analysis.resolvedElementIds.filter((_, i) =>
            isOn(`res-${i}`),
          ),
          relationshipUpdates: analysis.relationshipUpdates.filter((_, i) =>
            isOn(`ru-${i}`),
          ),
          characterStatusChanges: analysis.characterStatusChanges.filter(
            (_, i) => isOn(`cs-${i}`),
          ),
          newRelationships: analysis.newRelationships.filter((_, i) =>
            isOn(`nr-${i}`),
          ),
          characterFacts: analysis.characterFacts.filter((_, i) =>
            isOn(`cf-${i}`),
          ),
        },
      );
      toast.success(
        `Story memory updated — ${result.applied.length} applied` +
          (result.skipped.length
            ? `, ${result.skipped.length} skipped as already known`
            : ""),
      );
      // An analyzed chapter is a settled chapter, so this is the right moment
      // to make its prose retrievable for later chapters.
      indexChapter.mutateAsync().catch(() => {});
      setAnalysis(null);
      onOpenChange(false);
      onMerged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setApplying(false);
    }
  }

  const total = analysis
    ? 1 +
      analysis.newElements.length +
      analysis.resolvedElementIds.length +
      analysis.relationshipUpdates.length +
      analysis.characterStatusChanges.length +
      analysis.newRelationships.length +
      analysis.characterFacts.length
    : 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setAnalysis(null);
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RiSearchEyeLine className="size-4 text-primary" /> Analyze Chapter
          </DialogTitle>
          <DialogDescription>
            The AI reads this chapter and proposes story-memory updates. Untick
            anything you disagree with, then apply.
          </DialogDescription>
        </DialogHeader>

        {!analysis ? (
          <Button onClick={run} disabled={busy} className="w-full">
            {busy ? (
              <>
                <RiLoader4Line className="size-4 animate-spin" /> Reading the
                chapter...
              </>
            ) : (
              "Run analysis"
            )}
          </Button>
        ) : (
          <>
            <ScrollArea className="max-h-[55vh]">
              <div className="space-y-4 pr-3">
                <section className="space-y-1.5">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Chapter summary
                  </h4>
                  <SuggestionRow
                    checked={isOn("summary")}
                    onToggle={() => toggle("summary")}
                  >
                    <p className="text-xs text-muted-foreground">
                      {analysis.chapterSummary}
                    </p>
                  </SuggestionRow>
                </section>

                {analysis.newElements.length > 0 && (
                  <section className="space-y-1.5">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      New story elements
                    </h4>
                    {analysis.newElements.map((el, i) => {
                      const style = elementStyles[el.type];
                      return (
                        <SuggestionRow
                          key={i}
                          checked={isOn(`el-${i}`)}
                          onToggle={() => toggle(`el-${i}`)}
                        >
                          <span
                            className="text-[10px] font-semibold uppercase"
                            style={{ color: style.color }}
                          >
                            {style.label}
                          </span>
                          <p className="font-medium">{el.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {el.description}
                          </p>
                          {el.relatedCharacterIds.length > 0 && (
                            <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                              {el.relatedCharacterIds.map(nameOf).join(", ")}
                            </p>
                          )}
                        </SuggestionRow>
                      );
                    })}
                  </section>
                )}

                {analysis.resolvedElementIds.length > 0 && (
                  <section className="space-y-1.5">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Paid off / resolved
                    </h4>
                    {analysis.resolvedElementIds.map((id, i) => (
                      <SuggestionRow
                        key={id}
                        checked={isOn(`res-${i}`)}
                        onToggle={() => toggle(`res-${i}`)}
                      >
                        <p className="text-sm">
                          <span className="font-medium">{elementTitle(id)}</span>{" "}
                          <span className="text-xs text-muted-foreground">
                            is resolved in this chapter
                          </span>
                        </p>
                      </SuggestionRow>
                    ))}
                  </section>
                )}

                {analysis.relationshipUpdates.length > 0 && (
                  <section className="space-y-1.5">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Relationship changes
                    </h4>
                    <p className="text-[11px] text-muted-foreground/70">
                      Each becomes a point on the bond&apos;s timeline at chapter{" "}
                      {chapterNumber}. Nothing earlier is overwritten.
                    </p>
                    {analysis.relationshipUpdates.map((ru, i) => {
                      const before = stateBefore(ru.relationshipId);
                      const turned = before && before.type !== ru.newType;
                      return (
                        <SuggestionRow
                          key={i}
                          checked={isOn(`ru-${i}`)}
                          onToggle={() => toggle(`ru-${i}`)}
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-medium">
                              {relLabel(ru.relationshipId)}
                            </span>
                            <ImpactChip impact={ru.impact} />
                          </div>
                          <p className="text-xs">
                            {before && (
                              <span className="text-muted-foreground">
                                {before.type} · {before.closeness}/10{" "}
                                <span className="mx-0.5">→</span>{" "}
                              </span>
                            )}
                            <span
                              style={{ color: relationshipColors[ru.newType] }}
                            >
                              {ru.newType} · {Math.round(ru.closeness)}/10
                            </span>
                            {turned && (
                              <span className="ml-1.5 rounded-none bg-primary/10 px-1.5 text-[10px] font-medium text-primary">
                                turn
                              </span>
                            )}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {ru.cause}
                          </p>
                          {ru.driverCharacterIds.length > 0 && (
                            <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                              driven by{" "}
                              {ru.driverCharacterIds.map(nameOf).join(", ")}
                            </p>
                          )}
                        </SuggestionRow>
                      );
                    })}
                  </section>
                )}

                {analysis.characterStatusChanges.length > 0 && (
                  <section className="space-y-1.5">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Fate changes
                    </h4>
                    {analysis.characterStatusChanges.map((cs, i) => (
                      <SuggestionRow
                        key={i}
                        checked={isOn(`cs-${i}`)}
                        onToggle={() => toggle(`cs-${i}`)}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium">
                            {nameOf(cs.characterId)}
                          </span>
                          <span className="text-xs capitalize text-alarm">
                            {cs.newStatus}
                          </span>
                          <ImpactChip impact={cs.impact} />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {cs.cause}
                        </p>
                        {cs.driverCharacterIds.length > 0 && (
                          <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                            responsible:{" "}
                            {cs.driverCharacterIds.map(nameOf).join(", ")}
                          </p>
                        )}
                      </SuggestionRow>
                    ))}
                  </section>
                )}

                {analysis.newRelationships.length > 0 && (
                  <section className="space-y-1.5">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      New relationships
                    </h4>
                    {analysis.newRelationships.map((nr, i) => (
                      <SuggestionRow
                        key={i}
                        checked={isOn(`nr-${i}`)}
                        onToggle={() => toggle(`nr-${i}`)}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium">
                            {nameOf(nr.sourceCharacterId)} ↔{" "}
                            {nameOf(nr.targetCharacterId)}
                          </span>
                          <span
                            className="text-xs"
                            style={{ color: relationshipColors[nr.type] }}
                          >
                            {nr.type} · {Math.round(nr.closeness)}/10
                          </span>
                          <ImpactChip impact={nr.impact} />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {nr.description}
                        </p>
                        {nr.cause && (
                          <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                            opens at Ch. {chapterNumber}: {nr.cause}
                          </p>
                        )}
                      </SuggestionRow>
                    ))}
                  </section>
                )}

                {analysis.characterFacts.length > 0 && (
                  <section className="space-y-1.5">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      New character facts
                    </h4>
                    {analysis.characterFacts.map((cf, i) => (
                      <SuggestionRow
                        key={i}
                        checked={isOn(`cf-${i}`)}
                        onToggle={() => toggle(`cf-${i}`)}
                      >
                        <p className="font-medium">{nameOf(cf.characterId)}</p>
                        <p className="text-xs text-muted-foreground">
                          {cf.fact}
                        </p>
                      </SuggestionRow>
                    ))}
                  </section>
                )}
              </div>
            </ScrollArea>
            <DialogFooter>
              <Button variant="ghost" onClick={run} disabled={busy}>
                Re-run
              </Button>
              <Button onClick={apply} disabled={applying}>
                {applying ? (
                  <RiLoader4Line className="size-4 animate-spin" />
                ) : (
                  <RiCheckLine className="size-4" />
                )}
                Apply {total - rejected.size}/{total}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

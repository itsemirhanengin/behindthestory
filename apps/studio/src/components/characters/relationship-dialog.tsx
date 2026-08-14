"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  RiAddLine,
  RiDeleteBinLine,
  RiLoader4Line,
  RiSparkling2Line,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { relationshipColors } from "@/components/flow/relationship-edge";
import {
  REL_TYPE_VALUES,
  EVENT_IMPACT_VALUES,
  type Character,
  type EventImpact,
  type Relationship,
  type RelType,
  type StoryEvent,
} from "@behindthestory/db/schema";
import {
  allTransitions,
  causalTrace,
  describeTransition,
  eventsByRelationship,
  formatChapterRef,
  relationshipStateAsOf,
} from "@behindthestory/core/story-state";

export type RelationshipDraft = {
  sourceCharacterId: string;
  targetCharacterId: string;
};

type Props = {
  novelId: string;
  characters: Character[];
  events: StoryEvent[];
  /** existing relationship (edit) or a draft from onConnect (create) */
  target: Relationship | RelationshipDraft | null;
  /** The chapter the canvas is showing, used to seed a new event. */
  asOf: number;
  lastChapter: number;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
  onDeleted: (id: string) => void;
};

const impactStyles: Record<EventImpact, string> = {
  pivotal: "border-primary/60 bg-primary/10 text-primary",
  major: "border-muted-foreground/40 text-muted-foreground",
  minor: "border-muted-foreground/20 text-muted-foreground/60",
};

export function RelationshipDialog({
  novelId,
  characters,
  events,
  target,
  asOf,
  lastChapter,
  onOpenChange,
  onChanged,
  onDeleted,
}: Props) {
  const existing = target && "id" in target ? (target as Relationship) : null;

  const [description, setDescription] = useState("");
  const [significance, setSignificance] = useState("");
  const [busy, setBusy] = useState(false);

  // --- The event being authored (the opening one when creating) -------------
  const [type, setType] = useState<RelType>("friendship");
  const [closeness, setCloseness] = useState(5);
  const [chapterNumber, setChapterNumber] = useState(0);
  const [cause, setCause] = useState("");
  const [drivers, setDrivers] = useState<string[]>([]);
  const [impact, setImpact] = useState<EventImpact>("major");

  const own = useMemo(
    () =>
      existing ? (eventsByRelationship(events).get(existing.id) ?? []) : [],
    [events, existing],
  );
  const transitions = useMemo(() => allTransitions(own), [own]);
  const traceIds = useMemo(
    () => new Set(causalTrace(own).map((s) => s.event.id)),
    [own],
  );
  const stateNow = useMemo(() => relationshipStateAsOf(own, asOf), [own, asOf]);

  useEffect(() => {
    if (existing) {
      setDescription(existing.description);
      setSignificance(existing.significance);
      // Seed the next event from where the bond currently stands, so the author
      // records what changed rather than retyping what did not.
      const state = relationshipStateAsOf(
        eventsByRelationship(events).get(existing.id) ?? [],
        asOf,
      );
      setType(state?.type ?? "friendship");
      setCloseness(state?.closeness ?? 5);
      setChapterNumber(Math.max(1, asOf));
      setImpact("major");
    } else if (target) {
      setDescription("");
      setSignificance("");
      setType("friendship");
      setCloseness(5);
      // A brand-new bond usually predates the page you are on; 0 means it was
      // already true when the pair walked on.
      setChapterNumber(0);
      setImpact("major");
    }
    setCause("");
    setDrivers([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  if (!target) return null;

  const nameOf = (id: string) =>
    characters.find((c) => c.id === id)?.name ?? "?";
  const a = nameOf(target.sourceCharacterId);
  const b = nameOf(target.targetCharacterId);
  const pairIds = [target.sourceCharacterId, target.targetCharacterId];

  async function create() {
    setBusy(true);
    try {
      await api.post(`/api/novels/${novelId}/relationships`, {
        sourceCharacterId: target!.sourceCharacterId,
        targetCharacterId: target!.targetCharacterId,
        description,
        significance,
        type,
        closeness,
        startChapterNumber: chapterNumber,
        cause,
        driverCharacterIds: drivers,
        impact,
        origin: "user",
      });
      onChanged();
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Saves the author's timeless notes. Does not touch the timeline. */
  async function saveNotes() {
    if (!existing) return;
    setBusy(true);
    try {
      await api.patch(`/api/entities/relationships/${existing.id}`, {
        description,
        significance,
      });
      onChanged();
      toast.success("Notes saved");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function addEvent() {
    if (!existing) return;
    if (!cause.trim()) {
      toast.error("An event needs a cause — what changed the bond?");
      return;
    }
    setBusy(true);
    try {
      await api.post(`/api/novels/${novelId}/story-events`, {
        relationshipId: existing.id,
        type,
        closeness,
        chapterNumber,
        cause,
        driverCharacterIds: drivers,
        impact,
        origin: "user",
      });
      setCause("");
      setDrivers([]);
      onChanged();
      toast.success(`Recorded at ${formatChapterRef(chapterNumber)}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function removeEvent(id: string) {
    // The opening event is the bond's anchor: without it the relationship has no
    // state at any chapter and vanishes from every view.
    if (own.length === 1) {
      toast.error(
        "This is the only event on the bond. Delete the relationship instead.",
      );
      return;
    }
    try {
      await api.del(`/api/entities/story-events/${id}`);
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function removeRelationship() {
    if (!existing) return;
    try {
      await api.del(`/api/entities/relationships/${existing.id}`);
      onDeleted(existing.id);
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const eventForm = (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Becomes</Label>
          <Select value={type} onValueChange={(v) => setType(v as RelType)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REL_TYPE_VALUES.map((t) => (
                <SelectItem key={t} value={t}>
                  <span className="flex items-center gap-2">
                    <span
                      className="size-2 rounded-none"
                      style={{ backgroundColor: relationshipColors[t] }}
                    />
                    {t}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>
            In chapter{" "}
            <span className="text-muted-foreground">
              {chapterNumber === 0 ? "(before Ch. 1)" : ""}
            </span>
          </Label>
          <Input
            type="number"
            min={0}
            max={Math.max(1, lastChapter)}
            value={chapterNumber}
            onChange={(e) => setChapterNumber(Math.max(0, +e.target.value))}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>
          Closeness{" "}
          <span className="text-muted-foreground">({closeness}/10)</span>
        </Label>
        <Slider
          min={1}
          max={10}
          step={1}
          value={[closeness]}
          onValueChange={([v]) => setCloseness(v)}
        />
      </div>

      <div className="space-y-2">
        <Label>What caused it</Label>
        <Textarea
          rows={2}
          value={cause}
          onChange={(e) => setCause(e.target.value)}
          placeholder="Marit pulled Ione out of the well and named her brother's killer."
        />
      </div>

      <div className="space-y-2">
        <Label>
          Driven by{" "}
          <span className="text-muted-foreground">
            (who made it happen — optional)
          </span>
        </Label>
        <div className="flex flex-wrap gap-1.5">
          {characters
            // The pair first, then anyone else who could have caused it.
            .slice()
            .sort(
              (x, y) =>
                Number(pairIds.includes(y.id)) - Number(pairIds.includes(x.id)),
            )
            .map((c) => {
              const on = drivers.includes(c.id);
              return (
                <button
                  key={c.id}
                  onClick={() =>
                    setDrivers((d) =>
                      on ? d.filter((x) => x !== c.id) : [...d, c.id],
                    )
                  }
                  className={cn(
                    "rounded-none border px-2 py-0.5 text-[11px] transition-colors",
                    on
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {c.name}
                </button>
              );
            })}
        </div>
      </div>

      <div className="space-y-2">
        <Label>How much it mattered</Label>
        <div className="flex gap-1.5">
          {EVENT_IMPACT_VALUES.map((i) => (
            <button
              key={i}
              onClick={() => setImpact(i)}
              className={cn(
                "rounded-none border px-2.5 py-0.5 text-[11px] capitalize transition-colors",
                impact === i
                  ? impactStyles[i]
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {i}
            </button>
          ))}
        </div>
        <p className="text-[11px] leading-snug text-muted-foreground">
          Pivotal events are the ones the &ldquo;why&rdquo; trace walks and the
          ones that always survive into the AI&apos;s context.
        </p>
      </div>
    </div>
  );

  return (
    <Dialog open={!!target} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {a} <span className="text-muted-foreground">↔</span> {b}
            {stateNow && (
              <span
                className="ml-1 rounded-none border px-2 py-0.5 text-[10px] font-medium"
                style={{
                  borderColor: relationshipColors[stateNow.type],
                  color: relationshipColors[stateNow.type],
                }}
              >
                {stateNow.type} · {stateNow.closeness}/10
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            {existing
              ? `As of chapter ${asOf}. Recording a change adds a point to the timeline — it never overwrites what came before.`
              : "Define what this bond was when it started. You can record changes to it afterwards."}
          </DialogDescription>
        </DialogHeader>

        {!existing ? (
          <>
            <ScrollArea className="max-h-[55vh]">
              <div className="space-y-5 pr-3">
                {eventForm}
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Textarea
                    rows={2}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="How they relate, history between them..."
                  />
                </div>
              </div>
            </ScrollArea>
            <DialogFooter>
              <Button onClick={create} disabled={busy}>
                {busy ? <RiLoader4Line className="size-4 animate-spin" /> : "Create"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <Tabs defaultValue="timeline" className="flex min-h-0 flex-col">
            <TabsList>
              <TabsTrigger value="timeline">
                Timeline ({transitions.length})
              </TabsTrigger>
              <TabsTrigger value="record">Record a change</TabsTrigger>
              <TabsTrigger value="notes">Notes</TabsTrigger>
            </TabsList>

            <ScrollArea className="max-h-[55vh]">
              <TabsContent value="timeline" className="space-y-2 py-3 pr-3">
                {transitions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No events yet.
                  </p>
                ) : (
                  transitions.map((step) => {
                    const e = step.event;
                    const future = e.chapterNumber > asOf;
                    return (
                      <div
                        key={e.id}
                        className={cn(
                          "rounded-lg border p-2.5 text-sm",
                          // What has not happened yet at the chapter being
                          // viewed is dimmed rather than hidden — the author is
                          // allowed to see ahead; the AI is not.
                          future ? "border-dashed opacity-50" : "bg-card/60",
                          traceIds.has(e.id) && !future && "border-primary/40",
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium">
                            {formatChapterRef(e.chapterNumber)}
                          </span>
                          <span
                            className="text-xs"
                            style={{
                              color: relationshipColors[step.to.type],
                            }}
                          >
                            {describeTransition(step)}
                          </span>
                          {step.isTurn && (
                            <span className="rounded-none bg-primary/10 px-1.5 text-[10px] font-medium text-primary">
                              turn
                            </span>
                          )}
                          <span
                            className={cn(
                              "ml-auto flex items-center gap-1 rounded-none border px-1.5 text-[10px] capitalize",
                              impactStyles[e.impact],
                            )}
                          >
                            {e.origin === "ai" && (
                              <RiSparkling2Line className="size-2.5" />
                            )}
                            {e.impact}
                          </span>
                          <button
                            className="shrink-0 text-muted-foreground transition-colors hover:text-destructive"
                            title="Remove this event"
                            onClick={() => removeEvent(e.id)}
                          >
                            <RiDeleteBinLine className="size-3" />
                          </button>
                        </div>
                        {e.cause && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {e.cause}
                          </p>
                        )}
                        {e.driverCharacterIds.length > 0 && (
                          <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                            driven by{" "}
                            {e.driverCharacterIds.map(nameOf).join(", ")}
                          </p>
                        )}
                      </div>
                    );
                  })
                )}
              </TabsContent>

              <TabsContent value="record" className="py-3 pr-3">
                {eventForm}
                <Button
                  onClick={addEvent}
                  disabled={busy}
                  className="mt-4 w-full"
                >
                  {busy ? (
                    <RiLoader4Line className="size-4 animate-spin" />
                  ) : (
                    <RiAddLine className="size-4" />
                  )}
                  Add to timeline
                </Button>
              </TabsContent>

              <TabsContent value="notes" className="space-y-4 py-3 pr-3">
                <p className="text-[11px] leading-snug text-muted-foreground">
                  These are timeless notes about the pair. What the bond{" "}
                  <em>is</em> at any point lives on the timeline instead.
                </p>
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Textarea
                    rows={3}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Significance</Label>
                  <Textarea
                    rows={2}
                    value={significance}
                    onChange={(e) => setSignificance(e.target.value)}
                    placeholder="Why this bond matters to the story..."
                  />
                </div>
                <Button onClick={saveNotes} disabled={busy} className="w-full">
                  {busy ? (
                    <RiLoader4Line className="size-4 animate-spin" />
                  ) : (
                    "Save notes"
                  )}
                </Button>
              </TabsContent>
            </ScrollArea>

            <DialogFooter className="items-center border-t pt-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={removeRelationship}
                title="Delete the relationship and its whole timeline"
              >
                <RiDeleteBinLine className="size-4 text-destructive" />
              </Button>
            </DialogFooter>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}

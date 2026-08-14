"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { RiDeleteBinLine, RiLoader4Line, RiSparkling2Line } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  useDeleteEntity,
  useEntityList,
  useUpdateEntity,
} from "@/lib/queries/entities";
import { useAiCharacter } from "@/lib/queries/ai";
import { useCreateStoryEvent } from "@/lib/queries/story";
import { cn } from "@/lib/utils";
import { relationshipColors } from "@/components/flow/relationship-edge";
import {
  CHAR_STATUS_VALUES,
  EVENT_IMPACT_VALUES,
  type CharStatus,
  type EventImpact,
} from "@behindthestory/db/schema";
import type {
  Character,
  CharacterFact,
  Relationship,
  StoryEvent,
} from "@/lib/queries/types";
import {
  causalTrace,
  characterStateAsOf,
  eventsByCharacter,
  eventsByRelationship,
  formatChapterRef,
  relationshipStateAsOf,
} from "@behindthestory/core/story-state";

const CHARACTER_COLORS = [
  "#8c3a2b", // terracotta
  "#b07d48", // ochre
  "#5c6e4a", // olive
  "#3f5e6b", // slate teal
  "#6b4c7a", // plum
  "#a85c4a", // clay
  "#4a6b5c", // sage
  "#7a6a4f", // umber
];

type Props = {
  novelId: string;
  character: Character | null;
  relationships: Relationship[];
  characters: Character[];
  events: StoryEvent[];
  /** The chapter the canvas is showing. Bonds and status are read at this point. */
  asOf: number;
  lastChapter: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (c: Character) => void;
  onEventsChanged: () => void;
  onDeleted: (id: string) => void;
};

const impactStyles: Record<EventImpact, string> = {
  pivotal: "border-primary/60 bg-primary/10 text-primary",
  major: "border-muted-foreground/40 text-muted-foreground",
  minor: "border-muted-foreground/20 text-muted-foreground/60",
};

export function CharacterSheet({
  novelId,
  character,
  relationships,
  characters,
  events,
  asOf,
  lastChapter,
  open,
  onOpenChange,
  onSaved,
  onEventsChanged,
  onDeleted,
}: Props) {
  const [form, setForm] = useState<Partial<Character>>({});
  const [traitsText, setTraitsText] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [facts, setFacts] = useState<CharacterFact[]>([]);

  // --- The status change being authored ------------------------------------
  const [newStatus, setNewStatus] = useState<CharStatus>("dead");
  const [statusChapter, setStatusChapter] = useState(1);
  const [statusCause, setStatusCause] = useState("");
  const [statusDrivers, setStatusDrivers] = useState<string[]>([]);
  const [statusImpact, setStatusImpact] = useState<EventImpact>("pivotal");
  const [statusBusy, setStatusBusy] = useState(false);

  useEffect(() => {
    if (character) {
      setForm(character);
      setTraitsText(character.traits.join(", "));
      setStatusChapter(Math.max(1, asOf));
      setStatusCause("");
      setStatusDrivers([]);
      setNewStatus("dead");
      setStatusImpact("pivotal");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [character]);

  // Canon facts extracted from chapters live in their own table, so they are
  // fetched rather than read off the character row.
  const characterId = character?.id;
  const factsQuery = useEntityList<CharacterFact>(novelId, "character-facts", {
    enabled: open && Boolean(characterId),
  });
  const updateEntity = useUpdateEntity<Character>(novelId);
  const deleteEntity = useDeleteEntity(novelId);
  const enrich = useAiCharacter();
  const recordEvent = useCreateStoryEvent(novelId);

  useEffect(() => {
    if (!factsQuery.data || !characterId) return;
    setFacts(factsQuery.data.filter((f) => f.characterId === characterId));
  }, [factsQuery.data, characterId]);

  if (!character) return null;

  const set = (patch: Partial<Character>) =>
    setForm((f) => ({ ...f, ...patch }));

  async function save() {
    if (!character) return;
    setSaving(true);
    try {
      const updated = await updateEntity.mutateAsync({
        entity: "characters",
        id: character.id,
        values: {
          name: form.name,
          role: form.role,
          summary: form.summary,
          backstory: form.backstory,
          appearance: form.appearance,
          secrets: form.secrets,
          voice: form.voice,
          speechSample: form.speechSample,
          motivation: form.motivation,
          arc: form.arc,
          color: form.color,
          traits: traitsText
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        },
      });
      onSaved(updated);
      toast.success("Character saved");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function fillWithAI() {
    if (!character) return;
    setAiBusy(true);
    try {
      const out = await enrich.mutateAsync({
        novelId,
        characterId: character.id,
      });
      set({
        summary: out.summary,
        backstory: out.backstory,
        appearance: out.appearance,
        secrets: out.secrets,
        voice: out.voice,
        speechSample: out.speechSample,
        motivation: out.motivation,
        arc: out.arc,
      });
      setTraitsText(out.traits.join(", "));
      toast.success("AI draft ready — review and save");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAiBusy(false);
    }
  }

  async function remove() {
    if (!character) return;
    try {
      await deleteEntity.mutateAsync({
        entity: "characters",
        id: character.id,
      });
      onDeleted(character.id);
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const nameOf = (id: string) =>
    characters.find((c) => c.id === id)?.name ?? "?";

  const relEventsById = eventsByRelationship(events);
  const ownStatusEvents = eventsByCharacter(events).get(character.id) ?? [];
  const state = characterStateAsOf(ownStatusEvents, asOf);

  // Bonds as they stand at the chapter being viewed. A bond not yet formed is
  // left out rather than shown with a default, matching the canvas.
  const charRels = relationships
    .filter(
      (r) =>
        r.sourceCharacterId === character.id ||
        r.targetCharacterId === character.id,
    )
    .flatMap((r) => {
      const own = relEventsById.get(r.id) ?? [];
      const relState = relationshipStateAsOf(own, asOf);
      if (!relState) return [];
      return [{ relationship: r, state: relState, events: own }];
    });

  async function addStatusEvent() {
    if (!character) return;
    if (!statusCause.trim()) {
      toast.error("A status change needs a cause — what happened?");
      return;
    }
    setStatusBusy(true);
    try {
      await recordEvent.mutateAsync({
        characterId: character.id,
        status: newStatus,
        chapterNumber: statusChapter,
        cause: statusCause,
        driverCharacterIds: statusDrivers,
        impact: statusImpact,
        origin: "user",
      });
      setStatusCause("");
      setStatusDrivers([]);
      onEventsChanged();
      toast.success(`Recorded at ${formatChapterRef(statusChapter)}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setStatusBusy(false);
    }
  }

  async function removeStatusEvent(id: string) {
    try {
      await deleteEntity.mutateAsync({ entity: "story-events", id });
      onEventsChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-[420px] flex-col gap-0 sm:max-w-[420px]">
        <SheetHeader className="border-b">
          <SheetTitle className="flex items-center gap-2">
            <span
              className="inline-block size-3 rounded-none"
              style={{ backgroundColor: form.color ?? character.color }}
            />
            {form.name || character.name}
          </SheetTitle>
          <SheetDescription>
            {character.origin === "ai" ? "AI-created character" : "Character"}
          </SheetDescription>
        </SheetHeader>

        <Tabs defaultValue="profile" className="flex min-h-0 flex-1 flex-col">
          <TabsList className="mx-4 mt-3">
            <TabsTrigger value="profile">Profile</TabsTrigger>
            <TabsTrigger value="voice">Voice</TabsTrigger>
            <TabsTrigger value="backstory">Backstory</TabsTrigger>
            <TabsTrigger value="relationships">
              Bonds ({charRels.length})
            </TabsTrigger>
            <TabsTrigger value="fate">
              Fate{ownStatusEvents.length > 0 ? ` (${ownStatusEvents.length})` : ""}
            </TabsTrigger>
          </TabsList>

          <ScrollArea className="min-h-0 flex-1">
            <TabsContent value="profile" className="space-y-4 p-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  value={form.name ?? ""}
                  onChange={(e) => set({ name: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Role</Label>
                  <Select
                    value={form.role ?? "side"}
                    onValueChange={(v) => set({ role: v as Character["role"] })}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="main">Main</SelectItem>
                      <SelectItem value="side">Side</SelectItem>
                      <SelectItem value="minor">Minor</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  {/* Status is not editable here: it is a point on the
                      timeline, not a property of the character. The Fate tab
                      owns it. */}
                  <Label>Status at chapter {asOf}</Label>
                  <div className="flex h-9 items-center gap-2 rounded-md border bg-muted/30 px-3 text-sm capitalize">
                    {state.status}
                    <span className="text-xs text-muted-foreground">
                      {state.sinceChapter > 0
                        ? `since ${formatChapterRef(state.sinceChapter)}`
                        : "from the start"}
                    </span>
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Color</Label>
                <div className="flex gap-1.5">
                  {CHARACTER_COLORS.map((c) => (
                    <button
                      key={c}
                      className="size-6 rounded-none border-2 transition-transform hover:scale-110"
                      style={{
                        backgroundColor: c,
                        borderColor:
                          (form.color ?? character.color) === c
                            ? "white"
                            : "transparent",
                      }}
                      onClick={() => set({ color: c })}
                    />
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Summary</Label>
                <Textarea
                  rows={3}
                  value={form.summary ?? ""}
                  onChange={(e) => set({ summary: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Traits (comma separated)</Label>
                <Input
                  value={traitsText}
                  onChange={(e) => setTraitsText(e.target.value)}
                  placeholder="stubborn, loyal, secretive"
                />
              </div>
              <div className="space-y-2">
                <Label>Appearance</Label>
                <Textarea
                  rows={3}
                  value={form.appearance ?? ""}
                  onChange={(e) => set({ appearance: e.target.value })}
                />
              </div>
            </TabsContent>

            <TabsContent value="voice" className="space-y-4 p-4">
              <p className="text-[11px] leading-snug text-muted-foreground">
                These fields are what stop every character sounding like the
                same narrator. They are sent to the AI in full whenever this
                character is selected for a scene.
              </p>
              <div className="space-y-2">
                <Label>Voice</Label>
                <Textarea
                  rows={4}
                  value={form.voice ?? ""}
                  onChange={(e) => set({ voice: e.target.value })}
                  placeholder="Clipped, never finishes a sentence when angry. Uses nautical metaphors. Never says 'sorry'."
                />
              </div>
              <div className="space-y-2">
                <Label>Speech sample</Label>
                <Textarea
                  rows={4}
                  value={form.speechSample ?? ""}
                  onChange={(e) => set({ speechSample: e.target.value })}
                  placeholder={"One example line per line of dialogue.\nNo quotation marks needed."}
                />
              </div>
              <div className="space-y-2">
                <Label>Wants (right now)</Label>
                <Textarea
                  rows={2}
                  value={form.motivation ?? ""}
                  onChange={(e) => set({ motivation: e.target.value })}
                  placeholder="To get the ledger back before her brother reads it."
                />
              </div>
              <div className="space-y-2">
                <Label>Arc</Label>
                <Textarea
                  rows={3}
                  value={form.arc ?? ""}
                  onChange={(e) => set({ arc: e.target.value })}
                  placeholder="From dutiful heir to the one who burns the house down."
                />
              </div>
            </TabsContent>

            <TabsContent value="backstory" className="space-y-4 p-4">
              <div className="space-y-2">
                <Label>Backstory</Label>
                <Textarea
                  rows={10}
                  value={form.backstory ?? ""}
                  onChange={(e) => set({ backstory: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Secrets (author-only)</Label>
                <Textarea
                  rows={4}
                  value={form.secrets ?? ""}
                  onChange={(e) => set({ secrets: e.target.value })}
                  placeholder="Hidden motives, future twist material..."
                />
              </div>
              <div className="space-y-2">
                <Label>Established in chapters ({facts.length})</Label>
                {facts.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Nothing yet. Facts land here when you analyze a chapter —
                    your backstory above is never overwritten.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {facts.map((f) => (
                      <li
                        key={f.id}
                        className="flex items-start gap-2 rounded-md border bg-card/60 p-2 text-xs"
                      >
                        <span className="min-w-0 flex-1">{f.fact}</span>
                        <button
                          className="shrink-0 text-muted-foreground transition-colors hover:text-destructive"
                          title="Remove this fact"
                          onClick={async () => {
                            try {
                              await deleteEntity.mutateAsync({
                                entity: "character-facts",
                                id: f.id,
                              });
                              setFacts((l) => l.filter((x) => x.id !== f.id));
                            } catch (e) {
                              toast.error((e as Error).message);
                            }
                          }}
                        >
                          <RiDeleteBinLine className="size-3" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </TabsContent>

            <TabsContent value="relationships" className="space-y-3 p-4">
              <p className="text-[11px] leading-snug text-muted-foreground">
                As of chapter {asOf}. Each bond shows how it got to where it is —
                click its edge on the canvas for the full timeline.
              </p>
              {charRels.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No bonds at this point in the story. Drag a connection between
                  two character cards on the canvas, or scrub forward.
                </p>
              ) : (
                charRels.map(({ relationship: r, state: relState, events: own }) => {
                  const otherId =
                    r.sourceCharacterId === character.id
                      ? r.targetCharacterId
                      : r.sourceCharacterId;
                  const trace = causalTrace(own, asOf, 4);
                  return (
                    <div
                      key={r.id}
                      className="rounded-lg border bg-card/60 p-3 text-sm"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{nameOf(otherId)}</span>
                        <span
                          className="text-xs"
                          style={{ color: relationshipColors[relState.type] }}
                        >
                          {relState.type} · {relState.closeness}/10
                        </span>
                      </div>
                      {r.description && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {r.description}
                        </p>
                      )}
                      {trace.length > 1 && (
                        <ol className="mt-2 space-y-1 border-t pt-2 text-xs text-muted-foreground">
                          {trace.map((step) => (
                            <li key={step.event.id} className="flex gap-1.5">
                              <span className="shrink-0 font-medium text-foreground/70">
                                {formatChapterRef(step.event.chapterNumber)}
                              </span>
                              <span className="min-w-0">
                                {step.isTurn && (
                                  <span
                                    className="mr-1"
                                    style={{
                                      color: relationshipColors[step.to.type],
                                    }}
                                  >
                                    → {step.to.type}
                                  </span>
                                )}
                                {step.event.cause}
                              </span>
                            </li>
                          ))}
                        </ol>
                      )}
                    </div>
                  );
                })
              )}
            </TabsContent>

            <TabsContent value="fate" className="space-y-4 p-4">
              <p className="text-[11px] leading-snug text-muted-foreground">
                Death, disappearance and return are points on the spine, not a
                switch on the character. Recording one keeps every earlier
                chapter reading correctly — and keeps the reason, which is what
                you will come back for.
              </p>

              {ownStatusEvents.length > 0 && (
                <ul className="space-y-1.5">
                  {ownStatusEvents.map((e) => (
                    <li
                      key={e.id}
                      className={cn(
                        "rounded-lg border p-2.5 text-sm",
                        e.chapterNumber > asOf
                          ? "border-dashed opacity-50"
                          : "bg-card/60",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          {formatChapterRef(e.chapterNumber)}
                        </span>
                        <span className="text-xs capitalize text-muted-foreground">
                          {e.charStatus}
                        </span>
                        <span
                          className={cn(
                            "ml-auto flex items-center gap-1 rounded-none border px-1.5 text-[10px] capitalize",
                            impactStyles[e.impact],
                          )}
                        >
                          {e.origin === "ai" && <RiSparkling2Line className="size-2.5" />}
                          {e.impact}
                        </span>
                        <button
                          className="shrink-0 text-muted-foreground transition-colors hover:text-destructive"
                          title="Remove this event"
                          onClick={() => removeStatusEvent(e.id)}
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
                          driven by {e.driverCharacterIds.map(nameOf).join(", ")}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              <div className="space-y-4 rounded-lg border border-dashed p-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Becomes</Label>
                    <Select
                      value={newStatus}
                      onValueChange={(v) => setNewStatus(v as CharStatus)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CHAR_STATUS_VALUES.map((s) => (
                          <SelectItem key={s} value={s} className="capitalize">
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>In chapter</Label>
                    <Input
                      type="number"
                      min={0}
                      max={Math.max(1, lastChapter)}
                      value={statusChapter}
                      onChange={(e) =>
                        setStatusChapter(Math.max(0, +e.target.value))
                      }
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>What happened</Label>
                  <Textarea
                    rows={2}
                    value={statusCause}
                    onChange={(e) => setStatusCause(e.target.value)}
                    placeholder="Went into the water after Ione and did not come back up."
                  />
                </div>

                <div className="space-y-2">
                  <Label>
                    Responsible{" "}
                    <span className="text-muted-foreground">
                      (their own choice? someone else&apos;s mistake?)
                    </span>
                  </Label>
                  <div className="flex flex-wrap gap-1.5">
                    {characters.map((c) => {
                      const on = statusDrivers.includes(c.id);
                      return (
                        <button
                          key={c.id}
                          onClick={() =>
                            setStatusDrivers((d) =>
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
                          {c.id === character.id ? " (self)" : ""}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex gap-1.5">
                  {EVENT_IMPACT_VALUES.map((i) => (
                    <button
                      key={i}
                      onClick={() => setStatusImpact(i)}
                      className={cn(
                        "rounded-none border px-2.5 py-0.5 text-[11px] capitalize transition-colors",
                        statusImpact === i
                          ? impactStyles[i]
                          : "border-border text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {i}
                    </button>
                  ))}
                </div>

                <Button
                  onClick={addStatusEvent}
                  disabled={statusBusy}
                  className="w-full"
                >
                  {statusBusy ? (
                    <RiLoader4Line className="size-4 animate-spin" />
                  ) : (
                    "Add to timeline"
                  )}
                </Button>
              </div>
            </TabsContent>
          </ScrollArea>
        </Tabs>

        <div className="flex items-center gap-2 border-t p-4">
          <Button onClick={save} disabled={saving} className="flex-1">
            {saving ? <RiLoader4Line className="size-4 animate-spin" /> : "Save"}
          </Button>
          <Button variant="secondary" onClick={fillWithAI} disabled={aiBusy}>
            {aiBusy ? (
              <RiLoader4Line className="size-4 animate-spin" />
            ) : (
              <RiSparkling2Line className="size-4" />
            )}
            Fill with AI
          </Button>
          <Button variant="ghost" size="icon" onClick={remove}>
            <RiDeleteBinLine className="size-4 text-destructive" />
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

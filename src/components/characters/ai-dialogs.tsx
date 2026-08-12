"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Loader2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api } from "@/lib/api";
import { relationshipColors } from "@/components/flow/relationship-edge";
import type { Character, RelType } from "@/db/schema";

type GeneratedCharacter = {
  name: string;
  role: Character["role"];
  summary: string;
  backstory: string;
  traits: string[];
  appearance: string;
  secrets: string;
};

export function AiCharacterDialog({
  novelId,
  open,
  onOpenChange,
  onAccepted,
}: {
  novelId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onAccepted: (c: Character) => void;
}) {
  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<GeneratedCharacter | null>(null);

  async function generate() {
    setBusy(true);
    try {
      const out = await api.post<GeneratedCharacter>("/api/ai/character", {
        novelId,
        hint: hint || undefined,
      });
      setDraft(out);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function accept() {
    if (!draft) return;
    setBusy(true);
    try {
      const created = await api.post<Character>(
        `/api/novels/${novelId}/characters`,
        {
          ...draft,
          origin: "ai",
          posX: 100 + Math.random() * 300,
          posY: 100 + Math.random() * 300,
        },
      );
      onAccepted(created);
      setDraft(null);
      setHint("");
      onOpenChange(false);
      toast.success(`${created.name} joined the story`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setDraft(null);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" /> AI Character
          </DialogTitle>
          <DialogDescription>
            The AI invents a character that fits your premise and cast.
          </DialogDescription>
        </DialogHeader>

        {!draft ? (
          <div className="space-y-3">
            <Input
              value={hint}
              onChange={(e) => setHint(e.target.value)}
              placeholder="Optional direction, e.g. 'a morally gray smuggler'"
            />
            <Button onClick={generate} disabled={busy} className="w-full">
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
              Generate
            </Button>
          </div>
        ) : (
          <>
            <ScrollArea className="max-h-80">
              <div className="space-y-3 pr-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-base font-semibold">{draft.name}</span>
                  <Badge variant="outline">{draft.role}</Badge>
                </div>
                <p className="text-muted-foreground">{draft.summary}</p>
                <div className="flex flex-wrap gap-1">
                  {draft.traits.map((t) => (
                    <Badge key={t} variant="secondary" className="text-[10px]">
                      {t}
                    </Badge>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {draft.appearance}
                </p>
                <div className="rounded-md border bg-card/60 p-3 text-xs leading-relaxed text-muted-foreground">
                  {draft.backstory}
                </div>
              </div>
            </ScrollArea>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setDraft(null)}>
                <X className="size-4" /> Discard
              </Button>
              <Button variant="secondary" onClick={generate} disabled={busy}>
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  "Regenerate"
                )}
              </Button>
              <Button onClick={accept} disabled={busy}>
                <Check className="size-4" /> Add to story
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

type RelSuggestion = {
  sourceCharacterId: string;
  targetCharacterId: string;
  type: RelType;
  closeness: number;
  description: string;
  reasoning: string;
  startChapterNumber: number;
};

export function InferRelationshipsDialog({
  novelId,
  characters,
  open,
  onOpenChange,
  onAccepted,
}: {
  novelId: string;
  characters: Character[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Accepting writes a relationship *and* its opening event, so the canvas
   *  reloads both rather than patching a single row into place. */
  onAccepted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<RelSuggestion[] | null>(null);

  const nameOf = (id: string) =>
    characters.find((c) => c.id === id)?.name ?? "?";

  async function run() {
    setBusy(true);
    try {
      const out = await api.post<{ suggestions: RelSuggestion[] }>(
        "/api/ai/relationships",
        { novelId },
      );
      setSuggestions(out.suggestions);
      if (out.suggestions.length === 0)
        toast.info("No new relationships implied by the story yet.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function accept(s: RelSuggestion) {
    try {
      await api.post(`/api/novels/${novelId}/relationships`, {
        sourceCharacterId: s.sourceCharacterId,
        targetCharacterId: s.targetCharacterId,
        type: s.type,
        closeness: Math.round(Math.max(1, Math.min(10, s.closeness))),
        description: s.description,
        // The evidence the model cited for the bond is exactly the cause of its
        // opening event, so it lands on the timeline instead of being discarded.
        startChapterNumber: Math.max(0, Math.round(s.startChapterNumber ?? 0)),
        cause: s.reasoning,
        origin: "ai",
      });
      onAccepted();
      setSuggestions((list) => (list ?? []).filter((x) => x !== s));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setSuggestions(null);
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" /> Infer Relationships
          </DialogTitle>
          <DialogDescription>
            The AI reads your chapters and character profiles, then proposes
            bonds you haven&apos;t mapped yet.
          </DialogDescription>
        </DialogHeader>

        {suggestions === null ? (
          <Button onClick={run} disabled={busy} className="w-full">
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            Analyze story
          </Button>
        ) : suggestions.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Nothing new to suggest — your map is up to date.
          </p>
        ) : (
          <ScrollArea className="max-h-96">
            <div className="space-y-3 pr-3">
              {suggestions.map((s, i) => (
                <div key={i} className="rounded-lg border bg-card/60 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">
                      {nameOf(s.sourceCharacterId)}{" "}
                      <span className="text-muted-foreground">↔</span>{" "}
                      {nameOf(s.targetCharacterId)}
                    </span>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className="text-[11px] text-muted-foreground">
                        from{" "}
                        {s.startChapterNumber > 0
                          ? `Ch. ${s.startChapterNumber}`
                          : "before Ch. 1"}
                      </span>
                      <Badge
                        variant="outline"
                        style={{ color: relationshipColors[s.type] }}
                      >
                        {s.type} · {Math.round(s.closeness)}
                      </Badge>
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {s.description}
                  </p>
                  <p className="mt-1 text-[11px] italic text-muted-foreground/70">
                    {s.reasoning}
                  </p>
                  <div className="mt-2 flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setSuggestions((list) =>
                          (list ?? []).filter((x) => x !== s),
                        )
                      }
                    >
                      <X className="size-3.5" /> Skip
                    </Button>
                    <Button size="sm" onClick={() => accept(s)}>
                      <Check className="size-3.5" /> Accept
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}

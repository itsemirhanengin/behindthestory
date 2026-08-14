"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { RiBookMarkedLine, RiLoader4Line, RiSparkling2Line } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api } from "@/lib/api";
import type { Novel } from "@behindthestory/db/schema";

type Usage = {
  totals: { calls: number; inputTokens: number; outputTokens: number };
  byRoute: {
    route: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
  }[];
};

type StyleSuggestion = Pick<
  Novel,
  "genre" | "tone" | "pov" | "tense" | "targetChapterWords" | "styleNotes"
>;

const compact = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000
      ? `${(n / 1_000).toFixed(1)}k`
      : String(n);

export function StoryBible({ novelId }: { novelId: string }) {
  const [novel, setNovel] = useState<Novel | null>(null);
  const [form, setForm] = useState<Partial<Novel>>({});
  const [usage, setUsage] = useState<Usage | null>(null);
  const [saving, setSaving] = useState(false);
  const [suggesting, setSuggesting] = useState(false);

  useEffect(() => {
    api
      .get<Novel>(`/api/novels/${novelId}`)
      .then((n) => {
        setNovel(n);
        setForm(n);
      })
      .catch((e) => toast.error(e.message));
    api
      .get<Usage>(`/api/novels/${novelId}/usage`)
      .then(setUsage)
      .catch(() => {});
  }, [novelId]);

  const set = (patch: Partial<Novel>) => setForm((f) => ({ ...f, ...patch }));

  async function save() {
    setSaving(true);
    try {
      const updated = await api.patch<Novel>(`/api/novels/${novelId}`, {
        title: form.title,
        premise: form.premise,
        genre: form.genre,
        tone: form.tone,
        pov: form.pov,
        tense: form.tense,
        targetChapterWords: form.targetChapterWords,
        styleNotes: form.styleNotes,
      });
      setNovel(updated);
      setForm(updated);
      toast.success("Story bible saved");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function suggestStyle() {
    setSuggesting(true);
    try {
      const out = await api.post<StyleSuggestion>("/api/ai/style", { novelId });
      set(out);
      toast.success("Style proposed — review it, then save");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSuggesting(false);
    }
  }

  if (!novel) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4 p-8">
        <Skeleton className="h-10" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  const dirty = JSON.stringify(form) !== JSON.stringify(novel);

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto w-full max-w-3xl space-y-8 px-8 py-10">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2.5 font-heading text-2xl font-semibold tracking-tight">
              <RiBookMarkedLine className="size-6 text-primary" /> Story Bible
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Everything here is compiled into every AI generation for this
              novel. Vague settings produce vague prose.
            </p>
          </div>
          <Button onClick={save} disabled={saving || !dirty}>
            {saving ? <RiLoader4Line className="size-4 animate-spin" /> : null}
            {dirty ? "Save changes" : "Saved"}
          </Button>
        </header>

        <section className="space-y-4">
          <div className="space-y-2">
            <Label>Title</Label>
            <Input
              value={form.title ?? ""}
              onChange={(e) => set({ title: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Premise</Label>
            <Textarea
              rows={4}
              value={form.premise ?? ""}
              onChange={(e) => set({ premise: e.target.value })}
              placeholder="The one-paragraph spine of the novel."
            />
          </div>
        </section>

        <section className="space-y-4 rounded-xl border bg-card/40 p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">Style contract</h2>
              <p className="text-xs text-muted-foreground">
                Binding rules the AI is told never to break.
              </p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={suggestStyle}
              disabled={suggesting}
            >
              {suggesting ? (
                <RiLoader4Line className="size-4 animate-spin" />
              ) : (
                <RiSparkling2Line className="size-4" />
              )}
              Suggest from premise
            </Button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Genre</Label>
              <Input
                value={form.genre ?? ""}
                onChange={(e) => set({ genre: e.target.value })}
                placeholder="literary thriller"
              />
            </div>
            <div className="space-y-2">
              <Label>Tone</Label>
              <Input
                value={form.tone ?? ""}
                onChange={(e) => set({ tone: e.target.value })}
                placeholder="bleak, wry, slow-burn dread"
              />
            </div>
            <div className="space-y-2">
              <Label>Point of view</Label>
              <Select
                value={form.pov ?? "third_limited"}
                onValueChange={(v) => set({ pov: v as Novel["pov"] })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="first">First person</SelectItem>
                  <SelectItem value="third_limited">
                    Third person limited
                  </SelectItem>
                  <SelectItem value="third_omniscient">
                    Third person omniscient
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Tense</Label>
              <Select
                value={form.tense ?? "past"}
                onValueChange={(v) => set({ tense: v as Novel["tense"] })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="past">Past</SelectItem>
                  <SelectItem value="present">Present</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Target chapter length (words)</Label>
              <Input
                type="number"
                min={200}
                max={20000}
                step={100}
                value={form.targetChapterWords ?? 1800}
                onChange={(e) =>
                  set({ targetChapterWords: Number(e.target.value) })
                }
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Prose rules</Label>
            <Textarea
              rows={7}
              value={form.styleNotes ?? ""}
              onChange={(e) => set({ styleNotes: e.target.value })}
              placeholder={
                "Written as directives. e.g.\nShort declaratives under pressure; long clauses when a character is avoiding something.\nNo similes involving weather.\nDialogue carries the subtext; never explain it afterwards."
              }
            />
          </div>
        </section>

        <section className="space-y-3 rounded-xl border bg-card/40 p-5">
          <div>
            <h2 className="text-sm font-semibold">AI usage</h2>
            <p className="text-xs text-muted-foreground">
              Tokens spent on this novel, by endpoint.
            </p>
          </div>
          {!usage || usage.totals.calls === 0 ? (
            <p className="text-xs text-muted-foreground">
              No generations recorded yet.
            </p>
          ) : (
            <>
              <div className="flex gap-6 text-sm">
                <div>
                  <div className="text-lg font-semibold tabular-nums">
                    {usage.totals.calls}
                  </div>
                  <div className="text-[11px] text-muted-foreground">calls</div>
                </div>
                <div>
                  <div className="text-lg font-semibold tabular-nums">
                    {compact(usage.totals.inputTokens)}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    input tokens
                  </div>
                </div>
                <div>
                  <div className="text-lg font-semibold tabular-nums">
                    {compact(usage.totals.outputTokens)}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    output tokens
                  </div>
                </div>
              </div>
              <ul className="space-y-1 border-t pt-3 text-xs text-muted-foreground">
                {usage.byRoute.map((r) => (
                  <li key={r.route} className="flex justify-between gap-4">
                    <span className="font-medium text-foreground">
                      {r.route}
                    </span>
                    <span className="tabular-nums">
                      {r.calls} × · {compact(r.inputTokens)} in ·{" "}
                      {compact(r.outputTokens)} out
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </ScrollArea>
  );
}

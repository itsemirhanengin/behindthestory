"use client";

import { useRef, useState } from "react";
import {
  RiAlertLine,
  RiFireLine,
  RiGlobalLine,
  RiLoader4Line,
  RiMagicLine,
  RiQuestionLine,
  RiRefreshLine,
  RiSparkling2Line,
  RiSwordLine,
  RiUserLine,
} from "@remixicon/react";
import type { RemixiconComponentType } from "@remixicon/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { Reading, WizardTurn } from "@/lib/onboarding";

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
      {children}
    </p>
  );
}

function Facet({
  icon: Icon,
  label,
  value,
}: {
  icon: RemixiconComponentType;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border bg-background/40 p-4">
      <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        <Icon className="size-3.5" /> {label}
      </p>
      <p className="mt-2 text-sm leading-relaxed">{value}</p>
    </div>
  );
}

function ReadingSkeleton() {
  return (
    <div className="space-y-6 rounded-2xl border bg-card/40 p-6">
      <Skeleton className="h-9 w-2/3" />
      <Skeleton className="h-16" />
      <Skeleton className="h-24" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    </div>
  );
}

export function AlignmentStep({
  title,
  titleFromAi,
  onTitleChange,
  reading,
  busy,
  error,
  turns,
  onRefine,
  onRetry,
}: {
  title: string;
  titleFromAi: boolean;
  onTitleChange: (value: string, fromAi?: boolean) => void;
  reading: Reading | null;
  busy: boolean;
  error: string | null;
  turns: WizardTurn[];
  onRefine: (correction: string) => void;
  onRetry: () => void;
}) {
  const [draft, setDraft] = useState("");
  const boxRef = useRef<HTMLTextAreaElement>(null);

  /** Puts a starting point in the correction box rather than making the author
   *  retype what the AI just told them it assumed. */
  function seed(text: string) {
    setDraft((d) => (d.trim() ? `${d.trimEnd()}\n\n${text}` : text));
    requestAnimationFrame(() => {
      const box = boxRef.current;
      if (!box) return;
      box.focus();
      box.setSelectionRange(box.value.length, box.value.length);
    });
  }

  function send() {
    const correction = draft.trim();
    if (!correction || busy) return;
    setDraft("");
    onRefine(correction);
  }

  if (!reading) {
    if (error) {
      return (
        <div className="max-w-lg rounded-2xl border bg-card/40 p-6">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <RiAlertLine className="size-4 text-destructive" /> The AI could
            not read your premise
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {error}
          </p>
          <Button className="mt-4" variant="secondary" onClick={onRetry}>
            <RiRefreshLine className="size-4" /> Try again
          </Button>
        </div>
      );
    }
    return (
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <ReadingSkeleton />
        </div>
        <div className="space-y-4 lg:col-span-2">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <RiLoader4Line className="size-4 animate-spin" /> Reading your premise…
          </p>
          <Skeleton className="h-32" />
          <Skeleton className="h-24" />
        </div>
      </div>
    );
  }

  const alternatives = reading.titleSuggestions.filter(
    (s) => s.trim() && s.trim() !== title.trim(),
  );

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <section
        className={cn(
          "space-y-6 rounded-2xl border bg-card/40 p-6 transition-opacity lg:col-span-3",
          busy && "pointer-events-none opacity-40",
        )}
      >
        <div>
          <div className="flex items-center justify-between gap-3">
            <Eyebrow>Title</Eyebrow>
            {titleFromAi && (
              <Badge variant="secondary" className="gap-1">
                <RiSparkling2Line /> Named by AI
              </Badge>
            )}
          </div>
          <Input
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            aria-label="Novel title"
            className="mt-1 h-auto rounded-none border-0 border-b border-transparent bg-transparent px-0 py-1.5 font-heading text-2xl font-semibold tracking-tight hover:border-border focus-visible:border-primary focus-visible:ring-0 md:text-2xl dark:bg-transparent"
          />
          {alternatives.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">
                Also considered
              </span>
              {alternatives.map((s, i) => (
                <button
                  key={`${i}-${s}`}
                  type="button"
                  onClick={() => onTitleChange(s, true)}
                  className="rounded-4xl border px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        <blockquote className="border-l-2 border-primary/40 pl-4 font-serif text-lg italic leading-relaxed">
          {reading.logline}
        </blockquote>

        <div className="border-t pt-6">
          <Eyebrow>The premise it will write from</Eyebrow>
          <p className="manuscript mt-2.5">{reading.premise}</p>
        </div>

        <div className="grid gap-4 border-t pt-6 sm:grid-cols-2">
          <Facet icon={RiUserLine} label="Protagonist" value={reading.protagonist} />
          <Facet icon={RiSwordLine} label="Conflict" value={reading.conflict} />
          <Facet icon={RiGlobalLine} label="World" value={reading.world} />
          <Facet icon={RiFireLine} label="Stakes" value={reading.stakes} />
        </div>

        {reading.themes.length > 0 && (
          <div className="border-t pt-6">
            <Eyebrow>Themes</Eyebrow>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {reading.themes.map((t, i) => (
                <Badge key={`${i}-${t}`} variant="outline">
                  {t}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </section>

      <div className="space-y-4 lg:col-span-2">
        {reading.assumptions.length > 0 && (
          <section className="rounded-2xl border border-dashed p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <RiMagicLine className="size-4 text-primary" /> It filled these gaps
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Things it decided for you, because you did not say. This is where
              misunderstandings hide.
            </p>
            <ul className="mt-3 space-y-2.5">
              {reading.assumptions.map((a, i) => (
                <li
                  key={`${i}-${a}`}
                  className="group flex items-start gap-2 text-sm"
                >
                  <span
                    aria-hidden
                    className="mt-[0.5rem] size-1 shrink-0 rounded-none bg-muted-foreground/60"
                  />
                  <span className="flex-1 leading-relaxed">{a}</span>
                  <button
                    type="button"
                    onClick={() => seed(`Wrong: “${a}”. Actually `)}
                    className="shrink-0 pt-0.5 text-xs text-primary opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    fix
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {reading.questions.length > 0 && (
          <section className="rounded-2xl border p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <RiQuestionLine className="size-4 text-primary" /> It wants to know
            </h2>
            <ul className="mt-3 space-y-2.5">
              {reading.questions.map((q, i) => (
                <li key={`${i}-${q}`}>
                  <button
                    type="button"
                    onClick={() => seed(`${q}\n`)}
                    className="text-left text-sm leading-relaxed text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {q}
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">
              Answer what matters, ignore the rest — it will decide the others
              itself.
            </p>
          </section>
        )}

        {turns.length > 0 && (
          <section className="space-y-3 rounded-2xl border bg-card/40 p-5">
            <h2 className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
              Your corrections
            </h2>
            <ol className="space-y-3">
              {turns.map((turn, i) => (
                <li key={i} className="border-l-2 border-border pl-3">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">
                    {turn.correction}
                  </p>
                  {turn.changeNote && (
                    <p className="mt-1.5 flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
                      <RiSparkling2Line className="mt-0.5 size-3 shrink-0 text-primary" />
                      {turn.changeNote}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </section>
        )}

        <section className="rounded-2xl border bg-card/40 p-5">
          <h2 className="text-sm font-semibold">Set it straight</h2>
          <Textarea
            ref={boxRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="The sister is not an ally — she is the one who turns them in. And it is not a city, it is three villages around a lake."
            className="mt-2.5 min-h-28 bg-background/40 text-sm md:text-sm"
          />
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              It re-reads from scratch, every time.
            </p>
            <Button
              size="sm"
              variant="secondary"
              onClick={send}
              disabled={!draft.trim() || busy}
            >
              {busy ? (
                <RiLoader4Line className="size-3.5 animate-spin" />
              ) : (
                <RiRefreshLine className="size-3.5" />
              )}
              Re-read
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}

"use client";

import {
  RiAlertLine,
  RiLoader4Line,
  RiPencilLine,
  RiRefreshLine,
  RiSparkling2Line,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  CHAPTER_WORDS,
  POV_OPTIONS,
  TENSE_OPTIONS,
  readingMinutes,
  type StyleFields,
  type StyleProposal,
} from "@/lib/onboarding";

function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex flex-wrap gap-0.5 rounded-lg border p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
            value === option.value
              ? "bg-secondary text-secondary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Says where a value came from, so an autofilled contract stays inspectable. */
function Origin({ edited }: { edited: boolean }) {
  return edited ? (
    <span title="Edited by you" className="text-muted-foreground">
      <RiPencilLine className="size-3" />
      <span className="sr-only">Edited by you</span>
    </span>
  ) : (
    <span title="Proposed by the AI" className="text-primary">
      <RiSparkling2Line className="size-3" />
      <span className="sr-only">Proposed by the AI</span>
    </span>
  );
}

function Row({
  label,
  rationale,
  edited,
  children,
}: {
  label: string;
  rationale: string;
  edited: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-3 p-5 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-6">
      <div>
        <div className="flex items-center gap-1.5">
          <Label className="text-sm">{label}</Label>
          <Origin edited={edited} />
        </div>
        {rationale && (
          <p className="mt-1.5 font-serif text-xs italic leading-relaxed text-muted-foreground">
            {rationale}
          </p>
        )}
      </div>
      <div>{children}</div>
    </div>
  );
}

export function StyleStep({
  style,
  proposal,
  busy,
  error,
  stale,
  onChange,
  onRederive,
}: {
  style: StyleFields | null;
  proposal: StyleProposal | null;
  busy: boolean;
  error: string | null;
  stale: boolean;
  onChange: (patch: Partial<StyleFields>) => void;
  onRederive: () => void;
}) {
  if (!style || !proposal) {
    if (error) {
      return (
        <div className="max-w-lg rounded-2xl border bg-card/40 p-6">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <RiAlertLine className="size-4 text-destructive" /> Could not
            derive a style
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {error}
          </p>
          <Button className="mt-4" variant="secondary" onClick={onRederive}>
            <RiRefreshLine className="size-4" /> Try again
          </Button>
        </div>
      );
    }
    return (
      <div className="space-y-4">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <RiLoader4Line className="size-4 animate-spin" /> Deriving the house style
          from your premise…
        </p>
        <div className="space-y-3 rounded-2xl border bg-card/40 p-5">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
          <Skeleton className="h-20" />
          <Skeleton className="h-32" />
        </div>
      </div>
    );
  }

  const { rationale } = proposal;
  const words = style.targetChapterWords;

  return (
    <div className="space-y-5">
      {stale && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed p-4">
          <p className="text-xs leading-relaxed text-muted-foreground">
            You changed the premise after this style was derived. Re-deriving
            replaces every field, including your edits.
          </p>
          <Button
            size="sm"
            variant="secondary"
            onClick={onRederive}
            disabled={busy}
          >
            {busy ? (
              <RiLoader4Line className="size-3.5 animate-spin" />
            ) : (
              <RiSparkling2Line className="size-3.5" />
            )}
            Re-derive
          </Button>
        </div>
      )}

      <div
        className={cn(
          "divide-y rounded-2xl border bg-card/40 transition-opacity",
          busy && "pointer-events-none opacity-40",
        )}
      >
        <Row label="Genre" rationale={rationale.genre} edited={style.genre !== proposal.genre}>
          <Input
            value={style.genre}
            onChange={(e) => onChange({ genre: e.target.value })}
            placeholder="literary thriller"
          />
        </Row>

        <Row label="Tone" rationale={rationale.tone} edited={style.tone !== proposal.tone}>
          <Input
            value={style.tone}
            onChange={(e) => onChange({ tone: e.target.value })}
            placeholder="bleak, wry, slow-burn dread"
          />
        </Row>

        <Row
          label="Narration"
          rationale={rationale.narration}
          edited={style.pov !== proposal.pov || style.tense !== proposal.tense}
        >
          <div className="flex flex-col items-start gap-2">
            <Segmented
              label="Point of view"
              options={POV_OPTIONS}
              value={style.pov}
              onChange={(pov) => onChange({ pov })}
            />
            <Segmented
              label="Tense"
              options={TENSE_OPTIONS}
              value={style.tense}
              onChange={(tense) => onChange({ tense })}
            />
          </div>
        </Row>

        <Row
          label="Chapter length"
          rationale={rationale.length}
          edited={style.targetChapterWords !== proposal.targetChapterWords}
        >
          <div className="space-y-3">
            <p className="flex items-baseline gap-2">
              <span className="font-heading text-2xl font-semibold tabular-nums">
                {words.toLocaleString("en-US")}
              </span>
              <span className="text-xs text-muted-foreground">
                words · about {readingMinutes(words)} min to read
              </span>
            </p>
            <Slider
              min={CHAPTER_WORDS.min}
              max={CHAPTER_WORDS.max}
              step={CHAPTER_WORDS.step}
              value={[words]}
              onValueChange={([v]) => onChange({ targetChapterWords: v })}
              aria-label="Target chapter length in words"
            />
            <div className="flex justify-between text-[10px] tabular-nums text-muted-foreground">
              <span>{CHAPTER_WORDS.min.toLocaleString("en-US")}</span>
              <span>{CHAPTER_WORDS.max.toLocaleString("en-US")}</span>
            </div>
          </div>
        </Row>

        <Row
          label="Prose rules"
          rationale={rationale.styleNotes}
          edited={style.styleNotes !== proposal.styleNotes}
        >
          <Textarea
            value={style.styleNotes}
            onChange={(e) => onChange({ styleNotes: e.target.value })}
            className="min-h-52 bg-background/40 font-serif text-sm leading-relaxed md:text-sm"
            placeholder="One directive per line."
          />
        </Row>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        These compile into a style contract that is attached to every AI request
        for this novel, and the model is told not to break it.
      </p>
    </div>
  );
}

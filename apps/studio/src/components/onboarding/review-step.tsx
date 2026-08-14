"use client";

import { RiPencilLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import {
  povLabel,
  readingMinutes,
  tenseLabel,
  type Reading,
  type StyleFields,
} from "@behindthestory/core/onboarding";

function Colophon({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-6 py-2.5">
      <dt className="shrink-0 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {term}
      </dt>
      <dd className="text-right text-sm">{children}</dd>
    </div>
  );
}

export function ReviewStep({
  title,
  reading,
  style,
  onJumpTo,
}: {
  title: string;
  reading: Reading;
  style: StyleFields;
  onJumpTo: (step: number) => void;
}) {
  const rules = style.styleNotes
    .split("\n")
    .map((line) => line.trim().replace(/^[-•*]\s*/, ""))
    .filter(Boolean);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-1">
        <Button variant="ghost" size="sm" onClick={() => onJumpTo(1)}>
          <RiPencilLine /> Premise
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onJumpTo(2)}>
          <RiPencilLine /> Style
        </Button>
      </div>

      <article className="rounded-2xl border bg-card/50 px-6 py-12 sm:px-14 sm:py-16">
        <div aria-hidden className="mx-auto mb-10 flex w-20 flex-col gap-1">
          <span className="h-px bg-border" />
          <span className="h-px bg-border/50" />
        </div>

        {style.genre && (
          <p className="text-center text-[10px] font-medium uppercase tracking-[0.3em] text-muted-foreground">
            {style.genre}
          </p>
        )}
        <h2 className="mt-4 text-center font-heading text-4xl font-semibold tracking-tight sm:text-5xl">
          {title}
        </h2>
        <p className="mx-auto mt-6 max-w-xl text-center font-serif text-base italic leading-relaxed text-muted-foreground">
          {reading.logline}
        </p>

        <p
          aria-hidden
          className="my-10 text-center tracking-[0.5em] text-muted-foreground"
        >
          · · ·
        </p>

        <div className="manuscript mx-auto max-w-prose">{reading.premise}</div>

        <dl className="mx-auto mt-12 max-w-prose divide-y border-y">
          <Colophon term="Point of view">{povLabel(style.pov)}</Colophon>
          <Colophon term="Tense">{tenseLabel(style.tense)}</Colophon>
          {style.tone && <Colophon term="Tone">{style.tone}</Colophon>}
          <Colophon term="Chapter length">
            <span className="tabular-nums">
              {style.targetChapterWords.toLocaleString("en-US")}
            </span>{" "}
            words · about {readingMinutes(style.targetChapterWords)} min
          </Colophon>
        </dl>

        {rules.length > 0 && (
          <div className="mx-auto mt-10 max-w-prose">
            <h3 className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
              Prose rules
            </h3>
            <ul className="mt-3 space-y-2">
              {rules.map((rule, i) => (
                <li
                  key={`${i}-${rule}`}
                  className="flex gap-3 font-serif text-sm leading-relaxed text-muted-foreground"
                >
                  <span
                    aria-hidden
                    className="mt-[0.7em] h-px w-3 shrink-0 bg-border"
                  />
                  <span>{rule}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </article>

      <p className="text-center text-xs leading-relaxed text-muted-foreground">
        Creating this sets up the novel and its story bible. Characters,
        locations, chapters and plot threads come next — and everything above
        stays editable.
      </p>
    </div>
  );
}

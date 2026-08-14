"use client";

import { RiCheckLine, RiCompassLine } from "@remixicon/react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { MIN_DESCRIPTION_WORDS, countWords } from "@/lib/onboarding";

/** What the model can actually do something with, in the order it matters. */
const GUIDANCE = [
  {
    question: "Who wants something badly?",
    why: "Voice and motive are derived from this before anything else.",
  },
  {
    question: "What refuses to let them have it?",
    why: "Without real opposition every chapter drifts into atmosphere.",
  },
  {
    question: "Where and when are we?",
    why: "Fixes the vocabulary, the technology and the physics of the world.",
  },
  {
    question: "What should it feel like to read?",
    why: "Becomes the tone half of the style contract in two steps' time.",
  },
];

const PLACEHOLDER = `Start anywhere. For example:

A disgraced cartographer is hired to survey a province that does not appear on any royal map. She takes the job because it is the only work left to her, and because her brother was the last surveyor sent there.

The province is real, the people in it remember a war nobody else does, and every map she draws is quietly corrected overnight…

Add whatever else you already know — the ending, a scene you can already see, the way you want it to sound.`;

export function PremiseStep({
  title,
  description,
  onTitleChange,
  onDescriptionChange,
}: {
  title: string;
  description: string;
  onTitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
}) {
  const words = countWords(description);
  const enough = words >= MIN_DESCRIPTION_WORDS;

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_15rem]">
      <div className="space-y-8">
        <div>
          <Label
            htmlFor="novel-title"
            className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground"
          >
            Working title
          </Label>
          <Input
            id="novel-title"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder="Untitled — or let the AI name it"
            className="mt-2 h-auto rounded-none border-0 border-b bg-transparent px-0 py-2 font-heading text-2xl font-semibold tracking-tight focus-visible:border-primary focus-visible:ring-0 sm:text-3xl md:text-3xl dark:bg-transparent"
          />
        </div>

        <div>
          <Label
            htmlFor="novel-description"
            className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground"
          >
            The story
          </Label>
          <Textarea
            id="novel-description"
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            placeholder={PLACEHOLDER}
            className="mt-2 min-h-[26rem] rounded-xl bg-card/40 p-5 font-serif text-[15px] leading-[1.8] md:text-[15px]"
          />
          <div className="mt-2.5 flex items-baseline justify-between gap-4 text-xs">
            <p className="text-muted-foreground">
              Plot, people, mood, the rules of the world — anything you already
              know. Long is better than tidy.
            </p>
            <span
              className={cn(
                "flex shrink-0 items-center gap-1 tabular-nums",
                enough ? "text-primary" : "text-muted-foreground/70",
              )}
            >
              {enough && <RiCheckLine className="size-3" />}
              {enough ? `${words} words` : `${words} / ${MIN_DESCRIPTION_WORDS}`}
            </span>
          </div>
        </div>
      </div>

      <aside className="h-fit space-y-4 rounded-xl border bg-card/30 p-5 lg:sticky lg:top-0">
        <h2 className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          <RiCompassLine className="size-3.5" /> What helps most
        </h2>
        <ul className="space-y-3.5">
          {GUIDANCE.map((item) => (
            <li key={item.question} className="text-xs leading-relaxed">
              <span className="block font-medium text-foreground">
                {item.question}
              </span>
              <span className="text-muted-foreground">{item.why}</span>
            </li>
          ))}
        </ul>
        <p className="border-t pt-3.5 text-xs leading-relaxed text-muted-foreground">
          You are not filling in a form. The next step is a conversation about
          whatever you write here.
        </p>
      </aside>
    </div>
  );
}

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type FeedbackPrompt = {
  id: string;
  decision: "accepted" | "rejected";
  label: string;
};

export function AiFeedbackDialog({
  prompt,
  onSubmit,
  onSkip,
}: {
  prompt: FeedbackPrompt;
  onSubmit: (rating: number, comment: string) => Promise<void>;
  onSkip: () => void;
}) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!rating || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(rating, comment.trim());
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onSkip()}>
      <DialogContent className="sm:max-w-md" showCloseButton={!submitting}>
        <form className="grid gap-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>How was this suggestion?</DialogTitle>
            <DialogDescription className="text-base/7 sm:text-sm/6">
              You {prompt.decision === "accepted" ? "accepted" : "rejected"}{" "}
              “{prompt.label}”. A quick score helps us improve future prose.
            </DialogDescription>
          </DialogHeader>

          <fieldset className="grid gap-2">
            <legend className="text-base/6 font-medium sm:text-sm/5">
              Rate the AI output from 1 to 5
            </legend>
            <div className="grid grid-cols-5 gap-2">
              {[1, 2, 3, 4, 5].map((value) => (
                <label key={value} className="relative">
                  <input
                    className="peer sr-only"
                    type="radio"
                    name="ai-feedback-rating"
                    value={value}
                    checked={rating === value}
                    onChange={() => setRating(value)}
                    required
                  />
                  <span
                    className={cn(
                      "flex h-10 items-center justify-center rounded-lg border border-input bg-background text-base tabular-nums peer-checked:border-primary peer-checked:bg-primary/10 peer-checked:text-primary peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50 sm:h-8 sm:text-sm",
                    )}
                  >
                    {value}
                  </span>
                </label>
              ))}
            </div>
            <div className="flex justify-between gap-3 text-base/6 text-muted-foreground sm:text-sm/5">
              <p>Not useful</p>
              <p>Excellent</p>
            </div>
          </fieldset>

          <div className="grid gap-2">
            <label
              htmlFor="ai-feedback-comment"
              className="text-base/6 font-medium sm:text-sm/5"
            >
              What worked or missed the mark?
            </label>
            <Textarea
              id="ai-feedback-comment"
              name="ai-feedback-comment"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              maxLength={2_000}
              placeholder="Voice, pacing, continuity, repetition…"
              className="min-h-24 resize-y"
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={onSkip}
              disabled={submitting}
            >
              Not now
            </Button>
            <Button type="submit" disabled={!rating || submitting}>
              {submitting ? "Saving…" : "Send feedback"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

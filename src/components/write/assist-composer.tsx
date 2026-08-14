"use client";

import { RiCloseLine, RiSparkling2Line } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const INSERT_PRESETS = [
  {
    label: "Continue scene",
    instruction: "Continue the scene naturally from this point.",
  },
  {
    label: "Add dialogue",
    instruction:
      "Continue with a dialogue exchange that advances the current tension.",
  },
  {
    label: "Deepen setting",
    instruction:
      "Add a brief passage that grounds this moment in sensory setting details.",
  },
  {
    label: "Bridge beat",
    instruction:
      "Write a concise transition from the current moment toward the next planned beat.",
  },
] as const;

export function AssistComposer({
  instruction,
  selectionActive,
  contextCount,
  onInstructionChange,
  onSubmit,
  onClose,
}: {
  instruction: string;
  selectionActive: boolean;
  contextCount: number;
  onInstructionChange: (value: string) => void;
  onSubmit: (instruction: string) => void;
  onClose: () => void;
}) {
  return (
    <section
      aria-label="AI writing tools"
      className="absolute inset-x-3 bottom-3 z-20 mx-auto max-w-xl rounded-xl bg-popover p-3 ring-1 ring-foreground/10 sm:inset-x-6 sm:bottom-5 sm:p-4 dark:shadow-none"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium">
            {selectionActive ? "Suggest an edit" : "Write at the cursor"}
          </h2>
          <p className="text-base/6 text-muted-foreground sm:text-sm/5">
            {selectionActive
              ? "The original passage will remain until you accept the suggestion."
              : "The new passage will be proposed at your current cursor position."}
          </p>
        </div>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={onClose}
          aria-label="Close writing tools"
          className="relative"
        >
          <RiCloseLine />
          <span
            className="pointer-fine:hidden absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2"
            aria-hidden="true"
          />
        </Button>
      </div>

      {!selectionActive && (
        <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
          {INSERT_PRESETS.map((preset) => (
            <Button
              key={preset.label}
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onInstructionChange(preset.instruction)}
            >
              {preset.label}
            </Button>
          ))}
        </div>
      )}

      <Textarea
        name="ai-direction"
        aria-label="Direction for the writing assistant"
        value={instruction}
        onChange={(event) => onInstructionChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            onSubmit(instruction);
          }
        }}
        rows={3}
        autoFocus
        placeholder={
          selectionActive
            ? "Describe how this passage should change."
            : "Describe what should happen next, or choose a direction above."
        }
        className="mt-2 resize-none bg-background text-base/7 sm:text-sm/6"
      />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-base/6 text-muted-foreground sm:text-sm/5">
          Automatic story context
          {contextCount > 0 ? ` · ${contextCount} pinned` : ""}
        </p>
        <Button
          type="button"
          size="sm"
          onClick={() => onSubmit(instruction)}
          disabled={!instruction.trim() && selectionActive}
        >
          <RiSparkling2Line data-icon="inline-start" /> Generate suggestion
        </Button>
      </div>
    </section>
  );
}

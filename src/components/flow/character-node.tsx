"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Character } from "@/db/schema";
import { formatChapterRef, type CharacterState } from "@/lib/story-state";

/**
 * `state` is the character as of the chapter the canvas is showing, derived from
 * the event log — a character who dies in chapter 12 is alive on this card at
 * chapter 11.
 */
export type CharacterNodeType = Node<
  { character: Character; state: CharacterState },
  "character"
>;

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

const roleStyles: Record<Character["role"], string> = {
  main: "border-primary/60 text-primary",
  side: "border-muted-foreground/40 text-muted-foreground",
  minor: "border-muted-foreground/25 text-muted-foreground/70",
};

export const CharacterNode = memo(function CharacterNode({
  data,
  selected,
}: NodeProps<CharacterNodeType>) {
  const c = data.character;
  const { status, sinceChapter, event } = data.state;
  return (
    <div
      className={cn(
        "w-52 rounded-xl border bg-card/95 p-3 shadow-md backdrop-blur transition-shadow",
        selected ? "border-primary shadow-primary/20" : "border-border",
        status === "dead" && "opacity-60 grayscale",
      )}
      title={
        event?.cause
          ? `${status} since ${formatChapterRef(sinceChapter)} — ${event.cause}`
          : undefined
      }
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!size-2.5 !border-2 !border-background !bg-muted-foreground"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!size-2.5 !border-2 !border-background !bg-primary"
      />
      <div className="flex items-center gap-2.5">
        <div
          className="flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
          style={{ backgroundColor: c.color }}
        >
          {initials(c.name)}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold">{c.name}</span>
            {c.origin === "ai" && (
              <Sparkles className="size-3 shrink-0 text-primary" />
            )}
          </div>
          <Badge
            variant="outline"
            className={cn("mt-0.5 h-4 px-1.5 text-[10px]", roleStyles[c.role])}
          >
            {c.role}
            {status !== "alive" ? ` · ${status} ${formatChapterRef(sinceChapter)}` : ""}
          </Badge>
        </div>
      </div>
      {c.summary && (
        <p className="mt-2 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
          {c.summary}
        </p>
      )}
    </div>
  );
});

"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { Eye, Lightbulb, Shuffle, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StoryElement } from "@/db/schema";

export type ElementNodeType = Node<{ element: StoryElement }, "element">;

export const elementStyles: Record<
  StoryElement["type"],
  { color: string; icon: typeof Eye; label: string }
> = {
  twist: { color: "#f43f5e", icon: Shuffle, label: "Twist" },
  foreshadowing: { color: "#eab308", icon: Eye, label: "Foreshadowing" },
  plot_thread: { color: "#38bdf8", icon: Lightbulb, label: "Plot thread" },
  event: { color: "#a78bfa", icon: Zap, label: "Event" },
};

export const ElementNode = memo(function ElementNode({
  data,
  selected,
}: NodeProps<ElementNodeType>) {
  const e = data.element;
  const style = elementStyles[e.type];
  const Icon = style.icon;
  return (
    <div
      className={cn(
        "w-44 rounded-lg border bg-card/90 p-2 shadow backdrop-blur",
        selected ? "border-primary" : "border-border",
        e.status === "resolved" && "opacity-60",
      )}
      style={{ borderLeftColor: style.color, borderLeftWidth: 3 }}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!size-2 !border !border-background !bg-muted-foreground"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="!size-2 !border !border-background !bg-muted-foreground"
      />
      <div className="flex items-center gap-1.5">
        <Icon className="size-3 shrink-0" style={{ color: style.color }} />
        <span
          className="text-[9px] font-semibold uppercase tracking-wide"
          style={{ color: style.color }}
        >
          {style.label} · {e.status}
        </span>
      </div>
      <p className="mt-1 line-clamp-1 text-xs font-medium">{e.title}</p>
      <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-muted-foreground">
        {e.description}
      </p>
    </div>
  );
});

"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import {
  RiEyeLine,
  RiFlashlightLine,
  RiLightbulbLine,
  RiShuffleLine,
} from "@remixicon/react";
import { cn } from "@/lib/utils";
import type { StoryElement } from "@behindthestory/db/schema";

export type ElementNodeType = Node<{ element: StoryElement }, "element">;

export const elementStyles: Record<
  StoryElement["type"],
  { color: string; icon: typeof RiEyeLine; label: string }
> = {
  twist: { color: "#8c3a5e", icon: RiShuffleLine, label: "Twist" },
  foreshadowing: { color: "#b07d48", icon: RiEyeLine, label: "Foreshadowing" },
  plot_thread: { color: "#3f5e6b", icon: RiLightbulbLine, label: "Plot thread" },
  event: { color: "#6b4c7a", icon: RiFlashlightLine, label: "Event" },
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
        "w-44 border bg-card p-2",
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

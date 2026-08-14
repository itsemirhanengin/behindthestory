"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { RiMapPinLine, RiSparkling2Line } from "@remixicon/react";
import { cn } from "@/lib/utils";
import type { Character, Location } from "@/db/schema";

export type LocationNodeType = Node<
  { location: Location; members: Character[] },
  "location"
>;

export const LocationNode = memo(function LocationNode({
  data,
  selected,
}: NodeProps<LocationNodeType>) {
  const l = data.location;
  return (
    <div
      className={cn(
        "w-56 border bg-card p-3",
        selected ? "border-primary" : "border-border",
      )}
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
      <div className="flex items-center gap-2">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-affirm/15 text-affirm">
          <RiMapPinLine className="size-4" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold">{l.name}</span>
            {l.origin === "ai" && (
              <RiSparkling2Line className="size-3 shrink-0 text-primary" />
            )}
          </div>
          {l.atmosphere && (
            <p className="truncate text-[11px] italic text-muted-foreground">
              {l.atmosphere}
            </p>
          )}
        </div>
      </div>
      {l.description && (
        <p className="mt-2 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
          {l.description}
        </p>
      )}
      {data.members.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {data.members.slice(0, 6).map((c) => (
            <span
              key={c.id}
              title={c.name}
              className="flex size-5 items-center justify-center rounded-none text-[9px] font-bold text-white"
              style={{ backgroundColor: c.color }}
            >
              {c.name
                .split(/\s+/)
                .map((w) => w[0])
                .slice(0, 2)
                .join("")
                .toUpperCase()}
            </span>
          ))}
        </div>
      )}
    </div>
  );
});

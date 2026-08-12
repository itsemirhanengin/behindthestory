"use client";

import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
  type Edge,
} from "@xyflow/react";
import type { Relationship, RelType } from "@/db/schema";
import type { RelationshipState } from "@/lib/story-state";

/**
 * The edge renders a bond *as of a chapter*, never "the bond" — the state comes
 * in derived rather than read off the relationship row, which no longer carries
 * one. `turnCount` is how many times the bond has changed kind up to this point;
 * it is what marks an edge as worth clicking into.
 */
export type RelationshipEdgeType = Edge<
  {
    relationship: Relationship;
    state: RelationshipState;
    turnCount: number;
  },
  "relationship"
>;

export const relationshipColors: Record<RelType, string> = {
  family: "#f59e0b",
  romance: "#ec4899",
  friendship: "#22c55e",
  rivalry: "#f97316",
  mentor: "#3b82f6",
  enemy: "#ef4444",
  ally: "#14b8a6",
  other: "#71717a",
};

export const RelationshipEdge = memo(function RelationshipEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps<RelationshipEdgeType>) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  if (!data) return <BaseEdge id={id} path={edgePath} />;

  const { state, turnCount } = data;
  const color = relationshipColors[state.type];
  const width = 1 + state.closeness * 0.35;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: color,
          strokeWidth: selected ? width + 1 : width,
          opacity: selected ? 1 : 0.75,
        }}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan pointer-events-auto absolute flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium shadow-sm backdrop-blur transition-transform hover:scale-110"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            borderColor: color,
            color,
            backgroundColor: "color-mix(in srgb, var(--card) 90%, transparent)",
          }}
          title={
            turnCount > 0
              ? `This bond has changed kind ${turnCount} time(s) — click for the timeline`
              : "Click for the timeline"
          }
        >
          {state.type} · {state.closeness}
          {turnCount > 0 && (
            // A bond that has reversed reads identically to one that never did
            // without this — the single most misleading thing the old edge did.
            <span className="opacity-70">↻{turnCount}</span>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
});

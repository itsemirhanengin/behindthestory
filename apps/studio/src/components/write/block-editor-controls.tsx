"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { RiDraggable } from "@remixicon/react";
import type { Editor } from "@tiptap/core";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Selecto from "react-selecto";

import {
  blockSelectionKey,
  type BlockSelectionMeta,
} from "@/components/write/block-selection";

type BlockLayout = {
  id: string;
  element: HTMLElement;
  top: number;
  left: number;
  width: number;
  height: number;
  label: string;
};

/* The lifted paragraphs are re-rendered inside a padded card, so the preview
   has to be pulled back by exactly that padding to sit over the original. */
const PREVIEW_PADDING_X = 16;
const PREVIEW_PADDING_Y = 12;
/* Long selections would otherwise hand the reader a page-sized slab. */
const PREVIEW_MAX_HEIGHT = 320;
const HANDLE_OFFSET_X = 34;

type DragPreview = {
  html: string;
  width: number;
  offsetX: number;
  offsetY: number;
  count: number;
  clipped: boolean;
};

type DropZone = {
  id: string;
  top: number;
  height: number;
  lineTop: number;
  left: number;
  width: number;
  disabled: boolean;
};

type Props = {
  editor: Editor;
  scrollElement: HTMLDivElement | null;
  editable: boolean;
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
  onMove: (ids: string[], beforeId: string | null) => void;
  onDragChange: (dragging: boolean) => void;
};

/* Where the handle sits relative to its block — needed both to place it and to
   work out how far the drag preview must travel to cover the real text. */
function handlePosition(block: BlockLayout) {
  return {
    top: block.top + Math.max(0, Math.min(4, block.height / 2 - 14)),
    left: Math.max(4, block.left - HANDLE_OFFSET_X),
  };
}

function DragHandle({
  block,
  selected,
  visible,
  disabled,
  onSelect,
}: {
  block: BlockLayout;
  selected: boolean;
  visible: boolean;
  disabled: boolean;
  onSelect: (event: React.MouseEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: block.id,
    disabled,
  });
  const position = handlePosition(block);

  return (
    <button
      ref={setNodeRef}
      type="button"
      aria-label={`Drag block: ${block.label}`}
      data-no-block-select="true"
      className="pointer-events-auto absolute grid size-7 cursor-grab touch-none place-items-center rounded-md text-muted-foreground/55 transition-[opacity,background-color,color] hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 active:cursor-grabbing ring-ring aria-pressed:text-foreground"
      style={{
        top: position.top,
        left: position.left,
        opacity: isDragging ? 0 : visible ? 1 : 0,
      }}
      onClick={onSelect}
      {...listeners}
      {...attributes}
      aria-pressed={selected}
    >
      <RiDraggable className="size-4" />
    </button>
  );
}

/* One zone per gap between blocks, each spanning from the midpoint of the
   block above to the midpoint of the block below, so the insertion line snaps
   to whichever seam the pointer is nearest. */
function DropZone({ zone, active }: { zone: DropZone; active: boolean }) {
  const { setNodeRef, isOver } = useDroppable({
    id: zone.id,
    disabled: zone.disabled,
  });

  return (
    <div
      ref={setNodeRef}
      className="pointer-events-none absolute inset-x-0"
      style={{ top: zone.top, height: zone.height }}
    >
      {active && isOver && (
        <span
          className="absolute flex items-center"
          style={{
            top: zone.lineTop - zone.top,
            left: zone.left,
            width: zone.width,
          }}
        >
          <span className="size-2 -translate-x-1/2 rounded-full bg-primary" />
          <span className="h-0.5 flex-1 rounded-full bg-primary" />
        </span>
      )}
    </div>
  );
}

export function BlockEditorControls({
  editor,
  scrollElement,
  editable,
  selectedIds,
  onSelect,
  onMove,
  onDragChange,
}: Props) {
  const [blocks, setBlocks] = useState<BlockLayout[]>([]);
  const [contentHeight, setContentHeight] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [dragIds, setDragIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<DragPreview | null>(null);
  const frameRef = useRef<number | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const measure = useCallback(() => {
    const scroller = scrollElement;
    if (!scroller || editor.isDestroyed) return;

    const scrollerRect = scroller.getBoundingClientRect();
    const next: BlockLayout[] = [];

    editor.state.doc.forEach((node, position) => {
      const id = node.attrs.id as string | null;
      const element = editor.view.nodeDOM(position);
      if (!id || !(element instanceof HTMLElement)) return;

      const rect = element.getBoundingClientRect();
      next.push({
        id,
        element,
        top: rect.top - scrollerRect.top + scroller.scrollTop,
        left: rect.left - scrollerRect.left + scroller.scrollLeft,
        width: rect.width,
        height: rect.height,
        label: node.textContent.trim().slice(0, 70) || "Empty block",
      });
    });

    setBlocks(next);
    const lastBlock = next[next.length - 1];
    setContentHeight(
      lastBlock
        ? lastBlock.top + lastBlock.height + 80
        : scroller.clientHeight,
    );
  }, [editor, scrollElement]);

  const scheduleMeasure = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      measure();
    });
  }, [measure]);

  useLayoutEffect(() => {
    scheduleMeasure();
  }, [scheduleMeasure]);

  useEffect(() => {
    const scroller = scrollElement;
    if (!scroller) return;

    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(scroller);
    observer.observe(editor.view.dom);
    editor.on("transaction", scheduleMeasure);
    window.addEventListener("resize", scheduleMeasure);

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      observer.disconnect();
      editor.off("transaction", scheduleMeasure);
      window.removeEventListener("resize", scheduleMeasure);
    };
  }, [editor, scheduleMeasure, scrollElement]);

  useEffect(() => {
    const scroller = scrollElement;
    if (!scroller) return;

    const trackHoveredBlock = (event: PointerEvent) => {
      const rect = scroller.getBoundingClientRect();
      const y = event.clientY - rect.top + scroller.scrollTop;
      const hovered = blocks.find(
        (block) => y >= block.top - 7 && y <= block.top + block.height + 7,
      );
      setHoveredId(hovered?.id ?? null);
    };
    const clearHoveredBlock = () => setHoveredId(null);

    scroller.addEventListener("pointermove", trackHoveredBlock);
    scroller.addEventListener("pointerleave", clearHoveredBlock);
    return () => {
      scroller.removeEventListener("pointermove", trackHoveredBlock);
      scroller.removeEventListener("pointerleave", clearHoveredBlock);
    };
  }, [blocks, scrollElement]);

  /* The text left behind should read as "already picked up", so it dims while
     its copy rides with the cursor. */
  useEffect(() => {
    if (editor.isDestroyed) return;
    const lifted = blockSelectionKey.getState(editor.state)?.lifted;
    if (!lifted?.size && !dragIds.length) return;

    editor.view.dispatch(
      editor.state.tr.setMeta(blockSelectionKey, {
        type: "lift",
        ids: dragIds,
      } satisfies BlockSelectionMeta),
    );
  }, [editor, dragIds]);

  useEffect(() => {
    onDragChange(Boolean(activeId));
    if (!activeId) return;
    document.body.classList.add("is-dragging-block");
    return () => document.body.classList.remove("is-dragging-block");
  }, [activeId, onDragChange]);

  const buildPreview = useCallback(
    (anchorId: string, ids: string[]): DragPreview | null => {
      const order = new Map(blocks.map((block, index) => [block.id, index]));
      const lifted = ids
        .map((id) => blocks.find((block) => block.id === id))
        .filter((block): block is BlockLayout => Boolean(block))
        .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

      const anchor = blocks.find((block) => block.id === anchorId);
      const first = lifted[0];
      const last = lifted[lifted.length - 1];
      if (!anchor || !first || !last) return null;

      const html = lifted
        .map((block) => {
          const clone = block.element.cloneNode(true) as HTMLElement;
          clone.classList.remove("block-range-selected", "block-lifted");
          clone.removeAttribute("data-block-selected");
          clone.removeAttribute("id");
          for (const node of clone.querySelectorAll("[id]")) {
            node.removeAttribute("id");
          }
          return clone.outerHTML;
        })
        .join("");

      const handle = handlePosition(anchor);
      return {
        html,
        width: first.width,
        /* Line the copy up with the paragraphs it was cut from, so the drag
           starts as a lift rather than a card appearing under the cursor. */
        offsetX: first.left - handle.left - PREVIEW_PADDING_X,
        offsetY: first.top - handle.top - PREVIEW_PADDING_Y,
        count: lifted.length,
        clipped: last.top + last.height - first.top > PREVIEW_MAX_HEIGHT,
      };
    },
    [blocks],
  );

  const beginDrag = (event: DragStartEvent) => {
    const id = String(event.active.id);
    const ids = selectedIds.includes(id) ? selectedIds : [id];
    if (!selectedIds.includes(id)) onSelect(ids);
    setDragIds(ids);
    setActiveId(id);
    setPreview(buildPreview(id, ids));
  };

  const endDrag = () => {
    setActiveId(null);
    setDragIds([]);
    setPreview(null);
  };

  const finishDrag = (event: DragEndEvent) => {
    const overId = event.over ? String(event.over.id) : null;
    const ids = dragIds;
    endDrag();
    if (!overId?.startsWith("before:")) return;

    const beforeId = overId.slice("before:".length);
    if (beforeId === "__end__") {
      onMove(ids, null);
    } else if (!ids.includes(beforeId)) {
      onMove(ids, beforeId);
    }
  };

  /* Pointer position decides the seam; the rect fallback only matters for the
     keyboard sensor, which has no pointer to test. */
  const detectCollisions = useCallback<CollisionDetection>((args) => {
    const pointerCollisions = pointerWithin(args);
    return pointerCollisions.length ? pointerCollisions : closestCenter(args);
  }, []);

  const dropZones = useMemo<DropZone[]>(() => {
    if (!blocks.length) return [];

    const lifted = new Set(dragIds);
    const liftedIndexes = blocks
      .map((block, index) => (lifted.has(block.id) ? index : -1))
      .filter((index) => index >= 0);
    const firstLifted = liftedIndexes[0] ?? -1;
    const lastLifted = liftedIndexes[liftedIndexes.length - 1] ?? -2;

    const zones: DropZone[] = [];
    for (let index = 0; index <= blocks.length; index += 1) {
      const previous = blocks[index - 1];
      const next = blocks[index];
      const anchor = next ?? previous;
      const top = previous ? previous.top + previous.height / 2 : 0;
      const bottom = next ? next.top + next.height / 2 : contentHeight;

      zones.push({
        id: next ? `before:${next.id}` : "before:__end__",
        top,
        height: Math.max(1, bottom - top),
        lineTop: next ? next.top - 5 : previous.top + previous.height + 5,
        left: anchor.left,
        width: anchor.width,
        /* Both seams hugging the lifted run put it back where it started. */
        disabled: index >= firstLifted && index <= lastLifted + 1,
      });
    }
    return zones;
  }, [blocks, contentHeight, dragIds]);

  const selectableBlocks = blocks.map((block) => block.element);
  const selectedSet = new Set(selectedIds);

  return (
    <>
      {editable && scrollElement && (
        <Selecto
          container={scrollElement}
          dragContainer={scrollElement}
          selectableTargets={selectableBlocks}
          selectByClick={false}
          selectFromInside={false}
          toggleContinueSelect="shift"
          hitRate={8}
          keyContainer={window}
          scrollOptions={{ container: scrollElement, throttleTime: 30 }}
          preventClickEventOnDrag
          onDragStart={(event) => {
            const inputEvent = event.inputEvent as PointerEvent;
            const target = inputEvent.target as Element | null;
            if (
              (inputEvent.pointerType && inputEvent.pointerType !== "mouse") ||
              target?.closest("[data-no-block-select]")
            ) {
              event.stop();
            }
          }}
          onSelectEnd={(event) => {
            const ids = event.selected
              .map((element) => element.getAttribute("data-id"))
              .filter((id): id is string => Boolean(id));
            onSelect(ids);
          }}
        />
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={detectCollisions}
        measuring={{ droppable: { strategy: MeasuringStrategy.WhileDragging } }}
        onDragStart={beginDrag}
        onDragCancel={endDrag}
        onDragEnd={finishDrag}
      >
        <div
          aria-hidden={!editable}
          className="pointer-events-none absolute inset-x-0 top-0 z-30 hidden sm:block"
          style={{ height: contentHeight }}
        >
          {editable &&
            blocks.map((block) => (
              <DragHandle
                key={block.id}
                block={block}
                selected={selectedSet.has(block.id)}
                visible={
                  !activeId &&
                  (hoveredId === block.id || selectedSet.has(block.id))
                }
                disabled={Boolean(activeId && activeId !== block.id)}
                onSelect={(event) => {
                  event.stopPropagation();
                  if (event.shiftKey) {
                    onSelect(
                      selectedSet.has(block.id)
                        ? selectedIds.filter((id) => id !== block.id)
                        : [...selectedIds, block.id],
                    );
                  } else {
                    onSelect([block.id]);
                  }
                }}
              />
            ))}

          {dropZones.map((zone) => (
            <DropZone key={zone.id} zone={zone} active={Boolean(activeId)} />
          ))}
        </div>

        {/* Under the controls layer, so the insertion line stays readable even
            when the lifted text is passing over it. */}
        <DragOverlay dropAnimation={null} zIndex={20}>
          {preview ? (
            <div
              className="pointer-events-none"
              style={{
                width: preview.width + PREVIEW_PADDING_X * 2,
                transform: `translate3d(${preview.offsetX}px, ${preview.offsetY}px, 0)`,
              }}
            >
              <div
                className="prose-editor relative overflow-hidden rounded-lg bg-card/90 px-4 py-3 text-foreground shadow-[0_18px_40px_-16px_rgba(0,0,0,0.45)] ring-1 ring-primary/30 backdrop-blur-[2px]"
                style={
                  preview.clipped
                    ? {
                        maxHeight: PREVIEW_MAX_HEIGHT,
                        maskImage:
                          "linear-gradient(to bottom, black calc(100% - 3.5rem), transparent)",
                      }
                    : undefined
                }
                dangerouslySetInnerHTML={{ __html: preview.html }}
              />
              {preview.count > 1 && (
                <span className="absolute -top-2 -left-2 grid min-w-5 place-items-center rounded-full bg-primary px-1.5 py-0.5 font-sans text-[10px] font-semibold text-primary-foreground tabular-nums shadow-sm">
                  {preview.count}
                </span>
              )}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </>
  );
}

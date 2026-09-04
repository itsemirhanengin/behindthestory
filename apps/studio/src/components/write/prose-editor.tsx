"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import { Extension } from "@tiptap/core";
import UniqueID from "@tiptap/extension-unique-id";
import { EditorContent, useEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { Markdown } from "@tiptap/markdown";
import { type Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import StarterKit from "@tiptap/starter-kit";
import { RiBold, RiItalic } from "@remixicon/react";

import { Button } from "@/components/ui/button";
import { BlockEditorControls } from "@/components/write/block-editor-controls";
import {
  BlockSelection,
  blockSelectionKey,
  type BlockSelectionMeta,
} from "@/components/write/block-selection";

export type SuggestionMode = "insert" | "replace";

export type SuggestionContext = {
  before: string;
  text: string;
  after: string;
};

type TrackedSuggestion = {
  from: number;
  to: number;
  mode: SuggestionMode;
};

type SuggestionMeta =
  | { type: "set"; value: TrackedSuggestion }
  | { type: "clear" };

const suggestionKey = new PluginKey<TrackedSuggestion | null>(
  "behindthestory-ai-suggestion",
);

const SuggestionRange = Extension.create({
  name: "behindthestorySuggestionRange",

  addProseMirrorPlugins() {
    return [
      new Plugin<TrackedSuggestion | null>({
        key: suggestionKey,
        state: {
          init: () => null,
          apply(transaction, previous) {
            const meta = transaction.getMeta(suggestionKey) as
              | SuggestionMeta
              | undefined;
            if (meta?.type === "clear") return null;
            if (meta?.type === "set") return meta.value;
            if (!previous || !transaction.docChanged) return previous;

            const collapsed = previous.from === previous.to;
            const from = transaction.mapping.map(previous.from, 1);
            const to = collapsed
              ? from
              : transaction.mapping.map(previous.to, -1);

            if (from < 0 || to < from || to > transaction.doc.content.size) {
              return null;
            }
            return { ...previous, from, to };
          },
        },
        props: {
          decorations(state) {
            const tracked = suggestionKey.getState(state);
            if (!tracked) return null;

            if (tracked.from === tracked.to) {
              return DecorationSet.create(state.doc, [
                Decoration.widget(
                  tracked.from,
                  () => {
                    const marker = document.createElement("span");
                    marker.className = "ai-suggestion-anchor";
                    marker.setAttribute("aria-hidden", "true");
                    return marker;
                  },
                  { key: "behindthestory-ai-anchor", side: -1 },
                ),
              ]);
            }

            return DecorationSet.create(state.doc, [
              Decoration.inline(tracked.from, tracked.to, {
                class: "ai-suggestion-target",
                "data-ai-suggestion": "true",
              }),
            ]);
          },
        },
      }),
    ];
  },
});

export type ProseEditorHandle = {
  getMarkdown: () => string;
  setMarkdown: (markdown: string) => void;
  getSelectionContext: () => SuggestionContext | null;
  hasSelection: () => boolean;
  focus: (position?: "current" | "end") => void;
  highlightQuote: (quote: string) => boolean;
  startSuggestion: (
    mode: SuggestionMode,
    options?: { atEnd?: boolean },
  ) => SuggestionContext | null;
  acceptSuggestion: (markdown: string) => boolean;
  discardSuggestion: () => void;
};

type Props = {
  initialMarkdown: string;
  editable: boolean;
  placeholder?: string;
  onChange: () => void;
  bubbleActions?: React.ReactNode;
  showBubbleMenu?: boolean;
};

function contextForRange(
  doc: ProseMirrorNode,
  from: number,
  to: number,
): SuggestionContext {
  return {
    before: doc.textBetween(Math.max(0, from - 1800), from, "\n\n", " "),
    text: doc.textBetween(from, to, "\n\n", " "),
    after: doc.textBetween(
      to,
      Math.min(doc.content.size, to + 1800),
      "\n\n",
      " ",
    ),
  };
}

export const ProseEditor = forwardRef<ProseEditorHandle, Props>(
  function ProseEditor(
    {
      initialMarkdown,
      editable,
      placeholder,
      onChange,
      bubbleActions,
      showBubbleMenu = true,
    },
    ref,
  ) {
    const [scrollElement, setScrollElement] =
      useState<HTMLDivElement | null>(null);
    const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>([]);
    const [draggingBlocks, setDraggingBlocks] = useState(false);
    const extensions = useMemo(
      () => [
        StarterKit.configure({ heading: false, codeBlock: false }),
        Markdown,
        UniqueID.configure({
          attributeName: "id",
          types: [
            "paragraph",
            "blockquote",
            "bulletList",
            "orderedList",
            "horizontalRule",
          ],
        }),
        BlockSelection,
        SuggestionRange,
      ],
      [],
    );

    const editor = useEditor({
      immediatelyRender: false,
      extensions,
      content: initialMarkdown,
      contentType: "markdown",
      editorProps: {
        attributes: {
          class: "prose-editor focus:outline-none",
          "aria-label": "Chapter manuscript",
        },
      },
      onUpdate,
    });

    function onUpdate({ transaction }: { transaction: Transaction }) {
      if (
        transaction.getMeta("__uniqueIDTransaction") ||
        transaction.getMeta("addToHistory") === false
      ) {
        return;
      }
      onChange();
    }

    useEffect(() => {
      editor?.setEditable(editable);
    }, [editor, editable]);

    const selectBlocks = useCallback(
      (ids: string[]) => {
        if (!editor || editor.isDestroyed) return;

        const requestedIds = new Set(ids);
        const documentBlocks: { id: string; from: number; to: number }[] = [];
        editor.state.doc.forEach((node, position) => {
          const id = node.attrs.id as string | null;
          if (id) {
            documentBlocks.push({
              id,
              from: position,
              to: position + node.nodeSize,
            });
          }
        });

        const selectedIndexes = documentBlocks
          .map((block, index) => (requestedIds.has(block.id) ? index : -1))
          .filter((index) => index >= 0);
        const firstIndex = selectedIndexes[0] ?? 0;
        const lastIndex = selectedIndexes.at(-1) ?? -1;
        const selectedBlocks = selectedIndexes.length
          ? documentBlocks.slice(firstIndex, lastIndex + 1)
          : [];
        const uniqueIds = selectedBlocks.map((block) => block.id);
        const ranges: { from: number; to: number }[] = [];
        ranges.push(
          ...selectedBlocks.map((block) => ({
            from: block.from,
            to: block.to,
          })),
        );

        const tr = editor.state.tr.setMeta(blockSelectionKey, {
          type: uniqueIds.length ? "set" : "clear",
          ...(uniqueIds.length ? { ids: uniqueIds } : {}),
        } as BlockSelectionMeta);

        if (ranges.length) {
          const from = Math.min(
            editor.state.doc.content.size,
            ranges[0].from + 1,
          );
          const last = ranges[ranges.length - 1];
          const to = Math.max(from, Math.min(last.to - 1, tr.doc.content.size));
          tr.setSelection(
            TextSelection.between(tr.doc.resolve(from), tr.doc.resolve(to)),
          );
        }

        editor.view.dispatch(tr);
        setSelectedBlockIds(uniqueIds);

        if (uniqueIds.length) {
          requestAnimationFrame(() => editor.view.focus());
        }
      },
      [editor],
    );

    const moveBlocks = useCallback(
      (ids: string[], beforeId: string | null) => {
        if (!editor || editor.isDestroyed || !ids.length) return;

        const selected = new Set(ids);
        const blocks: {
          id: string;
          node: ProseMirrorNode;
          from: number;
          to: number;
        }[] = [];
        editor.state.doc.forEach((node, position) => {
          const id = node.attrs.id as string | null;
          if (id) {
            blocks.push({
              id,
              node,
              from: position,
              to: position + node.nodeSize,
            });
          }
        });

        const moving = blocks.filter((block) => selected.has(block.id));
        const remaining = blocks.filter((block) => !selected.has(block.id));
        if (!moving.length || (beforeId && selected.has(beforeId))) return;

        const insertAt = beforeId
          ? remaining.findIndex((block) => block.id === beforeId)
          : remaining.length;
        if (insertAt < 0) return;

        const currentIds = blocks.map((block) => block.id);
        const reorderedIds = [
          ...remaining.slice(0, insertAt).map((block) => block.id),
          ...moving.map((block) => block.id),
          ...remaining.slice(insertAt).map((block) => block.id),
        ];
        if (reorderedIds.every((id, index) => id === currentIds[index])) {
          return;
        }

        const targetPosition = beforeId
          ? blocks.find((block) => block.id === beforeId)?.from
          : editor.state.doc.content.size;
        if (targetPosition === undefined) return;

        const tr = editor.state.tr;
        for (const block of [...moving].sort((a, b) => b.from - a.from)) {
          tr.delete(block.from, block.to);
        }
        const mappedTarget = tr.mapping.map(targetPosition, -1);
        let insertionPosition = mappedTarget;
        for (const block of moving) {
          tr.insert(insertionPosition, block.node);
          insertionPosition += block.node.nodeSize;
        }
        tr.setMeta(blockSelectionKey, {
          type: "set",
          ids,
        } satisfies BlockSelectionMeta);

        editor.view.dispatch(tr);
        setSelectedBlockIds(ids);
      },
      [editor],
    );

    /* Clicking anywhere in the page column dismisses a selection — including
       the margins beside the text, which are part of the page as far as the
       writer is concerned even though they are not part of the contenteditable.
       Selections made outside this column (an AI panel, the bubble menu) are
       left alone, since those act *on* the selection. */
    useEffect(() => {
      if (!editor || !scrollElement) return;

      const dismissSelection = (event: PointerEvent) => {
        const target = event.target as Element | null;
        if (!target || target.closest("[data-no-block-select]")) return;

        const insideText = editor.view.dom.contains(target);
        /* Only the page itself dismisses: the scroller and the wrappers around
           the document contain the editor DOM, anything else layered over the
           column (bubble menu, popovers) does not. */
        if (!insideText && !target.contains(editor.view.dom)) return;

        const hasBlockSelection = Boolean(
          blockSelectionKey.getState(editor.state)?.selected.size,
        );
        if (!hasBlockSelection && (insideText || editor.state.selection.empty)) {
          return;
        }

        const tr = editor.state.tr;
        if (hasBlockSelection) {
          tr.setMeta(blockSelectionKey, {
            type: "clear",
          } satisfies BlockSelectionMeta);
        }
        if (!insideText) {
          tr.setSelection(
            TextSelection.near(tr.doc.resolve(editor.state.selection.from)),
          );
        }
        editor.view.dispatch(tr);
        setSelectedBlockIds([]);

        /* A margin click moves focus out of the contenteditable, and the
           browser keeps the stale range painted once ProseMirror stops
           mirroring it — so drop the DOM range by hand. */
        if (!insideText) {
          requestAnimationFrame(() => {
            if (editor.isDestroyed || editor.view.hasFocus()) return;
            window.getSelection()?.removeAllRanges();
          });
        }
      };

      scrollElement.addEventListener("pointerdown", dismissSelection, true);
      return () => {
        scrollElement.removeEventListener("pointerdown", dismissSelection, true);
      };
    }, [editor, scrollElement]);

    useImperativeHandle(
      ref,
      (): ProseEditorHandle => ({
        getMarkdown: () => editor?.getMarkdown() ?? "",
        setMarkdown: (markdown) => {
          if (!editor) return;
          editor.commands.setContent(markdown, {
            contentType: "markdown",
            emitUpdate: false,
          });
          editor.view.dispatch(
            editor.state.tr
              .setMeta(suggestionKey, { type: "clear" })
              .setMeta(blockSelectionKey, { type: "clear" }),
          );
          setSelectedBlockIds([]);
        },
        getSelectionContext: () => {
          if (!editor) return null;
          const { from, to } = editor.state.selection;
          if (from === to) return null;
          return contextForRange(editor.state.doc, from, to);
        },
        hasSelection: () => {
          if (!editor) return false;
          return !editor.state.selection.empty;
        },
        focus: (position = "current") => {
          if (!editor) return;
          editor.commands.focus(position === "end" ? "end" : undefined);
        },
        highlightQuote: (quote) => {
          if (!editor) return false;
          const needle = quote.trim();
          if (!needle) return false;

          let found: { from: number; to: number } | null = null;
          editor.state.doc.descendants((node, pos) => {
            if (found || !node.isText || !node.text) return true;
            const index = node.text.indexOf(needle);
            if (index !== -1) {
              found = { from: pos + index, to: pos + index + needle.length };
            }
            return true;
          });
          if (!found) return false;

          const range: { from: number; to: number } = found;
          editor.chain().focus().setTextSelection(range).run();
          const coords = editor.view.coordsAtPos(range.from);
          editor.view.dom.parentElement?.scrollBy({
            top: coords.top - window.innerHeight / 2,
            behavior: "smooth",
          });
          return true;
        },
        startSuggestion: (mode, options) => {
          if (!editor || suggestionKey.getState(editor.state)) return null;

          const selection = editor.state.selection;
          if (mode === "replace" && selection.empty) return null;

          const position = options?.atEnd
            ? editor.state.doc.content.size
            : selection.from;
          const tracked: TrackedSuggestion =
            mode === "replace"
              ? { from: selection.from, to: selection.to, mode }
              : { from: position, to: position, mode };

          const context = contextForRange(
            editor.state.doc,
            tracked.from,
            tracked.to,
          );
          editor.view.dispatch(
            editor.state.tr.setMeta(suggestionKey, {
              type: "set",
              value: tracked,
            } satisfies SuggestionMeta),
          );
          return context;
        },
        acceptSuggestion: (markdown) => {
          if (!editor) return false;
          const tracked = suggestionKey.getState(editor.state);
          if (!tracked || !markdown.trim()) return false;

          editor.view.dispatch(
            editor.state.tr.setMeta(suggestionKey, { type: "clear" }),
          );
          editor
            .chain()
            .focus()
            .insertContentAt(
              { from: tracked.from, to: tracked.to },
              markdown.trim(),
              { contentType: "markdown", updateSelection: true },
            )
            .run();
          return true;
        },
        discardSuggestion: () => {
          if (!editor) return;
          editor.view.dispatch(
            editor.state.tr.setMeta(suggestionKey, { type: "clear" }),
          );
        },
      }),
      [editor],
    );

    if (!editor) return <div className="min-h-0 flex-1" />;

    return (
      <div
        ref={setScrollElement}
        className="relative min-h-0 flex-1 overflow-y-auto"
      >
        {/* A toolbar anchored to the selection has nowhere sensible to sit
            while that selection is being carried across the page. */}
        {showBubbleMenu && editable && !draggingBlocks && (
          <BubbleMenu
            editor={editor}
            shouldShow={({ from, to }) => editable && to > from}
            options={{
              strategy: "fixed",
              placement: "top",
              offset: 8,
              flip: true,
              shift: { padding: 8 },
            }}
            className="flex max-w-[calc(100vw-1rem)] items-center gap-1 overflow-x-auto rounded-lg bg-popover p-1 ring-1 ring-foreground/10"
          >
            <Button
              type="button"
              variant={editor.isActive("bold") ? "secondary" : "ghost"}
              size="icon-sm"
              aria-label="Bold"
              aria-pressed={editor.isActive("bold")}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => editor.chain().focus().toggleBold().run()}
            >
              <RiBold />
            </Button>
            <Button
              type="button"
              variant={editor.isActive("italic") ? "secondary" : "ghost"}
              size="icon-sm"
              aria-label="Italic"
              aria-pressed={editor.isActive("italic")}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => editor.chain().focus().toggleItalic().run()}
            >
              <RiItalic />
            </Button>
            {bubbleActions}
          </BubbleMenu>
        )}

        <BlockEditorControls
          editor={editor}
          scrollElement={scrollElement}
          editable={editable}
          selectedIds={selectedBlockIds}
          onSelect={selectBlocks}
          onMove={moveBlocks}
          onDragChange={setDraggingBlocks}
        />

        {/* One column holds both the document and its placeholder: `ch` is
            relative to the element's own font, so two separately centred
            boxes would land in different places. */}
        <div className="relative mx-auto min-h-full w-full max-w-[72ch] px-5 pt-10 pb-[30dvh] sm:px-8 sm:pt-14 lg:px-10">
          <EditorContent editor={editor} />

          {editor.isEmpty && placeholder && (
            <p className="pointer-events-none absolute inset-x-5 top-10 font-serif text-[1.0625rem] leading-[1.8] text-muted-foreground/55 sm:inset-x-8 sm:top-14 lg:inset-x-10">
              {placeholder}
            </p>
          )}
        </div>
      </div>
    );
  },
);

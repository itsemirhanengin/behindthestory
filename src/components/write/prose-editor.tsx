"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type MentionItem = {
  kind: "character" | "location" | "element";
  id: string;
  label: string;
};

export type ProseEditorHandle = {
  /** Current document serialized as Markdown. */
  getMarkdown: () => string;
  /** Replaces the whole document. Used when loading a chapter. */
  setMarkdown: (markdown: string) => void;
  /** The selected passage plus the prose on either side, for inline edits. */
  getSelectionContext: () => {
    before: string;
    text: string;
    after: string;
  } | null;
  focus: () => void;
  /** Selects and scrolls to a verbatim passage. Returns false if not found. */
  highlightQuote: (quote: string) => boolean;
  /** Streaming: append a fresh region at the end of the document. */
  beginAppendStream: () => void;
  /** Streaming: replace the current selection with generated prose. */
  beginReplaceStream: () => void;
  pushStreamDelta: (text: string) => void;
  /** Commits the streamed region, re-parsing it as Markdown. */
  endStream: () => void;
};

type Props = {
  /** Only used to seed the document; further updates go through the handle. */
  initialMarkdown: string;
  editable: boolean;
  placeholder?: string;
  onChange: () => void;
  mentionSource: () => MentionItem[];
  onMention: (item: MentionItem) => void;
  /** Rendered inside the selection bubble menu. */
  bubbleActions?: React.ReactNode;
};

/** Splits streamed text into paragraph nodes without parsing Markdown yet. */
function plainParagraphs(text: string) {
  const blocks = text.split(/\n{2,}/);
  return blocks.map((block) => {
    const line = block.replace(/\n/g, " ");
    return line
      ? { type: "paragraph", content: [{ type: "text", text: line }] }
      : { type: "paragraph" };
  });
}

export const ProseEditor = forwardRef<ProseEditorHandle, Props>(
  function ProseEditor(
    {
      initialMarkdown,
      editable,
      placeholder,
      onChange,
      mentionSource,
      onMention,
      bubbleActions,
    },
    ref,
  ) {
    const [mention, setMention] = useState<{
      query: string;
      from: number;
      to: number;
      left: number;
      top: number;
    } | null>(null);

    // Streaming state. Kept in refs so deltas never trigger a React render.
    const streamRef = useRef<{
      from: number;
      raw: string;
      frame: number | null;
    } | null>(null);

    const editor = useEditor({
      immediatelyRender: false,
      extensions: [
        StarterKit.configure({
          heading: false,
          codeBlock: false,
        }),
        Markdown,
      ],
      content: initialMarkdown,
      contentType: "markdown",
      editorProps: {
        attributes: {
          class: "prose-editor focus:outline-none",
        },
      },
      onUpdate: () => {
        if (!streamRef.current) onChange();
      },
    });

    useEffect(() => {
      editor?.setEditable(editable);
    }, [editor, editable]);

    // --- @mention -------------------------------------------------------
    const detectMention = useCallback(
      (ed: Editor) => {
        const { from, empty } = ed.state.selection;
        if (!empty || !ed.isEditable) {
          setMention(null);
          return;
        }
        const start = Math.max(0, from - 30);
        const before = ed.state.doc.textBetween(start, from, "\n", "\n");
        const match = before.match(/@([\p{L}\p{N} '’-]{0,24})$/u);
        if (!match) {
          setMention(null);
          return;
        }
        const coords = ed.view.coordsAtPos(from);
        setMention({
          query: match[1],
          from: from - match[0].length,
          to: from,
          left: coords.left,
          top: coords.bottom,
        });
      },
      [],
    );

    useEffect(() => {
      if (!editor) return;
      const handler = () => detectMention(editor);
      editor.on("selectionUpdate", handler);
      editor.on("update", handler);
      return () => {
        editor.off("selectionUpdate", handler);
        editor.off("update", handler);
      };
    }, [editor, detectMention]);

    const items = mention
      ? mentionSource()
          .filter((m) =>
            m.label.toLowerCase().includes(mention.query.toLowerCase()),
          )
          .slice(0, 6)
      : [];

    const applyMention = useCallback(
      (item: MentionItem) => {
        if (!editor || !mention) return;
        editor
          .chain()
          .focus()
          .insertContentAt({ from: mention.from, to: mention.to }, item.label)
          .run();
        setMention(null);
        onMention(item);
      },
      [editor, mention, onMention],
    );

    // --- Streaming ------------------------------------------------------
    const renderStream = useCallback(() => {
      const stream = streamRef.current;
      if (!editor || !stream) return;
      stream.frame = null;
      const to = editor.state.doc.content.size;
      editor
        .chain()
        .insertContentAt(
          { from: stream.from, to },
          plainParagraphs(stream.raw),
          { updateSelection: false },
        )
        .run();
      // Keep the newest prose in view without stealing the caret.
      editor.view.dom.parentElement?.scrollTo({
        top: editor.view.dom.scrollHeight,
        behavior: "smooth",
      });
    }, [editor]);

    useImperativeHandle(
      ref,
      (): ProseEditorHandle => ({
        getMarkdown: () => editor?.getMarkdown() ?? "",
        setMarkdown: (markdown) => {
          editor?.commands.setContent(markdown, { contentType: "markdown" });
        },
        getSelectionContext: () => {
          if (!editor) return null;
          const { from, to } = editor.state.selection;
          if (to - from === 0) return null;
          const doc = editor.state.doc;
          return {
            before: doc.textBetween(Math.max(0, from - 1500), from, "\n\n", " "),
            text: doc.textBetween(from, to, "\n\n", " "),
            after: doc.textBetween(
              to,
              Math.min(doc.content.size, to + 1500),
              "\n\n",
              " ",
            ),
          };
        },
        focus: () => editor?.commands.focus("end"),
        highlightQuote: (quote) => {
          if (!editor) return false;
          const needle = quote.trim();
          if (!needle) return false;
          // Walk text nodes so the match maps back to real document positions.
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
          editor.view.dom
            .querySelector(".ProseMirror-selectednode")
            ?.scrollIntoView({ block: "center" });
          const coords = editor.view.coordsAtPos(range.from);
          editor.view.dom.parentElement?.scrollBy({
            top: coords.top - window.innerHeight / 2,
            behavior: "smooth",
          });
          return true;
        },
        beginAppendStream: () => {
          if (!editor) return;
          const empty = editor.state.doc.textContent.trim().length === 0;
          if (!empty) {
            // Start the generated passage in its own paragraph.
            editor
              .chain()
              .focus("end")
              .insertContentAt(editor.state.doc.content.size, {
                type: "paragraph",
              })
              .run();
          }
          streamRef.current = {
            from: empty ? 0 : editor.state.doc.content.size - 2,
            raw: "",
            frame: null,
          };
        },
        beginReplaceStream: () => {
          if (!editor) return;
          const { from, to } = editor.state.selection;
          editor.chain().insertContentAt({ from, to }, "").run();
          streamRef.current = { from, raw: "", frame: null };
        },
        pushStreamDelta: (text) => {
          const stream = streamRef.current;
          if (!stream) return;
          stream.raw += text;
          // Throttle to one repaint per frame — rewriting the streamed region
          // on every token makes long generations crawl.
          if (stream.frame === null) {
            stream.frame = requestAnimationFrame(renderStream);
          }
        },
        endStream: () => {
          const stream = streamRef.current;
          if (!editor || !stream) return;
          if (stream.frame !== null) cancelAnimationFrame(stream.frame);
          streamRef.current = null;
          const to = editor.state.doc.content.size;
          // Re-parse the finished passage so Markdown emphasis and scene
          // breaks become real nodes rather than literal asterisks.
          editor
            .chain()
            .insertContentAt({ from: stream.from, to }, stream.raw.trim(), {
              contentType: "markdown",
              updateSelection: false,
            })
            .run();
          onChange();
        },
      }),
      [editor, renderStream, onChange],
    );

    if (!editor) {
      return <div className="min-h-0 flex-1" />;
    }

    return (
      <div className="relative min-h-0 flex-1 overflow-y-auto">
        {bubbleActions && (
          <BubbleMenu
            editor={editor}
            shouldShow={({ from, to }) => editable && to - from > 0}
            className="flex items-center gap-1 rounded-lg border bg-popover p-1 shadow-xl"
          >
            {bubbleActions}
          </BubbleMenu>
        )}

        <EditorContent
          editor={editor}
          className="mx-auto min-h-full w-full max-w-3xl px-10 py-8"
        />

        {editor.isEmpty && placeholder && (
          <p className="pointer-events-none absolute left-1/2 top-8 w-full max-w-3xl -translate-x-1/2 px-10 text-[15px] leading-relaxed text-muted-foreground/50">
            {placeholder}
          </p>
        )}

        {mention && items.length > 0 && (
          <div
            className="fixed z-50 w-64 overflow-hidden rounded-lg border bg-popover shadow-xl"
            style={{ left: mention.left, top: mention.top + 6 }}
          >
            {items.map((m) => (
              <button
                key={`${m.kind}-${m.id}`}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-sm",
                  "hover:bg-accent",
                )}
                onMouseDown={(e) => {
                  e.preventDefault();
                  applyMention(m);
                }}
              >
                <Badge variant="outline" className="text-[9px] uppercase">
                  {m.kind}
                </Badge>
                {m.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  },
);

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export type BlockSelectionMeta =
  | { type: "set"; ids: string[] }
  | { type: "clear" }
  | { type: "lift"; ids: string[] };

export type BlockSelectionState = {
  /** Blocks the writer has picked out, highlighted as a range. */
  selected: ReadonlySet<string>;
  /** Blocks currently riding with the cursor in a drag, dimmed in place. */
  lifted: ReadonlySet<string>;
};

const EMPTY: BlockSelectionState = {
  selected: new Set<string>(),
  lifted: new Set<string>(),
};

export const blockSelectionKey = new PluginKey<BlockSelectionState>(
  "storyforge-block-selection",
);

export const BlockSelection = Extension.create({
  name: "storyforgeBlockSelection",

  addProseMirrorPlugins() {
    return [
      new Plugin<BlockSelectionState>({
        key: blockSelectionKey,
        state: {
          init: () => EMPTY,
          apply(transaction, previous) {
            const meta = transaction.getMeta(blockSelectionKey) as
              | BlockSelectionMeta
              | undefined;

            if (meta?.type === "clear") {
              return { ...previous, selected: EMPTY.selected };
            }
            if (meta?.type === "set") {
              return { ...previous, selected: new Set(meta.ids) };
            }
            if (meta?.type === "lift") {
              return { ...previous, lifted: new Set(meta.ids) };
            }
            return previous;
          },
        },
        props: {
          /* Both states are painted from here rather than by touching the DOM
             directly: ProseMirror rewrites a node's class and style whenever it
             repaints decorations, so anything applied from outside is lost. */
          decorations(state) {
            const blockState = blockSelectionKey.getState(state);
            if (!blockState?.selected.size && !blockState?.lifted.size) {
              return null;
            }

            const decorations: Decoration[] = [];
            state.doc.forEach((node, position) => {
              const id = node.attrs.id as string | null;
              if (!id) return;

              const classes = [
                blockState.selected.has(id) ? "block-range-selected" : null,
                blockState.lifted.has(id) ? "block-lifted" : null,
              ].filter(Boolean);
              if (!classes.length) return;

              decorations.push(
                Decoration.node(position, position + node.nodeSize, {
                  class: classes.join(" "),
                  "data-block-selected": String(blockState.selected.has(id)),
                }),
              );
            });

            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});

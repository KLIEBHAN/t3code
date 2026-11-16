import { Extension } from "@tiptap/core";
import { type EditorState, Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

/**
 * The part of `suggestion` still to type when `draft` is its start, or null.
 * An empty draft gets null: the composer then shows the whole suggestion as its placeholder.
 */
export function composerGhostRemainder(draft: string, suggestion: string | null): string | null {
  if (suggestion === null || draft.length === 0 || draft.length >= suggestion.length) return null;
  return suggestion.startsWith(draft) ? suggestion.slice(draft.length) : null;
}

/** The next word of `remainder` with the whitespace before it, which Alt+Right accepts. */
export function nextComposerGhostWord(remainder: string): string {
  return /^\s*\S+/.exec(remainder)?.[0] ?? remainder;
}

const ghostTextKey = new PluginKey<string | null>("composer-ghost-text");

function ghostDecorations(state: EditorState, suggestion: string | null): DecorationSet {
  const { doc, selection } = state;
  const end = TextSelection.atEnd(doc).to;
  if (!selection.empty || selection.head !== end) return DecorationSet.empty;
  // Read from the document, not the prompt prop: the prop lags a keystroke behind.
  const remainder = composerGhostRemainder(doc.textBetween(0, doc.content.size, "\n"), suggestion);
  if (remainder === null) return DecorationSet.empty;
  const widget = Decoration.widget(
    end,
    () => {
      const span = document.createElement("span");
      span.className = "pointer-events-none select-none whitespace-pre-wrap text-placeholder";
      span.dataset.composerGhostText = "true";
      span.setAttribute("aria-hidden", "true");
      span.textContent = remainder;
      return span;
    },
    { side: 1, key: `ghost:${remainder}`, ignoreSelection: true },
  );
  return DecorationSet.create(doc, [widget]);
}

/**
 * Shows the rest of the composer's prompt suggestion in grey after the caret
 * while the draft is the suggestion's start and the caret is at its end. Set
 * the suggestion with setComposerGhostSuggestion; the composer's key handler
 * accepts it.
 */
export const ComposerGhostTextExtension = Extension.create({
  name: "composerGhostText",
  addProseMirrorPlugins() {
    return [
      new Plugin<string | null>({
        key: ghostTextKey,
        state: {
          init: () => null,
          apply: (tr, value) => {
            const next: string | null | undefined = tr.getMeta(ghostTextKey);
            return next === undefined ? value : next;
          },
        },
        props: {
          decorations: (state) => ghostDecorations(state, ghostTextKey.getState(state) ?? null),
        },
      }),
    ];
  },
});

/** Puts `suggestion` into the editor's ghost text; null hides it. */
export function setComposerGhostSuggestion(view: EditorView, suggestion: string | null): void {
  if ((ghostTextKey.getState(view.state) ?? null) === suggestion) return;
  view.dispatch(view.state.tr.setMeta(ghostTextKey, suggestion).setMeta("addToHistory", false));
}

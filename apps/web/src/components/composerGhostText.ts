import { Extension } from "@tiptap/core";
import { type EditorState, Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

import { serializeEditorDoc } from "~/composer-rich-text-doc";

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

/** The suggestion to show and whether a requested one is still loading. */
interface GhostState {
  readonly suggestion: string | null;
  readonly loading: boolean;
}

const EMPTY_GHOST: GhostState = { suggestion: null, loading: false };
const ghostTextKey = new PluginKey<GhostState>("composer-ghost-text");

function ghostDecorations(state: EditorState, ghost: GhostState): DecorationSet {
  if (ghost.suggestion === null && !ghost.loading) return DecorationSet.empty;
  const { doc, selection } = state;
  const end = TextSelection.atEnd(doc).to;
  if (!selection.empty || selection.head !== end) return DecorationSet.empty;
  // The draft as the composer serializes it, Markdown included, so the ghost
  // matches what Tab accepts. Read from the document, not the prompt prop,
  // which lags a keystroke behind.
  const draft = serializeEditorDoc(doc).value;
  const remainder = composerGhostRemainder(draft, ghost.suggestion);
  // An empty composer shows loading in its placeholder instead.
  const loading = ghost.loading && draft.length > 0;
  if (remainder === null && !loading) return DecorationSet.empty;
  const widget = Decoration.widget(
    end,
    () => {
      const span = document.createElement("span");
      span.className = "pointer-events-none select-none whitespace-pre-wrap text-placeholder";
      span.dataset.composerGhostText = "true";
      span.setAttribute("aria-hidden", "true");
      span.textContent = remainder ?? "";
      if (loading) {
        // Pulses only while a request the user made is on its way, then disappears.
        const dots = document.createElement("span");
        dots.className = "ms-1";
        dots.dataset.composerGhostLoading = "true";
        dots.textContent = "…";
        span.append(dots);
      }
      return span;
    },
    { side: 1, key: `ghost:${loading ? "loading:" : ""}${remainder ?? ""}`, ignoreSelection: true },
  );
  return DecorationSet.create(doc, [widget]);
}

/**
 * Shows the rest of the composer's prompt suggestion in grey after the caret
 * while the draft is the suggestion's start and the caret is at its end, and
 * dots while a requested suggestion loads. Set both with
 * setComposerGhostSuggestion; the composer's key handler accepts the suggestion.
 */
export const ComposerGhostTextExtension = Extension.create({
  name: "composerGhostText",
  addProseMirrorPlugins() {
    return [
      new Plugin<GhostState>({
        key: ghostTextKey,
        state: {
          init: () => EMPTY_GHOST,
          apply: (tr, value) => {
            const next: GhostState | undefined = tr.getMeta(ghostTextKey);
            return next === undefined ? value : next;
          },
        },
        props: {
          decorations: (state) =>
            ghostDecorations(state, ghostTextKey.getState(state) ?? EMPTY_GHOST),
        },
      }),
    ];
  },
});

/** Puts `suggestion` into the editor's ghost text, null hides it; `loading` adds dots after the caret. */
export function setComposerGhostSuggestion(
  view: EditorView,
  suggestion: string | null,
  loading = false,
): void {
  const current = ghostTextKey.getState(view.state) ?? EMPTY_GHOST;
  if (current.suggestion === suggestion && current.loading === loading) return;
  view.dispatch(
    view.state.tr.setMeta(ghostTextKey, { suggestion, loading }).setMeta("addToHistory", false),
  );
}

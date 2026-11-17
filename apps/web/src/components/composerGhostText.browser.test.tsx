import type { Editor } from "@tiptap/core";
import { createElement, createRef, useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { act, fakeTimers, render } from "../../test/render";

import {
  ComposerPromptEditorTiptap as ComposerPromptEditor,
  type ComposerPromptEditorHandle,
} from "./ComposerPromptEditorTiptap";

vi.mock(import("../state/server"), async (original) => {
  const { Atom } = await import("effect/reactivity");
  const { compileResolvedKeybindingsConfig, DEFAULT_KEYBINDINGS } =
    await import("@t3tools/shared/keybindings");
  return {
    ...(await original()),
    primaryServerKeybindingsAtom: Atom.make(compileResolvedKeybindingsConfig(DEFAULT_KEYBINDINGS)),
  };
});

const suggestion = "Run the tests again";

function Composer({
  ghostSuggestion,
  ghostLoading = false,
}: {
  ghostSuggestion: string | null;
  ghostLoading?: boolean;
}) {
  const [prompt, setPrompt] = useState({ value: "", cursor: 0 });
  return (
    <ComposerPromptEditor
      editorRef={createRef<ComposerPromptEditorHandle>()}
      value={prompt.value}
      cursor={prompt.cursor}
      richTextEnabled
      contextRecords={new Map()}
      skills={[]}
      disabled={false}
      placeholder={ghostSuggestion ?? ""}
      ghostSuggestion={ghostSuggestion}
      ghostLoading={ghostLoading}
      onChange={(value, cursor) => setPrompt({ value, cursor })}
      onPaste={() => {}}
      onCommandKeyDown={() => false}
    />
  );
}

async function mount(ghostSuggestion: string | null, ghostLoading = false) {
  // Disposes the screen if setup below fails; on success the caller owns it.
  await using stack = new AsyncDisposableStack();
  const screen = stack.use(
    await render(createElement(Composer, { ghostSuggestion, ghostLoading })),
  );
  const element = screen.container.querySelector<HTMLElement & { editor: Editor }>(".tiptap");
  if (!element) throw new Error("Composer did not mount");
  const editor = element.editor;
  // ProseMirror rewrites the DOM caret 20ms after focus; run that before typing.
  {
    using _timers = fakeTimers();
    await act(async () => {
      editor.commands.focus("end");
    });
    await vi.waitFor(() => expect(document.activeElement).toBe(editor.view.dom));
    vi.runOnlyPendingTimers();
  }
  const ghost = () =>
    screen.container.querySelector<HTMLElement>("[data-composer-ghost-text]")?.textContent ?? null;
  const environment = stack.move();
  return Object.assign(screen, {
    [Symbol.asyncDispose]: () => environment.disposeAsync(),
    editor,
    ghost,
  });
}

describe("composer ghost text", () => {
  it("shows the rest of the suggestion while the draft is its start", async () => {
    await using screen = await mount(suggestion);
    const { ghost, editor } = screen;
    expect(ghost()).toBeNull();
    await userEvent.keyboard("Run th");
    await vi.waitFor(() => expect(ghost()).toBe("e tests again"));
    expect(editor.state.doc.textContent).toBe("Run th");
    await userEvent.keyboard("e");
    await vi.waitFor(() => expect(ghost()).toBe(" tests again"));
  });

  it("hides it when the draft leaves the suggestion and shows it again on the way back", async () => {
    await using screen = await mount(suggestion);
    const { ghost } = screen;
    await userEvent.keyboard("Run x");
    await vi.waitFor(() => expect(ghost()).toBeNull());
    await userEvent.keyboard("{Backspace}");
    await vi.waitFor(() => expect(ghost()).toBe("the tests again"));
  });

  it("hides it while the caret is not at the end", async () => {
    await using screen = await mount(suggestion);
    const { ghost, editor } = screen;
    await userEvent.keyboard("Run");
    await vi.waitFor(() => expect(ghost()).toBe(" the tests again"));
    await act(async () => {
      editor.commands.setTextSelection(2);
    });
    await vi.waitFor(() => expect(ghost()).toBeNull());
  });

  it("compares the draft with its Markdown, as Tab accepts it", async () => {
    await using screen = await mount("Run **all** tests again");
    const { ghost, editor } = screen;
    await userEvent.keyboard("Run **all** ");
    await vi.waitFor(() => expect(ghost()).toBe("tests again"));
    // The asterisks became bold, so the plain text lacks them.
    expect(editor.state.doc.textContent).toBe("Run all ");
  });

  it("shows still dots while a requested suggestion loads, after the typed draft only", async () => {
    await using screen = await mount(null, true);
    const loading = () => screen.container.querySelector("[data-composer-ghost-loading]");
    await act(async () => {});
    expect(loading()).toBeNull();
    await userEvent.keyboard("Run");
    await vi.waitFor(() => expect(loading()?.textContent).toBe("…"));
    // Still, not animated: an endless animation keeps repainting the page.
    expect(loading()?.getAnimations()).toEqual([]);
  });

  it("shows nothing without a suggestion", async () => {
    await using screen = await mount(null);
    const { ghost } = screen;
    await userEvent.keyboard("Run");
    await act(async () => {});
    expect(ghost()).toBeNull();
  });
});

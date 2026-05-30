import { RunId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ComposerAssistThreadSource } from "../composerAssistThreadSource.ts";
import { buildReplySuggestionContext } from "./replySuggestionContext.ts";

const threadId = ThreadId.make("thread-1");

function makeSource(
  overrides: Partial<ComposerAssistThreadSource> &
    Pick<ComposerAssistThreadSource, "messages">,
): ComposerAssistThreadSource {
  return {
    thread: { title: "Layout cleanup", interactionMode: "default", worktreePath: null },
    project: { title: "T3 Code", workspaceRoot: "/repo" },
    checkpoints: [],
    ...overrides,
  };
}

describe("buildReplySuggestionContext", () => {
  it("prefers the thread worktree path and concatenates assistant messages for the run", () => {
    const runId = RunId.make("run-1");
    const source = makeSource({
      thread: {
        title: "Layout cleanup",
        interactionMode: "default",
        worktreePath: "/repo-worktree",
      },
      messages: [
        { role: "user", runId, text: "Please tighten this layout." },
        { role: "assistant", runId, text: "I reduced the spacing." },
        { role: "assistant", runId, text: "I also aligned the actions." },
      ],
      checkpoints: [
        {
          runId,
          status: "ready",
          files: [
            {
              path: "apps/web/src/components/chat/ReplySuggestionsBar.tsx",
              kind: "modified",
              additions: 8,
              deletions: 2,
            },
          ],
        },
      ],
    });

    expect(buildReplySuggestionContext(source, { threadId, runId })).toEqual({
      cwd: "/repo-worktree",
      interactionMode: "default",
      projectTitle: "T3 Code",
      threadTitle: "Layout cleanup",
      userMessage: "Please tighten this layout.",
      assistantMessage: "I reduced the spacing.\n\nI also aligned the actions.",
      changedFiles: [
        {
          path: "apps/web/src/components/chat/ReplySuggestionsBar.tsx",
          kind: "modified",
          additions: 8,
          deletions: 2,
        },
      ],
    });
  });

  it("uses the nearest preceding user message when the run has none of its own", () => {
    const olderRunId = RunId.make("run-older");
    const runId = RunId.make("run-current");
    const source = makeSource({
      messages: [
        { role: "user", runId: null, text: "Old question" },
        { role: "assistant", runId: olderRunId, text: "Old answer" },
        { role: "user", runId: null, text: "Current follow-up" },
        { role: "assistant", runId, text: "Current answer" },
      ],
    });

    expect(buildReplySuggestionContext(source, { threadId, runId })).toEqual({
      cwd: "/repo",
      interactionMode: "default",
      projectTitle: "T3 Code",
      threadTitle: "Layout cleanup",
      userMessage: "Current follow-up",
      assistantMessage: "Current answer",
      changedFiles: [],
    });
  });

  it("returns null when no completed assistant message exists for the run", () => {
    const runId = RunId.make("run-1");
    const source = makeSource({
      messages: [{ role: "user", runId, text: "Please tighten this layout." }],
    });

    expect(buildReplySuggestionContext(source, { threadId, runId })).toBeNull();
  });
});

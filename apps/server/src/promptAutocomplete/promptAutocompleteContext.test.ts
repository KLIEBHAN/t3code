import { RunId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildPromptAutocompleteContext } from "./promptAutocompleteContext.ts";

describe("buildPromptAutocompleteContext", () => {
  it("builds draft and recent-message context from the active thread", () => {
    const runId = RunId.make("run-1");
    const changedFile = {
      path: "apps/web/src/components/chat/ChatComposer.tsx",
      kind: "modified",
      additions: 12,
      deletions: 3,
    };

    expect(
      buildPromptAutocompleteContext(
        {
          thread: {
            title: "Autocomplete",
            interactionMode: "default",
            worktreePath: "/repo-worktree",
          },
          project: { title: "T3 Code", workspaceRoot: "/repo" },
          messages: [
            { role: "user", runId, text: "Improve this." },
            { role: "assistant", runId, text: "I tightened the implementation." },
          ],
          checkpoints: [
            { runId, status: "ready", files: [changedFile] },
            { runId, status: "missing", files: [] },
          ],
        },
        { threadId: ThreadId.make("thread-1"), draft: "Bitte fuehre lint aus", cursor: 11 },
      ),
    ).toEqual({
      cwd: "/repo-worktree",
      interactionMode: "default",
      projectTitle: "T3 Code",
      threadTitle: "Autocomplete",
      draftBeforeCursor: "Bitte fuehr",
      draftAfterCursor: "e lint aus",
      latestUserMessage: "Improve this.",
      latestAssistantMessage: "I tightened the implementation.",
      recentMessages: [
        { role: "user", text: "Improve this." },
        { role: "assistant", text: "I tightened the implementation." },
      ],
      changedFiles: [changedFile],
    });
  });
});

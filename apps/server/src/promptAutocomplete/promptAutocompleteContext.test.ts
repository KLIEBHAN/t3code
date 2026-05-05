import { describe, expect, it } from "vitest";

import { buildPromptAutocompleteContext } from "./promptAutocompleteContext.ts";

describe("buildPromptAutocompleteContext", () => {
  it("builds draft and recent-message context from the active thread", () => {
    const readModel = {
      snapshotSequence: 1,
      updatedAt: "2026-03-17T00:00:00.000Z",
      projects: [
        {
          id: "project-1",
          title: "T3 Code",
          workspaceRoot: "/repo",
        },
      ],
      threads: [
        {
          id: "thread-1",
          projectId: "project-1",
          title: "Autocomplete",
          interactionMode: "default",
          worktreePath: "/repo-worktree",
          messages: [
            {
              id: "user-1",
              role: "user",
              turnId: null,
              text: "Improve this.",
              createdAt: "2026-03-17T00:00:01.000Z",
            },
            {
              id: "assistant-1",
              role: "assistant",
              turnId: "turn-1",
              text: "I tightened the implementation.",
              createdAt: "2026-03-17T00:00:02.000Z",
            },
          ],
          checkpoints: [
            {
              turnId: "turn-1",
              checkpointTurnCount: 1,
              checkpointRef: "refs/t3/checkpoints/thread-1/turn/1",
              status: "ready",
              completedAt: "2026-03-17T00:00:03.000Z",
              assistantMessageId: "assistant-1",
              files: [
                {
                  path: "apps/web/src/components/chat/ChatComposer.tsx",
                  kind: "modified",
                  additions: 12,
                  deletions: 3,
                },
              ],
            },
          ],
        },
      ],
    } as any;

    expect(
      buildPromptAutocompleteContext(readModel, {
        threadId: "thread-1",
        draft: "Bitte fuehre lint aus",
        cursor: 11,
      } as any),
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
        {
          role: "user",
          text: "Improve this.",
        },
        {
          role: "assistant",
          text: "I tightened the implementation.",
        },
      ],
      changedFiles: [
        {
          path: "apps/web/src/components/chat/ChatComposer.tsx",
          kind: "modified",
          additions: 12,
          deletions: 3,
        },
      ],
    });
  });
});

import { describe, expect, it } from "vitest";

import { buildReplySuggestionContext } from "./replySuggestionContext.ts";

describe("buildReplySuggestionContext", () => {
  it("prefers the thread worktree path and concatenates assistant messages for the turn", () => {
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
          title: "Layout cleanup",
          interactionMode: "default",
          worktreePath: "/repo-worktree",
          messages: [
            {
              id: "user-1",
              role: "user",
              turnId: null,
              text: "Please tighten this layout.",
              createdAt: "2026-03-17T00:00:01.000Z",
            },
            {
              id: "assistant-1",
              role: "assistant",
              turnId: "turn-1",
              text: "I reduced the spacing.",
              createdAt: "2026-03-17T00:00:02.000Z",
            },
            {
              id: "assistant-2",
              role: "assistant",
              turnId: "turn-1",
              text: "I also aligned the actions.",
              createdAt: "2026-03-17T00:00:03.000Z",
            },
          ],
          checkpoints: [
            {
              turnId: "turn-1",
              checkpointTurnCount: 1,
              checkpointRef: "refs/t3/checkpoints/thread-1/turn/1",
              status: "ready",
              completedAt: "2026-03-17T00:00:03.000Z",
              assistantMessageId: "assistant-2",
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
        },
      ],
    } as any;

    expect(
      buildReplySuggestionContext(readModel, {
        threadId: "thread-1",
        turnId: "turn-1",
      } as any),
    ).toEqual({
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

  it("uses the nearest preceding user message when the user turn id is null", () => {
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
          title: "Current thread",
          interactionMode: "default",
          worktreePath: "/repo",
          messages: [
            {
              id: "user-older",
              role: "user",
              turnId: null,
              text: "Old question",
              createdAt: "2026-03-17T00:00:01.000Z",
            },
            {
              id: "assistant-older",
              role: "assistant",
              turnId: "turn-older",
              text: "Old answer",
              createdAt: "2026-03-17T00:00:02.000Z",
            },
            {
              id: "user-current",
              role: "user",
              turnId: null,
              text: "Current follow-up",
              createdAt: "2026-03-17T00:00:03.000Z",
            },
            {
              id: "assistant-current",
              role: "assistant",
              turnId: "turn-current",
              text: "Current answer",
              createdAt: "2026-03-17T00:00:04.000Z",
            },
          ],
          checkpoints: [],
        },
      ],
    } as any;

    expect(
      buildReplySuggestionContext(readModel, {
        threadId: "thread-1",
        turnId: "turn-current",
      } as any),
    ).toEqual({
      cwd: "/repo",
      interactionMode: "default",
      projectTitle: "T3 Code",
      threadTitle: "Current thread",
      userMessage: "Current follow-up",
      assistantMessage: "Current answer",
      changedFiles: [],
    });
  });

  it("returns null when no completed assistant message exists for the turn", () => {
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
          title: "Layout cleanup",
          interactionMode: "default",
          worktreePath: null,
          messages: [
            {
              id: "user-1",
              role: "user",
              turnId: "turn-1",
              text: "Please tighten this layout.",
              createdAt: "2026-03-17T00:00:01.000Z",
            },
          ],
          checkpoints: [],
        },
      ],
    } as any;

    expect(
      buildReplySuggestionContext(readModel, {
        threadId: "thread-1",
        turnId: "turn-1",
      } as any),
    ).toBeNull();
  });
});

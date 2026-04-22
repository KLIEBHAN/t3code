import { describe, expect, it } from "vitest";

import {
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationReadModel,
} from "@t3tools/contracts";

import { buildPromptImprovementContext } from "./promptImprovementContext.ts";

const readModel: OrchestrationReadModel = {
  snapshotSequence: 1,
  updatedAt: "2026-03-17T10:01:00.000Z",
  projects: [
    {
      id: ProjectId.make("project-1"),
      title: "Workspace",
      workspaceRoot: "/repo/project",
      defaultModelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5",
      },
      scripts: [],
      createdAt: "2026-03-17T10:00:00.000Z",
      updatedAt: "2026-03-17T10:00:00.000Z",
      deletedAt: null,
    },
  ],
  threads: [
    {
      id: ThreadId.make("thread-1"),
      projectId: ProjectId.make("project-1"),
      title: "Prompt help",
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5",
      },
      interactionMode: "default",
      runtimeMode: "full-access",
      branch: "main",
      worktreePath: null,
      latestTurn: null,
      session: null,
      messages: [
        {
          id: MessageId.make("m1"),
          role: "user",
          text: "Please review the current changes.",
          turnId: null,
          streaming: false,
          createdAt: "2026-03-17T10:00:00.000Z",
          updatedAt: "2026-03-17T10:00:00.000Z",
        },
        {
          id: MessageId.make("m2"),
          role: "assistant",
          text: "I found two issues in ChatView.tsx.",
          turnId: TurnId.make("turn-1"),
          streaming: false,
          createdAt: "2026-03-17T10:01:00.000Z",
          updatedAt: "2026-03-17T10:01:00.000Z",
        },
      ],
      checkpoints: [],
      activities: [],
      proposedPlans: [],
      createdAt: "2026-03-17T10:00:00.000Z",
      updatedAt: "2026-03-17T10:01:00.000Z",
      archivedAt: null,
      deletedAt: null,
    },
  ],
};

describe("buildPromptImprovementContext", () => {
  it("returns minimal thread context for a prompt improvement request", () => {
    expect(
      buildPromptImprovementContext(readModel, {
        threadId: ThreadId.make("thread-1"),
      }),
    ).toEqual({
      cwd: "/repo/project",
      interactionMode: "default",
      projectTitle: "Workspace",
      threadTitle: "Prompt help",
      latestUserMessage: "Please review the current changes.",
      latestAssistantMessage: "I found two issues in ChatView.tsx.",
    });
  });

  it("returns null when no thread exists", () => {
    expect(
      buildPromptImprovementContext(readModel, {
        threadId: ThreadId.make("missing-thread"),
      }),
    ).toBeNull();
  });
});

import { RunId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildPromptImprovementContext } from "./promptImprovementContext.ts";

const runId = RunId.make("run-1");

describe("buildPromptImprovementContext", () => {
  it("returns minimal thread context for a prompt improvement request", () => {
    expect(
      buildPromptImprovementContext({
        thread: { title: "Prompt help", interactionMode: "default", worktreePath: null },
        project: { title: "Workspace", workspaceRoot: "/repo/project" },
        messages: [
          { role: "user", runId, text: "Please review the current changes." },
          { role: "assistant", runId, text: "I found two issues in ChatView.tsx." },
          { role: "assistant", runId, text: "   " },
        ],
        checkpoints: [],
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

  it("returns null when the thread has no working directory", () => {
    expect(
      buildPromptImprovementContext({
        thread: { title: "Prompt help", interactionMode: "default", worktreePath: null },
        project: null,
        messages: [],
        checkpoints: [],
      }),
    ).toBeNull();
  });
});

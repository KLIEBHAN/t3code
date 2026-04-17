import { describe, expect, it } from "vitest";

import {
  buildNoopPromptImprovementResult,
  buildPromptImprovementPrompt,
  sanitizePromptImprovement,
} from "./promptImprovementLogic.ts";

const context = {
  cwd: "/repo/project",
  interactionMode: "default" as const,
  projectTitle: "Workspace",
  threadTitle: "Prompt help",
  latestUserMessage: "Please review the current changes.",
  latestAssistantMessage: "I found two issues in ChatView.tsx.",
};

describe("sanitizePromptImprovement", () => {
  it("trims and unwraps quotes from the improved prompt", () => {
    expect(
      sanitizePromptImprovement({
        originalPrompt: "check this",
        improvedPrompt: '  "Please review this change set and list concrete issues."  ',
      }),
    ).toEqual({
      improvedPrompt: "Please review this change set and list concrete issues.",
      changed: true,
      reason: null,
    });
  });

  it("returns a no-op result when the improved output is empty", () => {
    expect(
      sanitizePromptImprovement({
        originalPrompt: "Please review this diff.",
        improvedPrompt: "   ",
      }),
    ).toEqual({
      improvedPrompt: "Please review this diff.",
      changed: false,
      reason: "Prompt already looks good.",
    });
  });

  it("builds an explicit no-op result with a reason", () => {
    expect(
      buildNoopPromptImprovementResult({
        originalPrompt: "Please review this diff.",
        reason: "Prompt improvement failed, so the original draft was kept.",
      }),
    ).toEqual({
      improvedPrompt: "Please review this diff.",
      changed: false,
      reason: "Prompt improvement failed, so the original draft was kept.",
    });
  });
});

describe("buildPromptImprovementPrompt", () => {
  it("includes the draft and recent thread context", () => {
    const prompt = buildPromptImprovementPrompt({
      context,
      prompt: "check this and make it better",
    });

    expect(prompt).toContain("Current draft to improve:");
    expect(prompt).toContain("check this and make it better");
    expect(prompt).toContain("Most recent assistant message in thread:");
    expect(prompt).toContain("I found two issues in ChatView.tsx.");
    expect(prompt).toContain("Do not change slash-commands, @mentions, code blocks");
  });
});

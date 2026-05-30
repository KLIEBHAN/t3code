import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { shouldResetPromptImprovementPreview } from "./usePromptImprovement";

describe("shouldResetPromptImprovementPreview", () => {
  it("keeps the preview while the same thread and prompt are active", () => {
    expect(
      shouldResetPromptImprovementPreview({
        currentPrompt: "Refine this prompt",
        preview: {
          threadId: ThreadId.make("thread-1"),
          originalPrompt: "Refine this prompt",
          improvedPrompt: "Make this prompt sharper",
        },
        request: {
          threadId: ThreadId.make("thread-1"),
          prompt: "Refine this prompt",
        },
      }),
    ).toBe(false);
  });

  it("resets the preview when the active thread changes", () => {
    expect(
      shouldResetPromptImprovementPreview({
        currentPrompt: "Refine this prompt",
        preview: {
          threadId: ThreadId.make("thread-1"),
          originalPrompt: "Refine this prompt",
          improvedPrompt: "Make this prompt sharper",
        },
        request: {
          threadId: ThreadId.make("thread-2"),
          prompt: "Refine this prompt",
        },
      }),
    ).toBe(true);
  });

  it("resets the preview when the draft text changes or the request disappears", () => {
    expect(
      shouldResetPromptImprovementPreview({
        currentPrompt: "Different prompt",
        preview: {
          threadId: ThreadId.make("thread-1"),
          originalPrompt: "Refine this prompt",
          improvedPrompt: "Make this prompt sharper",
        },
        request: {
          threadId: ThreadId.make("thread-1"),
          prompt: "Refine this prompt",
        },
      }),
    ).toBe(true);

    expect(
      shouldResetPromptImprovementPreview({
        currentPrompt: "Refine this prompt",
        preview: {
          threadId: ThreadId.make("thread-1"),
          originalPrompt: "Refine this prompt",
          improvedPrompt: "Make this prompt sharper",
        },
        request: null,
      }),
    ).toBe(true);
  });
});

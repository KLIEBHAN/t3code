import { describe, expect, it } from "vitest";

import {
  buildReplySuggestionPrompt,
  sanitizeReplySuggestions,
} from "./replySuggestionGenerationLogic.ts";
import type { ReplySuggestionContext } from "./replySuggestionContext.ts";

function makeContext(overrides?: Partial<ReplySuggestionContext>): ReplySuggestionContext {
  return {
    cwd: "/repo",
    interactionMode: "default",
    projectTitle: "T3 Code",
    threadTitle: "Reply suggestion quality",
    userMessage: "Bitte pruefe die Aenderungen noch einmal.",
    assistantMessage: "Ich habe die Aenderungen eingepflegt und lint/typecheck ausgefuehrt.",
    changedFiles: [
      {
        path: "apps/web/src/components/chat/ReplySuggestionsBar.tsx",
        kind: "modified",
        additions: 8,
        deletions: 2,
      },
    ],
    ...overrides,
  };
}

describe("buildReplySuggestionPrompt", () => {
  it("grounds the prompt in the current language and changed files", () => {
    const prompt = buildReplySuggestionPrompt({
      context: makeContext(),
      templateId: "default",
      templateInstructions: "Prefer concise testing requests.",
    });

    expect(prompt).toContain("Use the same language as the last user message.");
    expect(prompt).toContain("Project title: T3 Code");
    expect(prompt).toContain("Thread title: Reply suggestion quality");
    expect(prompt).toContain("apps/web/src/components/chat/ReplySuggestionsBar.tsx");
    expect(prompt).toContain("Changed files:");
    expect(prompt).toContain("Additional template instructions:");
    expect(prompt).toContain("Prefer concise testing requests.");
  });

  it("makes it explicit when no code changes were detected", () => {
    const prompt = buildReplySuggestionPrompt({
      context: makeContext({
        changedFiles: [],
      }),
      templateId: "default",
      templateInstructions: "Prefer concise testing requests.",
    });

    expect(prompt).toContain("Changed files: none detected for this turn.");
    expect(prompt).toContain(
      "If no changed files are listed, do not imply that code was modified.",
    );
  });
});

describe("sanitizeReplySuggestions", () => {
  it("drops generic acknowledgements, duplicates, and copies of the user prompt", () => {
    expect(
      sanitizeReplySuggestions({
        context: makeContext(),
        suggestions: [
          { text: "Thanks!" },
          { text: "Bitte pruefe die Aenderungen noch einmal." },
          { text: "Kannst du dafuer noch einen Browser-Test ergaenzen?" },
          { text: "Kannst du dafuer noch einen Browser-Test ergaenzen?" },
          { text: "Ergaenze bitte noch einen kurzen Test fuer den Hover-Zustand." },
        ],
      }),
    ).toEqual([
      { text: "Kannst du dafuer noch einen Browser-Test ergaenzen?" },
      { text: "Ergaenze bitte noch einen kurzen Test fuer den Hover-Zustand." },
    ]);
  });
});

import { describe, expect, it } from "vitest";

import {
  buildPromptAutocompletePrompt,
  sanitizePromptAutocompleteSuggestions,
} from "./promptAutocompleteGenerationLogic.ts";
import type { PromptAutocompleteContext } from "./promptAutocompleteContext.ts";

function makeContext(overrides?: Partial<PromptAutocompleteContext>): PromptAutocompleteContext {
  return {
    cwd: "/repo",
    interactionMode: "default",
    projectTitle: "T3 Code",
    threadTitle: "Prompt autocomplete",
    draftBeforeCursor: "Kannst du die Tests",
    draftAfterCursor: "",
    latestUserMessage: "Bitte verbessere die Prompt Vorschlaege.",
    latestAssistantMessage: "Ich habe die Autocomplete-Logik vorbereitet.",
    recentMessages: [
      {
        role: "user",
        text: "Bitte verbessere die Prompt Vorschlaege.",
      },
      {
        role: "assistant",
        text: "Ich habe die Autocomplete-Logik vorbereitet.",
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
    ...overrides,
  };
}

describe("buildPromptAutocompletePrompt", () => {
  it("uses the prompt-autocomplete response shape and coding-agent context", () => {
    const prompt = buildPromptAutocompletePrompt(makeContext());

    expect(prompt).toContain("You generate inline prompt suggestions");
    expect(prompt).toContain('"completions"');
    expect(prompt).toContain("Current draft before cursor:");
    expect(prompt).toContain("Kannst du die Tests");
    expect(prompt).toContain("Latest assistant message:");
    expect(prompt).toContain("Ich habe die Autocomplete-Logik vorbereitet.");
    expect(prompt).toContain("apps/web/src/components/chat/ChatComposer.tsx");
  });
});

describe("sanitizePromptAutocompleteSuggestions", () => {
  it("keeps exact continuations and removes repeated draft prefixes", () => {
    expect(
      sanitizePromptAutocompleteSuggestions({
        draftBeforeCursor: "Kannst du die Tests",
        suggestions: ["Kannst du die Tests noch gezielt erweitern?", " noch gezielt erweitern?"],
      }),
    ).toEqual([{ text: " noch gezielt erweitern?" }]);
  });

  it("does not insert a space while completing a partially typed word", () => {
    expect(
      sanitizePromptAutocompleteSuggestions({
        draftBeforeCursor: "Schrei",
        suggestions: ["Schreibe einen Regressionstest"],
      }),
    ).toEqual([{ text: "be einen Regressionstest" }]);
  });

  it("drops empty, generic, and duplicate suggestions", () => {
    expect(
      sanitizePromptAutocompleteSuggestions({
        draftBeforeCursor: "",
        suggestions: ["Thanks!", " Fuehre lint aus.", "Fuehre lint aus.", ""],
      }),
    ).toEqual([{ text: "Fuehre lint aus." }]);
  });

  it("collapses multiline suggestions to keep inline previews stable", () => {
    expect(
      sanitizePromptAutocompleteSuggestions({
        draftBeforeCursor: "Bitte",
        suggestions: [" pruefe\n  die UI"],
      }),
    ).toEqual([{ text: " pruefe die UI" }]);
  });
});

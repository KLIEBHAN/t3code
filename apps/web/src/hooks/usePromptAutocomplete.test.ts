import { describe, expect, it } from "vitest";

import {
  getNextPromptAutocompleteIndex,
  resolvePromptAutocompleteSelectedIndex,
} from "./usePromptAutocomplete";

describe("prompt autocomplete selection helpers", () => {
  it("wraps suggestion cycling in both directions", () => {
    expect(
      getNextPromptAutocompleteIndex({
        currentIndex: 0,
        direction: -1,
        suggestionCount: 3,
      }),
    ).toBe(2);
    expect(
      getNextPromptAutocompleteIndex({
        currentIndex: 2,
        direction: 1,
        suggestionCount: 3,
      }),
    ).toBe(0);
  });

  it("preserves the active suggestion when refreshed alternatives still contain it", () => {
    expect(
      resolvePromptAutocompleteSelectedIndex({
        currentSuggestion: { text: "second" },
        nextSuggestions: [{ text: "first" }, { text: "second" }],
      }),
    ).toBe(1);
  });

  it("resets to the first suggestion when the active suggestion disappears", () => {
    expect(
      resolvePromptAutocompleteSelectedIndex({
        currentSuggestion: { text: "missing" },
        nextSuggestions: [{ text: "first" }, { text: "second" }],
      }),
    ).toBe(0);
  });
});

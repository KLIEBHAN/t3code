import { describe, expect, it } from "vitest";

import {
  DEFAULT_REPLY_SUGGESTION_PROMPT_TEMPLATE_ID,
  normalizeReplySuggestionPromptTemplates,
  resolveReplySuggestionPromptTemplate,
} from "./replySuggestions.ts";

describe("normalizeReplySuggestionPromptTemplates", () => {
  it("drops invalid templates and falls back to the default template", () => {
    const templates = normalizeReplySuggestionPromptTemplates([
      null,
      {
        id: "",
        label: "Missing id",
        instructions: "Do something",
      },
    ]);

    expect(templates).toHaveLength(1);
    expect(templates[0]?.id).toBe(DEFAULT_REPLY_SUGGESTION_PROMPT_TEMPLATE_ID);
  });

  it("keeps valid templates and removes duplicate ids", () => {
    expect(
      normalizeReplySuggestionPromptTemplates([
        {
          id: "default",
          label: "Balanced",
          instructions: "Rule one",
        },
        {
          id: "strict",
          label: "Strict",
          instructions: "Rule two",
        },
        {
          id: "strict",
          label: "Duplicate",
          instructions: "Rule three",
        },
      ]),
    ).toEqual([
      {
        id: "default",
        label: "Balanced",
        instructions: "Rule one",
      },
      {
        id: "strict",
        label: "Strict",
        instructions: "Rule two",
      },
    ]);
  });

  it("re-adds the hard-coded default when only custom templates remain", () => {
    expect(
      normalizeReplySuggestionPromptTemplates([
        {
          id: "strict",
          label: "Strict",
          instructions: "Rule two",
        },
      ]).map((template) => template.id),
    ).toEqual([DEFAULT_REPLY_SUGGESTION_PROMPT_TEMPLATE_ID, "strict"]);
  });
});

describe("resolveReplySuggestionPromptTemplate", () => {
  it("returns the selected template when it exists", () => {
    expect(
      resolveReplySuggestionPromptTemplate(
        [
          {
            id: "default",
            label: "Balanced",
            instructions: "Rule one",
          },
          {
            id: "strict",
            label: "Strict",
            instructions: "Rule two",
          },
        ],
        "strict",
      ),
    ).toEqual({
      id: "strict",
      label: "Strict",
      instructions: "Rule two",
    });
  });
});

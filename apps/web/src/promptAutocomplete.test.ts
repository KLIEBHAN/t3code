import { MAX_PROMPT_AUTOCOMPLETE_DRAFT_LENGTH } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { derivePromptAutocompleteRequest } from "./promptAutocomplete";

const activeThread = {
  id: "thread-1",
  messages: [
    {
      role: "assistant",
      text: "I tightened the implementation.",
    },
  ],
} as any;

const baseInput = {
  activeThread,
  isServerThread: true,
  prompt: "Kannst du die Tests",
  cursor: "Kannst du die Tests".length,
  isFocused: true,
  isBusy: false,
  hasPendingApproval: false,
  hasPendingUserInput: false,
  showPlanFollowUpPrompt: false,
  composerImageCount: 0,
  composerTerminalContextCount: 0,
  composerTrigger: null,
};

describe("derivePromptAutocompleteRequest", () => {
  it("creates a request for a focused server-thread draft at the cursor end", () => {
    expect(derivePromptAutocompleteRequest(baseInput)).toEqual({
      threadId: "thread-1",
      draft: "Kannst du die Tests",
      cursor: "Kannst du die Tests".length,
    });
  });

  it("suppresses autocomplete while another composer affordance owns the draft", () => {
    expect(
      derivePromptAutocompleteRequest({
        ...baseInput,
        composerTrigger: {
          kind: "path",
          query: "app",
          rangeStart: 0,
          rangeEnd: 4,
        },
      }),
    ).toBeNull();
  });

  it("suppresses unsupported slash commands, mentions, and non-tail cursors", () => {
    expect(
      derivePromptAutocompleteRequest({ ...baseInput, prompt: "/model", cursor: 6 }),
    ).toBeNull();
    expect(
      derivePromptAutocompleteRequest({
        ...baseInput,
        prompt: "Bitte @apps/web",
        cursor: "Bitte @apps/web".length,
      }),
    ).toBeNull();
    expect(derivePromptAutocompleteRequest({ ...baseInput, cursor: 4 })).toBeNull();
  });

  it("suppresses drafts that exceed the prompt-autocomplete contract", () => {
    const prompt = "x".repeat(MAX_PROMPT_AUTOCOMPLETE_DRAFT_LENGTH + 1);

    expect(
      derivePromptAutocompleteRequest({
        ...baseInput,
        prompt,
        cursor: prompt.length,
      }),
    ).toBeNull();
  });

  it("allows empty drafts only when assistant context exists", () => {
    expect(derivePromptAutocompleteRequest({ ...baseInput, prompt: "", cursor: 0 })).toEqual({
      threadId: "thread-1",
      draft: "",
      cursor: 0,
    });

    expect(
      derivePromptAutocompleteRequest({
        ...baseInput,
        activeThread: {
          id: "thread-without-assistant",
          messages: [],
        } as any,
        prompt: "",
        cursor: 0,
      }),
    ).toBeNull();
  });

  it("does not suppress inactive at-sign text", () => {
    expect(
      derivePromptAutocompleteRequest({
        ...baseInput,
        prompt: "Antworte an test@example.com mit",
        cursor: "Antworte an test@example.com mit".length,
      }),
    ).toEqual({
      threadId: "thread-1",
      draft: "Antworte an test@example.com mit",
      cursor: "Antworte an test@example.com mit".length,
    });
  });
});

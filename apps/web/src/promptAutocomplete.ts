import {
  MAX_PROMPT_AUTOCOMPLETE_DRAFT_LENGTH,
  type PromptAutocompleteInput,
} from "@t3tools/contracts";

import { INLINE_TERMINAL_CONTEXT_PLACEHOLDER } from "./lib/terminalContext";
import type { ComposerTrigger } from "./composer-logic";
import type { Thread } from "./types";

function hasUnsupportedPromptAutocompleteSyntax(prompt: string, cursor: number): boolean {
  const draftBeforeCursor = prompt.slice(0, cursor);
  const trimmedStart = draftBeforeCursor.trimStart();
  if (trimmedStart.startsWith("/") || trimmedStart.startsWith("!")) return true;
  if (prompt.includes(INLINE_TERMINAL_CONTEXT_PLACEHOLDER)) return true;

  const lastLine = draftBeforeCursor.split("\n").pop() ?? "";
  if (/(?:^|[ \t])@(?:"[^"]*|[^\s]*)$/.test(lastLine)) return true;
  if (/(?:^|[ \t])(?:~\/|\.\.?\/|\/)[^\s]*$/.test(lastLine)) return true;

  return false;
}

export function derivePromptAutocompleteRequest(input: {
  activeThread: Thread | undefined;
  isServerThread: boolean;
  prompt: string;
  cursor: number;
  isFocused: boolean;
  isBusy: boolean;
  hasPendingApproval: boolean;
  hasPendingUserInput: boolean;
  showPlanFollowUpPrompt: boolean;
  composerImageCount: number;
  composerTerminalContextCount: number;
  composerTrigger: ComposerTrigger | null;
}): PromptAutocompleteInput | null {
  if (!input.activeThread || !input.isServerThread || !input.isFocused) {
    return null;
  }
  if (input.isBusy || input.hasPendingApproval || input.hasPendingUserInput) {
    return null;
  }
  if (input.showPlanFollowUpPrompt || input.composerImageCount > 0) {
    return null;
  }
  if (input.composerTerminalContextCount > 0 || input.composerTrigger !== null) {
    return null;
  }

  const cursor = Math.max(0, Math.min(input.prompt.length, Math.floor(input.cursor)));
  if (cursor !== input.prompt.length) {
    return null;
  }
  if (input.prompt.length > MAX_PROMPT_AUTOCOMPLETE_DRAFT_LENGTH) {
    return null;
  }
  if (
    input.prompt.trim().length === 0 &&
    !input.activeThread.messages.some(
      (message) => message.role === "assistant" && message.text.trim().length > 0,
    )
  ) {
    return null;
  }
  if (hasUnsupportedPromptAutocompleteSyntax(input.prompt, cursor)) {
    return null;
  }

  return {
    threadId: input.activeThread.id,
    draft: input.prompt,
    cursor,
  };
}

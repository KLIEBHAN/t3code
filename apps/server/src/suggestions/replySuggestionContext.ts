import type { ProviderInteractionMode, ReplySuggestionsInput } from "@t3tools/contracts";

import {
  composerAssistThreadCwd,
  type ComposerAssistThreadSource,
} from "../composerAssistThreadSource.ts";

export interface ReplySuggestionContext {
  readonly cwd: string;
  readonly interactionMode: ProviderInteractionMode;
  readonly projectTitle: string | null;
  readonly threadTitle: string | null;
  readonly userMessage: string;
  readonly assistantMessage: string;
  readonly changedFiles: ReadonlyArray<{
    path: string;
    kind: string;
    additions: number;
    deletions: number;
  }>;
}

export function buildReplySuggestionContext(
  source: ComposerAssistThreadSource,
  input: ReplySuggestionsInput,
): ReplySuggestionContext | null {
  const cwd = composerAssistThreadCwd(source);
  if (!cwd) {
    return null;
  }

  const firstRunMessageIndex = source.messages.findIndex(
    (message) => message.runId === input.runId,
  );
  if (firstRunMessageIndex === -1) {
    return null;
  }

  // The prompt of a run, or the latest user message before it when the run
  // was started without one of its own.
  const userMessage = source.messages.findLast(
    (message, index) =>
      message.role === "user" &&
      message.text.trim().length > 0 &&
      (message.runId === input.runId || index <= firstRunMessageIndex),
  );
  if (!userMessage) {
    return null;
  }

  const assistantMessageText = source.messages
    .filter((message) => message.runId === input.runId && message.role === "assistant")
    .map((message) => message.text.trim())
    .filter((message) => message.length > 0)
    .join("\n\n")
    .trim();
  if (assistantMessageText.length === 0) {
    return null;
  }

  const checkpoint = source.checkpoints.findLast((entry) => entry.runId === input.runId);

  return {
    cwd,
    interactionMode: source.thread.interactionMode,
    projectTitle: source.project?.title ?? null,
    threadTitle: source.thread.title,
    userMessage: userMessage.text.trim(),
    assistantMessage: assistantMessageText,
    changedFiles:
      checkpoint?.files.map((file) => ({
        path: file.path,
        kind: file.kind,
        additions: file.additions,
        deletions: file.deletions,
      })) ?? [],
  };
}

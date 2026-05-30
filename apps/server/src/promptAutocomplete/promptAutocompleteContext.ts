import type { PromptAutocompleteInput, ProviderInteractionMode } from "@t3tools/contracts";

import {
  composerAssistThreadCwd,
  type ComposerAssistThreadSource,
} from "../composerAssistThreadSource.ts";

export interface PromptAutocompleteContext {
  readonly cwd: string;
  readonly interactionMode: ProviderInteractionMode;
  readonly projectTitle: string | null;
  readonly threadTitle: string | null;
  readonly draftBeforeCursor: string;
  readonly draftAfterCursor: string;
  readonly latestUserMessage: string;
  readonly latestAssistantMessage: string;
  readonly recentMessages: ReadonlyArray<{
    role: "user" | "assistant";
    text: string;
  }>;
  readonly changedFiles: ReadonlyArray<{
    path: string;
    kind: string;
    additions: number;
    deletions: number;
  }>;
}

function clampCursor(draft: string, cursor: number): number {
  if (!Number.isFinite(cursor)) return draft.length;
  return Math.max(0, Math.min(draft.length, Math.floor(cursor)));
}

export function buildPromptAutocompleteContext(
  source: ComposerAssistThreadSource,
  input: PromptAutocompleteInput,
): PromptAutocompleteContext | null {
  const cwd = composerAssistThreadCwd(source);
  if (!cwd) {
    return null;
  }

  const cursor = clampCursor(input.draft, input.cursor);
  const recentMessages = source.messages.flatMap((message) => {
    const text = message.text.trim();
    return text.length > 0 && (message.role === "user" || message.role === "assistant")
      ? [{ role: message.role, text }]
      : [];
  });
  const latestMessageText = (role: "user" | "assistant") =>
    recentMessages.findLast((message) => message.role === role)?.text ?? "";
  const checkpoint = source.checkpoints.findLast((entry) => entry.status === "ready");

  return {
    cwd,
    interactionMode: source.thread.interactionMode,
    projectTitle: source.project?.title ?? null,
    threadTitle: source.thread.title,
    draftBeforeCursor: input.draft.slice(0, cursor),
    draftAfterCursor: input.draft.slice(cursor),
    latestUserMessage: latestMessageText("user"),
    latestAssistantMessage: latestMessageText("assistant"),
    recentMessages: recentMessages.slice(-6),
    changedFiles:
      checkpoint?.files.map((file) => ({
        path: file.path,
        kind: file.kind,
        additions: file.additions,
        deletions: file.deletions,
      })) ?? [],
  };
}

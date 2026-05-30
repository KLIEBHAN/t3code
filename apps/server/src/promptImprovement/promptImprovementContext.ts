import type { ProviderInteractionMode } from "@t3tools/contracts";

import {
  composerAssistThreadCwd,
  type ComposerAssistThreadSource,
} from "../composerAssistThreadSource.ts";

export interface PromptImprovementContext {
  readonly cwd: string;
  readonly interactionMode: ProviderInteractionMode;
  readonly projectTitle: string | null;
  readonly threadTitle: string | null;
  readonly latestUserMessage: string | null;
  readonly latestAssistantMessage: string | null;
}

export function buildPromptImprovementContext(
  source: ComposerAssistThreadSource,
): PromptImprovementContext | null {
  const cwd = composerAssistThreadCwd(source);
  if (!cwd) {
    return null;
  }

  const latestMessageText = (role: "user" | "assistant") =>
    source.messages
      .toReversed()
      .find((message) => message.role === role && message.text.trim().length > 0)
      ?.text.trim() ?? null;

  return {
    cwd,
    interactionMode: source.thread.interactionMode,
    projectTitle: source.project?.title ?? null,
    threadTitle: source.thread.title,
    latestUserMessage: latestMessageText("user"),
    latestAssistantMessage: latestMessageText("assistant"),
  };
}

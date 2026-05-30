import type { PromptImprovementInput } from "@t3tools/contracts";

import type { Thread } from "./types";

function hasUnsupportedPromptImprovementSyntax(prompt: string): boolean {
  const trimmedStart = prompt.trimStart();
  return trimmedStart.startsWith("/") || prompt.includes("@");
}

export function derivePromptImprovementRequest(input: {
  activeThread: Thread | undefined;
  isServerThread: boolean;
  prompt: string;
  isBusy: boolean;
  hasPendingApproval: boolean;
  hasPendingUserInput: boolean;
  showPlanFollowUpPrompt: boolean;
  composerImageCount: number;
}): PromptImprovementInput | null {
  const trimmedPrompt = input.prompt.trim();
  if (!input.activeThread || !input.isServerThread) {
    return null;
  }
  if (trimmedPrompt.length === 0 || input.isBusy) {
    return null;
  }
  if (input.hasPendingApproval || input.hasPendingUserInput || input.showPlanFollowUpPrompt) {
    return null;
  }
  if (input.composerImageCount > 0 || hasUnsupportedPromptImprovementSyntax(input.prompt)) {
    return null;
  }

  return {
    threadId: input.activeThread.id,
    prompt: trimmedPrompt,
  };
}

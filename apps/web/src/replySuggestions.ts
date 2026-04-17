import type { ReplySuggestionsInput } from "@t3tools/contracts";

import type { Thread } from "./types";

export function deriveReplySuggestionsRequest(input: {
  activeThread: Thread | undefined;
  latestTurnOutputSettled: boolean;
  hasPendingApproval: boolean;
  hasPendingUserInput: boolean;
  showPlanFollowUpPrompt: boolean;
  prompt: string;
  composerImageCount: number;
  promptTemplateId: string;
  promptTemplateInstructions: string;
}): ReplySuggestionsInput | null {
  const { activeThread } = input;
  if (!activeThread) {
    return null;
  }

  const latestTurn = activeThread.latestTurn;
  if (!latestTurn || !latestTurn.turnId || latestTurn.state !== "completed") {
    return null;
  }
  if (!input.latestTurnOutputSettled || !latestTurn.completedAt) {
    return null;
  }
  if (input.hasPendingApproval || input.hasPendingUserInput || input.showPlanFollowUpPrompt) {
    return null;
  }
  if (input.prompt.trim().length > 0 || input.composerImageCount > 0) {
    return null;
  }

  return {
    threadId: activeThread.id,
    turnId: latestTurn.turnId,
    promptTemplateId: input.promptTemplateId,
    promptTemplateInstructions: input.promptTemplateInstructions,
  };
}

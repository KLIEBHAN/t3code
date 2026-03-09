import type { ThreadId } from "@t3tools/contracts";

import type { DraftThreadEnvMode, DraftThreadState } from "./composerDraftStore";
import type { Thread } from "./types";

export function buildLocalDraftThread(
  threadId: ThreadId,
  draftThread: DraftThreadState,
  fallbackModel: string,
  error: string | null,
): Thread {
  return {
    id: threadId,
    codexThreadId: null,
    projectId: draftThread.projectId,
    title: "New thread",
    model: fallbackModel,
    runtimeMode: draftThread.runtimeMode,
    interactionMode: draftThread.interactionMode,
    session: null,
    messages: [],
    error,
    createdAt: draftThread.createdAt,
    updatedAt: draftThread.createdAt,
    latestTurn: null,
    lastVisitedAt: draftThread.createdAt,
    branch: draftThread.branch,
    worktreePath: draftThread.worktreePath,
    turnDiffSummaries: [],
    activities: [],
    proposedPlans: [],
  };
}

export function resolveDraftThreadEnvMode(options: {
  activeWorktreePath: string | null | undefined;
  isLocalDraftThread: boolean;
  draftThreadEnvMode: DraftThreadEnvMode | null | undefined;
}): DraftThreadEnvMode {
  if (options.activeWorktreePath) {
    return "worktree";
  }

  if (options.isLocalDraftThread) {
    return options.draftThreadEnvMode ?? "local";
  }

  return "local";
}

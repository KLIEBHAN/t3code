import {
  type ProjectId,
  type ProviderInteractionMode,
  type RuntimeMode,
  type ThreadId,
} from "@t3tools/contracts";

import {
  type DraftThreadEnvMode,
  type DraftThreadState,
  type ProjectDraftThread,
} from "./composerDraftStore";
import { newThreadId } from "./lib/utils";
import type { Thread } from "./types";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE } from "./types";

export interface OpenThreadDraftOptions {
  branch?: string | null;
  worktreePath?: string | null;
  envMode?: DraftThreadEnvMode;
  createdAt?: string;
  runtimeMode?: RuntimeMode;
  interactionMode?: ProviderInteractionMode;
}

interface OpenThreadDraftDependencies {
  getDraftThreadByProjectId: (projectId: ProjectId) => ProjectDraftThread | null;
  getDraftThread: (threadId: ThreadId) => DraftThreadState | null;
  setProjectDraftThreadId: (
    projectId: ProjectId,
    threadId: ThreadId,
    options?: OpenThreadDraftOptions,
  ) => void;
  setDraftThreadContext: (threadId: ThreadId, options: OpenThreadDraftOptions) => void;
  clearProjectDraftThreadId: (projectId: ProjectId) => void;
  routeThreadId: ThreadId | null;
  navigateToThread: (threadId: ThreadId) => Promise<void>;
}

export function deriveNewThreadDraftOptions(input: {
  activeThread: Pick<Thread, "branch" | "worktreePath"> | null;
  activeDraftThread: Pick<DraftThreadState, "branch" | "worktreePath" | "envMode"> | null;
  preserveContext: boolean;
}): OpenThreadDraftOptions {
  if (!input.preserveContext) {
    return {
      branch: null,
      worktreePath: null,
      envMode: "local",
    };
  }

  return {
    branch: input.activeThread?.branch ?? input.activeDraftThread?.branch ?? null,
    worktreePath: input.activeThread?.worktreePath ?? input.activeDraftThread?.worktreePath ?? null,
    envMode:
      input.activeDraftThread?.envMode ??
      (input.activeThread?.worktreePath ? "worktree" : "local"),
  };
}

export async function openThreadDraftForProject(
  projectId: ProjectId,
  dependencies: OpenThreadDraftDependencies,
  options?: OpenThreadDraftOptions,
): Promise<void> {
  const hasBranchOption = options?.branch !== undefined;
  const hasWorktreePathOption = options?.worktreePath !== undefined;
  const hasEnvModeOption = options?.envMode !== undefined;
  const hasCreatedAtOption = options?.createdAt !== undefined;
  const hasRuntimeModeOption = options?.runtimeMode !== undefined;
  const hasInteractionModeOption = options?.interactionMode !== undefined;

  const storedDraftThread = dependencies.getDraftThreadByProjectId(projectId);
  if (storedDraftThread) {
    if (
      hasBranchOption ||
      hasWorktreePathOption ||
      hasEnvModeOption ||
      hasCreatedAtOption ||
      hasRuntimeModeOption ||
      hasInteractionModeOption
    ) {
      dependencies.setDraftThreadContext(storedDraftThread.threadId, {
        ...(hasBranchOption ? { branch: options?.branch ?? null } : {}),
        ...(hasWorktreePathOption ? { worktreePath: options?.worktreePath ?? null } : {}),
        ...(hasEnvModeOption ? { envMode: options?.envMode } : {}),
        ...(hasCreatedAtOption ? { createdAt: options?.createdAt } : {}),
        ...(hasRuntimeModeOption ? { runtimeMode: options?.runtimeMode } : {}),
        ...(hasInteractionModeOption ? { interactionMode: options?.interactionMode } : {}),
      });
    }
    dependencies.setProjectDraftThreadId(projectId, storedDraftThread.threadId);
    if (dependencies.routeThreadId === storedDraftThread.threadId) {
      return;
    }
    await dependencies.navigateToThread(storedDraftThread.threadId);
    return;
  }

  dependencies.clearProjectDraftThreadId(projectId);

  const activeDraftThread = dependencies.routeThreadId
    ? dependencies.getDraftThread(dependencies.routeThreadId)
    : null;
  if (
    activeDraftThread &&
    dependencies.routeThreadId &&
    activeDraftThread.projectId === projectId
  ) {
    if (
      hasBranchOption ||
      hasWorktreePathOption ||
      hasEnvModeOption ||
      hasCreatedAtOption ||
      hasRuntimeModeOption ||
      hasInteractionModeOption
    ) {
      dependencies.setDraftThreadContext(dependencies.routeThreadId, {
        ...(hasBranchOption ? { branch: options?.branch ?? null } : {}),
        ...(hasWorktreePathOption ? { worktreePath: options?.worktreePath ?? null } : {}),
        ...(hasEnvModeOption ? { envMode: options?.envMode } : {}),
        ...(hasCreatedAtOption ? { createdAt: options?.createdAt } : {}),
        ...(hasRuntimeModeOption ? { runtimeMode: options?.runtimeMode } : {}),
        ...(hasInteractionModeOption ? { interactionMode: options?.interactionMode } : {}),
      });
    }
    dependencies.setProjectDraftThreadId(projectId, dependencies.routeThreadId);
    return;
  }

  const threadId = newThreadId();
  dependencies.setProjectDraftThreadId(projectId, threadId, {
    createdAt: options?.createdAt ?? new Date().toISOString(),
    branch: options?.branch ?? null,
    worktreePath: options?.worktreePath ?? null,
    envMode: options?.envMode ?? "local",
    runtimeMode: options?.runtimeMode ?? DEFAULT_RUNTIME_MODE,
    interactionMode: options?.interactionMode ?? DEFAULT_INTERACTION_MODE,
  });
  await dependencies.navigateToThread(threadId);
}

import {
  DEFAULT_MODEL_BY_PROVIDER,
  type ModelSlug,
  type NativeApi,
  type ProjectId,
  type ProviderInteractionMode,
  type RuntimeMode,
  type ThreadId,
} from "@t3tools/contracts";
import type { MutableRefObject } from "react";

import type { DraftThreadState, ProjectDraftThread } from "./composerDraftStore";
import { readNativeApi } from "./nativeApi";
import { deriveNewThreadDraftOptions, openThreadDraftForProject } from "./threadDraftNavigation";
import { type Project, type Thread } from "./types";
import { toastManager } from "./components/ui/toast";
import { newCommandId } from "./lib/utils";

export async function openChatThreadDraft(options: {
  activeProjectId: ProjectId | null | undefined;
  routeThreadId: ThreadId;
  activeThread: Thread | null;
  activeDraftThread: DraftThreadState | null;
  preserveContext: boolean;
  getDraftThreadByProjectId: (projectId: ProjectId) => ProjectDraftThread | null;
  getDraftThread: (threadId: ThreadId) => DraftThreadState | null;
  setProjectDraftThreadId: (
    projectId: ProjectId,
    threadId: ThreadId,
    draftOptions?: {
      branch?: string | null;
      worktreePath?: string | null;
      envMode?: DraftThreadState["envMode"];
      createdAt?: string;
      runtimeMode?: RuntimeMode;
      interactionMode?: ProviderInteractionMode;
    },
  ) => void;
  setDraftThreadContext: (
    threadId: ThreadId,
    draftOptions: {
      branch?: string | null;
      worktreePath?: string | null;
      envMode?: DraftThreadState["envMode"];
      createdAt?: string;
      runtimeMode?: RuntimeMode;
      interactionMode?: ProviderInteractionMode;
    },
  ) => void;
  clearProjectDraftThreadId: (projectId: ProjectId) => void;
  navigateToThread: (threadId: ThreadId) => Promise<void>;
}): Promise<boolean> {
  if (!options.activeProjectId) {
    return false;
  }

  await openThreadDraftForProject(
    options.activeProjectId,
    {
      getDraftThreadByProjectId: options.getDraftThreadByProjectId,
      getDraftThread: options.getDraftThread,
      setProjectDraftThreadId: options.setProjectDraftThreadId,
      setDraftThreadContext: options.setDraftThreadContext,
      clearProjectDraftThreadId: options.clearProjectDraftThreadId,
      routeThreadId: options.routeThreadId,
      navigateToThread: options.navigateToThread,
    },
    deriveNewThreadDraftOptions({
      activeThread: options.activeThread,
      activeDraftThread: options.activeDraftThread,
      preserveContext: options.preserveContext,
    }),
  );
  return true;
}

export async function runProgrammaticChatThreadCommand(options: {
  activeThread: Thread | null | undefined;
  activeProject: Project | null | undefined;
  isLocalDraftThread: boolean;
  isSendBusy: boolean;
  isConnecting: boolean;
  sendInFlightRef: MutableRefObject<boolean>;
  beginSendPhase: (phase: "preparing-worktree" | "sending-turn") => void;
  resetSendPhase: () => void;
  setThreadError: (threadId: ThreadId | null, error: string | null) => void;
  clearDraftThread: (threadId: ThreadId) => void;
  selectedModel: ModelSlug | null;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  dispatchCommand: (api: NativeApi, threadId: ThreadId) => Promise<void>;
  errorTitle: string;
}): Promise<boolean> {
  const api = readNativeApi();
  const activeThread = options.activeThread;
  const activeProject = options.activeProject;
  if (
    !api ||
    !activeThread ||
    !activeProject ||
    options.isSendBusy ||
    options.isConnecting ||
    options.sendInFlightRef.current
  ) {
    return false;
  }

  options.sendInFlightRef.current = true;
  options.beginSendPhase("sending-turn");
  options.setThreadError(activeThread.id, null);
  let createdServerThreadForLocalDraft = false;
  let dispatchSucceeded = false;
  const finish = () => {
    options.sendInFlightRef.current = false;
    if (!dispatchSucceeded) {
      options.resetSendPhase();
    }
  };

  try {
    if (options.isLocalDraftThread) {
      await api.orchestration.dispatchCommand({
        type: "thread.create",
        commandId: newCommandId(),
        threadId: activeThread.id,
        projectId: activeProject.id,
        title: activeThread.title,
        model: options.selectedModel || activeProject.model || DEFAULT_MODEL_BY_PROVIDER.codex,
        runtimeMode: options.runtimeMode,
        interactionMode: options.interactionMode,
        branch: activeThread.branch,
        worktreePath: activeThread.worktreePath,
        createdAt: activeThread.createdAt,
      });
      createdServerThreadForLocalDraft = true;
    }

    await options.dispatchCommand(api, activeThread.id);
    dispatchSucceeded = true;
    if (createdServerThreadForLocalDraft) {
      options.clearDraftThread(activeThread.id);
    }
    return true;
  } catch (error) {
    if (createdServerThreadForLocalDraft) {
      await api.orchestration
        .dispatchCommand({
          type: "thread.delete",
          commandId: newCommandId(),
          threadId: activeThread.id,
        })
        .catch(() => undefined);
    }
    toastManager.add({
      type: "error",
      title: options.errorTitle,
      description: error instanceof Error ? error.message : "An error occurred.",
    });
    return false;
  } finally {
    finish();
  }
}

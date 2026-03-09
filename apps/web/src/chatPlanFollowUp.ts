import type {
  AssistantDeliveryMode,
  ModelSlug,
  NativeApi,
  ProjectId,
  ProviderInteractionMode,
  ProviderKind,
  ProviderModelOptions,
  ProviderStartOptions,
  RuntimeMode,
  ThreadId,
} from "@t3tools/contracts";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import { newCommandId, newMessageId, newThreadId } from "~/lib/utils";
import { toastManager } from "./components/ui/toast";
import {
  buildPlanImplementationPrompt,
  buildPlanImplementationThreadTitle,
} from "./proposedPlan";
import { truncateTitle } from "./truncateTitle";
import type { ChatMessage } from "./types";

export async function submitPlanFollowUp(options: {
  api: NativeApi;
  threadId: ThreadId;
  text: string;
  interactionMode: ProviderInteractionMode;
  provider: ProviderKind;
  model: ModelSlug | null;
  modelOptions: ProviderModelOptions | undefined;
  providerOptions: ProviderStartOptions | undefined;
  runtimeMode: RuntimeMode;
  assistantDeliveryMode: AssistantDeliveryMode;
  sendInFlightRef: MutableRefObject<boolean>;
  planSidebarDismissedForTurnRef: MutableRefObject<string | null>;
  beginSendPhase: (phase: "preparing-worktree" | "sending-turn") => void;
  resetSendPhase: () => void;
  forceStickToBottom: () => void;
  persistThreadSettingsForNextTurn: (input: {
    threadId: ThreadId;
    createdAt: string;
    model?: string;
    runtimeMode: RuntimeMode;
    interactionMode: ProviderInteractionMode;
  }) => Promise<void>;
  setComposerDraftInteractionMode: (
    threadId: ThreadId,
    interactionMode: ProviderInteractionMode | null | undefined,
  ) => void;
  setOptimisticUserMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setPlanSidebarOpen: Dispatch<SetStateAction<boolean>>;
  setThreadError: (threadId: ThreadId | null, error: string | null) => void;
}): Promise<void> {
  const trimmed = options.text.trim();
  if (!trimmed) {
    return;
  }

  const messageId = newMessageId();
  const createdAt = new Date().toISOString();

  options.sendInFlightRef.current = true;
  options.beginSendPhase("sending-turn");
  options.setThreadError(options.threadId, null);
  options.setOptimisticUserMessages((existing) => [
    ...existing,
    {
      id: messageId,
      role: "user",
      text: trimmed,
      createdAt,
      streaming: false,
    },
  ]);
  options.forceStickToBottom();

  try {
    await options.persistThreadSettingsForNextTurn({
      threadId: options.threadId,
      createdAt,
      ...(options.model ? { model: options.model } : {}),
      runtimeMode: options.runtimeMode,
      interactionMode: options.interactionMode,
    });

    options.setComposerDraftInteractionMode(options.threadId, options.interactionMode);

    await options.api.orchestration.dispatchCommand({
      type: "thread.turn.start",
      commandId: newCommandId(),
      threadId: options.threadId,
      message: {
        messageId,
        role: "user",
        text: trimmed,
        attachments: [],
      },
      provider: options.provider,
      model: options.model || undefined,
      ...(options.modelOptions ? { modelOptions: options.modelOptions } : {}),
      ...(options.providerOptions ? { providerOptions: options.providerOptions } : {}),
      assistantDeliveryMode: options.assistantDeliveryMode,
      runtimeMode: options.runtimeMode,
      interactionMode: options.interactionMode,
      createdAt,
    });

    if (options.interactionMode === "default") {
      options.planSidebarDismissedForTurnRef.current = null;
      options.setPlanSidebarOpen(true);
    }
    options.sendInFlightRef.current = false;
  } catch (error) {
    options.setOptimisticUserMessages((existing) =>
      existing.filter((message) => message.id !== messageId),
    );
    options.setThreadError(
      options.threadId,
      error instanceof Error ? error.message : "Failed to send plan follow-up.",
    );
    options.sendInFlightRef.current = false;
    options.resetSendPhase();
  }
}

export async function implementPlanInNewThread(options: {
  api: NativeApi;
  projectId: ProjectId;
  currentThreadBranch: string | null;
  currentThreadWorktreePath: string | null;
  currentThreadModel: string;
  projectModel: string;
  planMarkdown: string;
  provider: ProviderKind;
  selectedModel: ModelSlug | null;
  modelOptions: ProviderModelOptions | undefined;
  providerOptions: ProviderStartOptions | undefined;
  runtimeMode: RuntimeMode;
  assistantDeliveryMode: AssistantDeliveryMode;
  sendInFlightRef: MutableRefObject<boolean>;
  planSidebarOpenOnNextThreadRef: MutableRefObject<boolean>;
  beginSendPhase: (phase: "preparing-worktree" | "sending-turn") => void;
  resetSendPhase: () => void;
  syncServerReadModel: (
    snapshot: Awaited<ReturnType<NativeApi["orchestration"]["getSnapshot"]>>,
  ) => void;
  navigateToThread: (threadId: ThreadId) => Promise<void>;
}): Promise<void> {
  const createdAt = new Date().toISOString();
  const nextThreadId = newThreadId();
  const implementationPrompt = buildPlanImplementationPrompt(options.planMarkdown);
  const nextThreadTitle = truncateTitle(buildPlanImplementationThreadTitle(options.planMarkdown));
  const nextThreadModel: ModelSlug =
    options.selectedModel ||
    (options.currentThreadModel as ModelSlug) ||
    (options.projectModel as ModelSlug);

  options.sendInFlightRef.current = true;
  options.beginSendPhase("sending-turn");
  const finish = () => {
    options.sendInFlightRef.current = false;
    options.resetSendPhase();
  };

  await options.api.orchestration
    .dispatchCommand({
      type: "thread.create",
      commandId: newCommandId(),
      threadId: nextThreadId,
      projectId: options.projectId,
      title: nextThreadTitle,
      model: nextThreadModel,
      runtimeMode: options.runtimeMode,
      interactionMode: "default",
      branch: options.currentThreadBranch,
      worktreePath: options.currentThreadWorktreePath,
      createdAt,
    })
    .then(() =>
      options.api.orchestration.dispatchCommand({
        type: "thread.turn.start",
        commandId: newCommandId(),
        threadId: nextThreadId,
        message: {
          messageId: newMessageId(),
          role: "user",
          text: implementationPrompt,
          attachments: [],
        },
        provider: options.provider,
        model: options.selectedModel || undefined,
        ...(options.modelOptions ? { modelOptions: options.modelOptions } : {}),
        ...(options.providerOptions ? { providerOptions: options.providerOptions } : {}),
        assistantDeliveryMode: options.assistantDeliveryMode,
        runtimeMode: options.runtimeMode,
        interactionMode: "default",
        createdAt,
      }),
    )
    .then(() => options.api.orchestration.getSnapshot())
    .then((snapshot) => {
      options.syncServerReadModel(snapshot);
      options.planSidebarOpenOnNextThreadRef.current = true;
      return options.navigateToThread(nextThreadId);
    })
    .catch(async (error) => {
      await options.api.orchestration
        .dispatchCommand({
          type: "thread.delete",
          commandId: newCommandId(),
          threadId: nextThreadId,
        })
        .catch(() => undefined);
      await options.api.orchestration
        .getSnapshot()
        .then((snapshot) => {
          options.syncServerReadModel(snapshot);
        })
        .catch(() => undefined);
      toastManager.add({
        type: "error",
        title: "Could not start implementation thread",
        description:
          error instanceof Error
            ? error.message
            : "An error occurred while creating the new thread.",
      });
    })
    .then(finish, finish);
}

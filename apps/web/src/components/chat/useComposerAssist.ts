import type { EnvironmentId, ModelSelection } from "@t3tools/contracts";
import { useCallback, useMemo, type MutableRefObject } from "react";

import { usePromptAutocomplete } from "../../hooks/usePromptAutocomplete";
import { usePromptImprovement } from "../../hooks/usePromptImprovement";
import { derivePromptAutocompleteRequest } from "../../promptAutocomplete";
import { derivePromptImprovementRequest } from "../../promptImprovement";
import type { ComposerTrigger } from "../../composer-logic";
import type { PendingApproval, PendingUserInput } from "../../session-logic";
import type { SessionPhase, Thread } from "../../types";
import { toastManager } from "../ui/toast";

interface UseComposerAssistOptions {
  activePendingApproval: PendingApproval | null;
  activePendingUserInput: PendingUserInput | null;
  activeThread: Thread | undefined;
  composerImageCount: number;
  composerCursor: number;
  composerTerminalContextCount: number;
  composerTrigger: ComposerTrigger | null;
  environmentId: EnvironmentId;
  isConnecting: boolean;
  isPreparingWorktree: boolean;
  isSendBusy: boolean;
  isServerThread: boolean;
  isComposerFocused: boolean;
  phase: SessionPhase;
  prompt: string;
  promptRef: MutableRefObject<string>;
  replaceComposerPrompt: (nextPrompt: string) => void;
  showPlanFollowUpPrompt: boolean;
  textGenerationModelSelection: ModelSelection | null;
}

type ComposerPromptImprovementState = ReturnType<typeof usePromptImprovement>;
type ComposerPromptAutocompleteState = ReturnType<typeof usePromptAutocomplete>;

interface UseComposerAssistResult {
  insertPromptImprovementBelow: () => void;
  onImprovePrompt: () => Promise<void>;
  promptAutocomplete: ComposerPromptAutocompleteState;
  promptImprovement: ComposerPromptImprovementState;
  replacePromptWithImprovement: () => void;
}

export function useComposerAssist(options: UseComposerAssistOptions): UseComposerAssistResult {
  const promptImprovementRequest = useMemo(
    () =>
      derivePromptImprovementRequest({
        activeThread: options.activeThread,
        isServerThread: options.isServerThread,
        prompt: options.prompt,
        isBusy:
          options.phase === "running" ||
          options.isSendBusy ||
          options.isConnecting ||
          options.isPreparingWorktree,
        hasPendingApproval: options.activePendingApproval !== null,
        hasPendingUserInput: options.activePendingUserInput !== null,
        showPlanFollowUpPrompt: options.showPlanFollowUpPrompt,
        composerImageCount: options.composerImageCount,
      }),
    [
      options.activePendingApproval,
      options.activePendingUserInput,
      options.activeThread,
      options.composerImageCount,
      options.isConnecting,
      options.isPreparingWorktree,
      options.isSendBusy,
      options.isServerThread,
      options.phase,
      options.prompt,
      options.showPlanFollowUpPrompt,
    ],
  );

  const promptImprovement = usePromptImprovement({
    environmentId: options.environmentId,
    request: promptImprovementRequest,
    currentPrompt: options.prompt,
  });

  const promptAutocompleteRequest = useMemo(
    () =>
      derivePromptAutocompleteRequest({
        activeThread: options.activeThread,
        isServerThread: options.isServerThread,
        prompt: options.prompt,
        cursor: options.composerCursor,
        isFocused: options.isComposerFocused,
        isBusy:
          options.phase === "running" ||
          options.isSendBusy ||
          options.isConnecting ||
          options.isPreparingWorktree,
        hasPendingApproval: options.activePendingApproval !== null,
        hasPendingUserInput: options.activePendingUserInput !== null,
        showPlanFollowUpPrompt: options.showPlanFollowUpPrompt,
        composerImageCount: options.composerImageCount,
        composerTerminalContextCount: options.composerTerminalContextCount,
        composerTrigger: options.composerTrigger,
      }),
    [
      options.activePendingApproval,
      options.activePendingUserInput,
      options.activeThread,
      options.composerCursor,
      options.composerImageCount,
      options.composerTerminalContextCount,
      options.composerTrigger,
      options.isComposerFocused,
      options.isConnecting,
      options.isPreparingWorktree,
      options.isSendBusy,
      options.isServerThread,
      options.phase,
      options.prompt,
      options.showPlanFollowUpPrompt,
    ],
  );
  const promptAutocomplete = usePromptAutocomplete({
    environmentId: options.environmentId,
    request: promptAutocompleteRequest,
    modelSelection: options.textGenerationModelSelection,
  });

  const replacePromptWithImprovement = useCallback(() => {
    const improvedPrompt = promptImprovement.currentImprovedPrompt;
    if (!improvedPrompt) {
      return;
    }
    options.replaceComposerPrompt(improvedPrompt);
    promptImprovement.dismiss();
  }, [options, promptImprovement]);

  const insertPromptImprovementBelow = useCallback(() => {
    const improvedPrompt = promptImprovement.currentImprovedPrompt;
    if (!improvedPrompt) {
      return;
    }
    const currentPrompt = options.promptRef.current.trimEnd();
    const nextPrompt =
      currentPrompt.length > 0 ? `${currentPrompt}\n\n${improvedPrompt}` : improvedPrompt;
    options.replaceComposerPrompt(nextPrompt);
    promptImprovement.dismiss();
  }, [options, promptImprovement]);

  const onImprovePrompt = useCallback(async () => {
    try {
      const result = await promptImprovement.improve();
      if (!result) {
        return;
      }
      if (!result.changed) {
        toastManager.add({
          type: "info",
          title: result.reason ?? "Prompt not changed",
        });
      }
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not improve prompt",
        description: error instanceof Error ? error.message : "An unexpected error occurred.",
      });
    }
  }, [promptImprovement]);

  return {
    insertPromptImprovementBelow,
    onImprovePrompt,
    promptAutocomplete,
    promptImprovement,
    replacePromptWithImprovement,
  };
}

import type { EnvironmentId, ModelSelection, ReplySuggestion } from "@t3tools/contracts";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, type MutableRefObject } from "react";

import { useReplySuggestionVisibility } from "../../hooks/useReplySuggestionVisibility";
import { usePromptImprovement } from "../../hooks/usePromptImprovement";
import { replySuggestionsQueryOptions } from "../../lib/replySuggestionsReactQuery";
import { derivePromptImprovementRequest } from "../../promptImprovement";
import { deriveReplySuggestionsRequest } from "../../replySuggestions";
import type { PendingApproval, PendingUserInput } from "../../session-logic";
import type { SessionPhase, Thread } from "../../types";
import { toastManager } from "../ui/toast";

interface ReplySuggestionPromptTemplateSelection {
  id: string;
  instructions: string;
}

interface UseComposerAssistOptions {
  activePendingApproval: PendingApproval | null;
  activePendingUserInput: PendingUserInput | null;
  activeThread: Thread | undefined;
  composerImageCount: number;
  environmentId: EnvironmentId;
  isConnecting: boolean;
  isPreparingWorktree: boolean;
  isSendBusy: boolean;
  isServerThread: boolean;
  latestTurnOutputSettled: boolean;
  phase: SessionPhase;
  prompt: string;
  promptRef: MutableRefObject<string>;
  replaceComposerPrompt: (nextPrompt: string) => void;
  selectedReplySuggestionPromptTemplate: ReplySuggestionPromptTemplateSelection;
  showPlanFollowUpPrompt: boolean;
  textGenerationModelSelection: ModelSelection | null;
}

type ComposerPromptImprovementState = ReturnType<typeof usePromptImprovement>;
type ComposerReplySuggestionVisibility = ReturnType<typeof useReplySuggestionVisibility>;

interface UseComposerAssistResult {
  editReplySuggestion: (text: string) => void;
  insertPromptImprovementBelow: () => void;
  onImprovePrompt: () => Promise<void>;
  promptImprovement: ComposerPromptImprovementState;
  replySuggestionVisibility: ComposerReplySuggestionVisibility;
  replySuggestions: readonly ReplySuggestion[];
  replacePromptWithImprovement: () => void;
  showReplySuggestions: boolean;
}

export function useComposerAssist(options: UseComposerAssistOptions): UseComposerAssistResult {
  const replySuggestionRequest = useMemo(
    () =>
      deriveReplySuggestionsRequest({
        activeThread: options.activeThread,
        latestTurnOutputSettled: options.latestTurnOutputSettled,
        hasPendingApproval: options.activePendingApproval !== null,
        hasPendingUserInput: options.activePendingUserInput !== null,
        showPlanFollowUpPrompt: options.showPlanFollowUpPrompt,
        prompt: options.prompt,
        composerImageCount: options.composerImageCount,
        promptTemplateId: options.selectedReplySuggestionPromptTemplate.id,
        promptTemplateInstructions: options.selectedReplySuggestionPromptTemplate.instructions,
      }),
    [
      options.activePendingApproval,
      options.activePendingUserInput,
      options.activeThread,
      options.composerImageCount,
      options.latestTurnOutputSettled,
      options.prompt,
      options.selectedReplySuggestionPromptTemplate.id,
      options.selectedReplySuggestionPromptTemplate.instructions,
      options.showPlanFollowUpPrompt,
    ],
  );

  const replySuggestionsQuery = useQuery(
    replySuggestionsQueryOptions(
      options.environmentId,
      replySuggestionRequest,
      options.textGenerationModelSelection,
    ),
  );
  const replySuggestions = replySuggestionsQuery.data?.suggestions ?? [];
  const replySuggestionsTurnId = options.activeThread?.latestTurn?.turnId ?? null;
  const replySuggestionVisibility = useReplySuggestionVisibility(replySuggestionsTurnId);
  const showReplySuggestions = replySuggestions.length > 0 && !options.isSendBusy;

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

  const editReplySuggestion = useCallback(
    (text: string) => {
      promptImprovement.dismiss();
      options.replaceComposerPrompt(text);
    },
    [options, promptImprovement],
  );

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
    editReplySuggestion,
    insertPromptImprovementBelow,
    onImprovePrompt,
    promptImprovement,
    replySuggestionVisibility,
    replySuggestions,
    replacePromptWithImprovement,
    showReplySuggestions,
  };
}

import type { ApprovalRequestId } from "@t3tools/contracts";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useCallback } from "react";

import {
  expandCollapsedComposerCursor,
  type ComposerTrigger,
} from "./composer-logic";
import {
  setPendingUserInputCustomAnswer,
  type PendingUserInputDraftAnswer,
  type PendingUserInputProgress,
} from "./pendingUserInput";
import type { PendingUserInput } from "./session-logic";

export function useChatPendingUserInputActions(options: {
  activePendingUserInput: PendingUserInput | null;
  activePendingProgress: PendingUserInputProgress | null;
  activePendingResolvedAnswers: Record<string, string> | null;
  onRespondToUserInput: (requestId: ApprovalRequestId, answers: Record<string, string>) => void;
  promptRef: MutableRefObject<string>;
  detectChatComposerTrigger: (text: string, cursorInput: number) => ComposerTrigger | null;
  setPendingUserInputAnswersByRequestId: Dispatch<
    SetStateAction<Record<string, Record<string, PendingUserInputDraftAnswer>>>
  >;
  setPendingUserInputQuestionIndexByRequestId: Dispatch<SetStateAction<Record<string, number>>>;
  setComposerCursor: Dispatch<SetStateAction<number>>;
  setComposerTrigger: Dispatch<SetStateAction<ComposerTrigger | null>>;
}) {
  const {
    activePendingProgress,
    activePendingResolvedAnswers,
    activePendingUserInput,
    detectChatComposerTrigger,
    onRespondToUserInput,
    promptRef,
    setComposerCursor,
    setComposerTrigger,
    setPendingUserInputAnswersByRequestId,
    setPendingUserInputQuestionIndexByRequestId,
  } = options;

  const setActivePendingUserInputQuestionIndex = useCallback(
    (nextQuestionIndex: number) => {
      if (!activePendingUserInput) {
        return;
      }
      setPendingUserInputQuestionIndexByRequestId((existing) => ({
        ...existing,
        [activePendingUserInput.requestId]: nextQuestionIndex,
      }));
    },
    [activePendingUserInput, setPendingUserInputQuestionIndexByRequestId],
  );

  const onSelectActivePendingUserInputOption = useCallback(
    (questionId: string, optionLabel: string) => {
      if (!activePendingUserInput) {
        return;
      }
      setPendingUserInputAnswersByRequestId((existing) => ({
        ...existing,
        [activePendingUserInput.requestId]: {
          ...existing[activePendingUserInput.requestId],
          [questionId]: {
            selectedOptionLabel: optionLabel,
            customAnswer: "",
          },
        },
      }));
      promptRef.current = "";
      setComposerCursor(0);
      setComposerTrigger(null);
    },
    [
      activePendingUserInput,
      promptRef,
      setComposerCursor,
      setComposerTrigger,
      setPendingUserInputAnswersByRequestId,
    ],
  );

  const onChangeActivePendingUserInputCustomAnswer = useCallback(
    (questionId: string, value: string, nextCursor: number, cursorAdjacentToMention: boolean) => {
      if (!activePendingUserInput) {
        return;
      }
      promptRef.current = value;
      setPendingUserInputAnswersByRequestId((existing) => ({
        ...existing,
        [activePendingUserInput.requestId]: {
          ...existing[activePendingUserInput.requestId],
          [questionId]: setPendingUserInputCustomAnswer(
            existing[activePendingUserInput.requestId]?.[questionId],
            value,
          ),
        },
      }));
      setComposerCursor(nextCursor);
      setComposerTrigger(
        cursorAdjacentToMention
          ? null
          : detectChatComposerTrigger(value, expandCollapsedComposerCursor(value, nextCursor)),
      );
    },
    [
      activePendingUserInput,
      detectChatComposerTrigger,
      promptRef,
      setComposerCursor,
      setComposerTrigger,
      setPendingUserInputAnswersByRequestId,
    ],
  );

  const onAdvanceActivePendingUserInput = useCallback(() => {
    if (!activePendingUserInput || !activePendingProgress) {
      return;
    }
    if (activePendingProgress.isLastQuestion) {
      if (activePendingResolvedAnswers) {
        onRespondToUserInput(activePendingUserInput.requestId, activePendingResolvedAnswers);
      }
      return;
    }
    setActivePendingUserInputQuestionIndex(activePendingProgress.questionIndex + 1);
  }, [
    activePendingProgress,
    activePendingResolvedAnswers,
    activePendingUserInput,
    onRespondToUserInput,
    setActivePendingUserInputQuestionIndex,
  ]);

  const onPreviousActivePendingUserInputQuestion = useCallback(() => {
    if (!activePendingProgress) {
      return;
    }
    setActivePendingUserInputQuestionIndex(Math.max(activePendingProgress.questionIndex - 1, 0));
  }, [activePendingProgress, setActivePendingUserInputQuestionIndex]);

  return {
    onSelectActivePendingUserInputOption,
    onChangeActivePendingUserInputCustomAnswer,
    onAdvanceActivePendingUserInput,
    onPreviousActivePendingUserInputQuestion,
  };
}

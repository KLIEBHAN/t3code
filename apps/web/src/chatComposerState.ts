import type {
  ApprovalRequestId,
  OrchestrationThreadActivity,
  ProviderInteractionMode,
  TurnId,
} from "@t3tools/contracts";

import {
  buildPendingUserInputAnswers,
  derivePendingUserInputProgress,
  type PendingUserInputDraftAnswer,
} from "./pendingUserInput";
import {
  deriveActivePlanState,
  derivePendingApprovals,
  derivePendingUserInputs,
  findLatestProposedPlan,
  type ActivePlanState,
  type LatestProposedPlanState,
  type PendingApproval,
  type PendingUserInput,
} from "./session-logic";
import type { ProposedPlan } from "./types";

const EMPTY_PENDING_USER_INPUT_ANSWERS: Record<string, PendingUserInputDraftAnswer> = {};

export interface ChatComposerDerivedState {
  readonly pendingApprovals: PendingApproval[];
  readonly pendingUserInputs: PendingUserInput[];
  readonly activePendingApproval: PendingApproval | null;
  readonly activePendingUserInput: PendingUserInput | null;
  readonly activePendingDraftAnswers: Record<string, PendingUserInputDraftAnswer>;
  readonly activePendingQuestionIndex: number;
  readonly activePendingProgress: ReturnType<typeof derivePendingUserInputProgress> | null;
  readonly activePendingResolvedAnswers: Record<string, string> | null;
  readonly activePendingIsResponding: boolean;
  readonly activeProposedPlan: LatestProposedPlanState | null;
  readonly activePlan: ActivePlanState | null;
  readonly showPlanFollowUpPrompt: boolean;
  readonly isComposerApprovalState: boolean;
  readonly hasComposerHeader: boolean;
}

export function deriveChatComposerState(options: {
  threadActivities: readonly OrchestrationThreadActivity[];
  activeLatestTurnId: TurnId | null;
  latestTurnSettled: boolean;
  proposedPlans: readonly ProposedPlan[];
  interactionMode: ProviderInteractionMode;
  pendingUserInputAnswersByRequestId: Record<string, Record<string, PendingUserInputDraftAnswer>>;
  pendingUserInputQuestionIndexByRequestId: Record<string, number>;
  respondingUserInputRequestIds: readonly ApprovalRequestId[];
}): ChatComposerDerivedState {
  const pendingApprovals = derivePendingApprovals(options.threadActivities);
  const pendingUserInputs = derivePendingUserInputs(options.threadActivities);
  const activePendingApproval = pendingApprovals[0] ?? null;
  const activePendingUserInput = pendingUserInputs[0] ?? null;
  const activePendingDraftAnswers = activePendingUserInput
    ? (options.pendingUserInputAnswersByRequestId[activePendingUserInput.requestId] ??
      EMPTY_PENDING_USER_INPUT_ANSWERS)
    : EMPTY_PENDING_USER_INPUT_ANSWERS;
  const activePendingQuestionIndex = activePendingUserInput
    ? (options.pendingUserInputQuestionIndexByRequestId[activePendingUserInput.requestId] ?? 0)
    : 0;
  const activePendingProgress = activePendingUserInput
    ? derivePendingUserInputProgress(
        activePendingUserInput.questions,
        activePendingDraftAnswers,
        activePendingQuestionIndex,
      )
    : null;
  const activePendingResolvedAnswers = activePendingUserInput
    ? buildPendingUserInputAnswers(activePendingUserInput.questions, activePendingDraftAnswers)
    : null;
  const activePendingIsResponding = activePendingUserInput
    ? options.respondingUserInputRequestIds.includes(activePendingUserInput.requestId)
    : false;
  const activeProposedPlan = options.latestTurnSettled
    ? findLatestProposedPlan(options.proposedPlans, options.activeLatestTurnId)
    : null;
  const activePlan = deriveActivePlanState(
    options.threadActivities,
    options.activeLatestTurnId ?? undefined,
  );
  const showPlanFollowUpPrompt =
    pendingUserInputs.length === 0 &&
    options.interactionMode === "plan" &&
    options.latestTurnSettled &&
    activeProposedPlan !== null;
  const isComposerApprovalState = activePendingApproval !== null;
  const hasComposerHeader =
    isComposerApprovalState ||
    pendingUserInputs.length > 0 ||
    (showPlanFollowUpPrompt && activeProposedPlan !== null);

  return {
    pendingApprovals,
    pendingUserInputs,
    activePendingApproval,
    activePendingUserInput,
    activePendingDraftAnswers,
    activePendingQuestionIndex,
    activePendingProgress,
    activePendingResolvedAnswers,
    activePendingIsResponding,
    activeProposedPlan,
    activePlan,
    showPlanFollowUpPrompt,
    isComposerApprovalState,
    hasComposerHeader,
  };
}

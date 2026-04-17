import type { ProposedPlan } from "./types";

export type ProposedPlanImplementationState = "actionable" | "implemented" | "legacyUnknown";

type ProposedPlanImplementationInput = Pick<
  ProposedPlan,
  "createdAt" | "implementedAt" | "implementationThreadId"
>;

// Introduced by main commit 0de5742b ("fix: consume plans on implementation").
const PROPOSED_PLAN_IMPLEMENTATION_TRACKING_INTRODUCED_AT_MS = Date.parse(
  "2026-03-18T20:09:57.000Z",
);

function wasCreatedBeforeImplementationTracking(
  proposedPlan: ProposedPlanImplementationInput,
): boolean {
  const createdAtMs = Date.parse(proposedPlan.createdAt);
  if (Number.isNaN(createdAtMs)) {
    return false;
  }

  return createdAtMs < PROPOSED_PLAN_IMPLEMENTATION_TRACKING_INTRODUCED_AT_MS;
}

export function deriveProposedPlanImplementationState(
  proposedPlan: ProposedPlanImplementationInput | null,
): ProposedPlanImplementationState | null {
  if (proposedPlan === null) {
    return null;
  }

  if (proposedPlan.implementedAt !== null || proposedPlan.implementationThreadId !== null) {
    return "implemented";
  }

  if (wasCreatedBeforeImplementationTracking(proposedPlan)) {
    return "legacyUnknown";
  }

  return "actionable";
}

export function isLegacyProposedPlanImplementationUnknown(
  proposedPlan: ProposedPlanImplementationInput | null,
): boolean {
  return deriveProposedPlanImplementationState(proposedPlan) === "legacyUnknown";
}

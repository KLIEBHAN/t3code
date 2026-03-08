import type { TurnId } from "@t3tools/contracts";
import type { TurnDiffSummary } from "./types";

export function resolveCheckpointTurnCount(
  summary: TurnDiffSummary,
  inferredCheckpointTurnCountByTurnId: Record<TurnId, number>,
): number | undefined {
  return summary.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[summary.turnId];
}

export function isTurnDiffNavigable(
  summary: TurnDiffSummary | undefined,
  inferredCheckpointTurnCountByTurnId: Record<TurnId, number>,
): summary is TurnDiffSummary {
  if (!summary?.checkpointRef) {
    return false;
  }
  return typeof resolveCheckpointTurnCount(summary, inferredCheckpointTurnCountByTurnId) === "number";
}

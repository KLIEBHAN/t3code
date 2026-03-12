import type { TurnId } from "@t3tools/contracts";
import type { TurnDiffSummary } from "./types";

export function resolveCheckpointTurnCount(
  summary: TurnDiffSummary,
  inferredCheckpointTurnCountByTurnId: Record<TurnId, number>,
): number | undefined {
  return summary.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[summary.turnId];
}

export function buildTurnDiffSummaryByCheckpointTurnCount(
  summaries: ReadonlyArray<TurnDiffSummary>,
  inferredCheckpointTurnCountByTurnId: Record<TurnId, number>,
): Map<number, TurnDiffSummary> {
  const byTurnCount = new Map<number, TurnDiffSummary>();
  for (const summary of summaries) {
    const checkpointTurnCount = resolveCheckpointTurnCount(
      summary,
      inferredCheckpointTurnCountByTurnId,
    );
    if (typeof checkpointTurnCount !== "number") {
      continue;
    }
    byTurnCount.set(checkpointTurnCount, summary);
  }
  return byTurnCount;
}

export function isTurnDiffNavigable(
  summary: TurnDiffSummary | undefined,
  summaryByCheckpointTurnCount: ReadonlyMap<number, TurnDiffSummary>,
  inferredCheckpointTurnCountByTurnId: Record<TurnId, number>,
): summary is TurnDiffSummary {
  if (!summary?.checkpointRef) {
    return false;
  }
  const checkpointTurnCount = resolveCheckpointTurnCount(
    summary,
    inferredCheckpointTurnCountByTurnId,
  );
  if (typeof checkpointTurnCount !== "number" || checkpointTurnCount < 1) {
    return false;
  }
  if (checkpointTurnCount === 1) {
    return true;
  }

  return Boolean(summaryByCheckpointTurnCount.get(checkpointTurnCount - 1)?.checkpointRef);
}

export function hasTurnDiffFallbackPatch(summary: TurnDiffSummary | undefined): boolean {
  return typeof summary?.unifiedDiff === "string" && summary.unifiedDiff.trim().length > 0;
}

export function isTurnDiffOpenable(
  summary: TurnDiffSummary | undefined,
  summaryByCheckpointTurnCount: ReadonlyMap<number, TurnDiffSummary>,
  inferredCheckpointTurnCountByTurnId: Record<TurnId, number>,
): summary is TurnDiffSummary {
  return (
    hasTurnDiffFallbackPatch(summary) ||
    isTurnDiffNavigable(summary, summaryByCheckpointTurnCount, inferredCheckpointTurnCountByTurnId)
  );
}

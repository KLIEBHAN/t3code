import { useMemo } from "react";
import { inferCheckpointTurnCountByTurnId } from "../session-logic";
import type { Thread } from "../types";

export function useTurnDiffSummaries(activeThread: Thread | undefined) {
  const turnDiffSummaries = useMemo(() => {
    if (!activeThread) {
      return [];
    }
    return activeThread.turnDiffSummaries;
  }, [activeThread]);

  const turnDiffSummaryByTurnId = useMemo(
    () => new Map(turnDiffSummaries.map((summary) => [summary.turnId, summary] as const)),
    [turnDiffSummaries],
  );

  const inferredCheckpointTurnCountByTurnId = useMemo(
    () => inferCheckpointTurnCountByTurnId(turnDiffSummaries),
    [turnDiffSummaries],
  );

  return { turnDiffSummaries, turnDiffSummaryByTurnId, inferredCheckpointTurnCountByTurnId };
}

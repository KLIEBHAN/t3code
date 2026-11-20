// Fork: Stop ends a thread's pull request watches without waking the agent, so its next turn
// would still think them watched. The next prompted turn says which ones Stop ended.
import type {
  OrchestrationV2ProviderTurn,
  OrchestrationV2Run,
  OrchestrationV2RunAttempt,
  ThreadPullRequestLink,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { visibleThreadPullRequests } from "@t3tools/shared/threadPullRequests";

/**
 * Links whose watch Stop ended and that no turn started since has completed with the note. A
 * new watch or unlinking the pull request drops it; compactions and goal commands carry none.
 */
export function pendingStoppedWatches(input: {
  readonly pullRequests: ReadonlyArray<ThreadPullRequestLink>;
  readonly run: Pick<OrchestrationV2Run, "id" | "userMessageId" | "activeAttemptId">;
  readonly runs: ReadonlyArray<Pick<OrchestrationV2Run, "id" | "userMessageId" | "status">>;
  readonly attempts: ReadonlyArray<Pick<OrchestrationV2RunAttempt, "id" | "runId" | "startedAt">>;
  readonly providerTurns: ReadonlyArray<
    Pick<OrchestrationV2ProviderTurn, "runAttemptId" | "status">
  >;
  /** Called only when a Stop ended a watch: runs whose prompt is not the user's. */
  readonly compactionMessageIds: () => ReadonlySet<string>;
}): ReadonlyArray<ThreadPullRequestLink> {
  const stopped = visibleThreadPullRequests(input.pullRequests).filter(
    (link) => link.watch === undefined && link.endedWatch?.stoppedAt !== undefined,
  );
  if (stopped.length === 0) return [];
  const compactionMessageIds = input.compactionMessageIds();
  if (compactionMessageIds.has(input.run.userMessageId)) return [];
  const completedAttemptIds = new Set(
    input.providerTurns
      .filter((turn) => turn.status === "completed")
      .map((turn) => turn.runAttemptId),
  );
  const runsById = new Map(input.runs.map((run) => [run.id, run]));
  // A steer's replacement attempt of this run must not repeat what its first attempt delivered.
  const deliveredStarts = input.attempts.flatMap((attempt) => {
    const run = runsById.get(attempt.runId);
    return attempt.id !== input.run.activeAttemptId &&
      completedAttemptIds.has(attempt.id) &&
      run !== undefined &&
      run.status !== "rolled_back" &&
      attempt.startedAt !== null &&
      !compactionMessageIds.has(run.userMessageId)
      ? [DateTime.toEpochMillis(attempt.startedAt)]
      : [];
  });
  return stopped.filter((link) => {
    const stoppedAt = Date.parse(link.endedWatch!.stoppedAt!);
    return !deliveredStarts.some((startedAt) => startedAt >= stoppedAt);
  });
}

/** Names every pending pull request, since delivery covers all of them; empty when none is pending. */
export function stoppedWatchNote(links: ReadonlyArray<ThreadPullRequestLink>): string {
  if (links.length === 0) return "";
  return [
    "Note: the user pressed Stop, which also ended T3 Code's watch on these pull requests. They no longer wake you. Call watch_pull_request again only if the user's request still needs it:",
    ...links.map((link) => `- #${link.number} ${link.url}`),
  ].join("\n");
}

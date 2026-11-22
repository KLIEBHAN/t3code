import type {
  PullRequestActivity,
  PullRequestCheck,
  PullRequestComment,
  PullRequestDetail,
  PullRequestMergeability,
  ThreadPullRequestWatch,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { evaluatePullRequestWatch, snippet } from "../orchestration-v2/pullRequestWatch.ts";

/** Epoch fallback when a complete initial activity read observed zero non-own remarks. */
export const EPOCH_ISO = "1970-01-01T00:00:00.000Z";
const MAX_SNAPSHOT_REMARKS = 5;

export interface WatchPullRequestCheckSummary {
  readonly passed: number;
  readonly pending: number;
  readonly failed: ReadonlyArray<string>;
  readonly incomplete?: true;
}

export interface WatchPullRequestRemarkSummary {
  readonly author: string | null;
  readonly createdAt: string;
  readonly reviewState: string | null;
  readonly snippet: string;
  readonly url: string | null;
}

export interface WatchPullRequestSnapshot {
  readonly headSha?: string | null;
  readonly checks?: WatchPullRequestCheckSummary;
  readonly mergeability?: PullRequestMergeability;
  readonly rebaseRequired?: true;
  readonly unresolvedThreads?: number;
  readonly latestRemarks?: ReadonlyArray<WatchPullRequestRemarkSummary>;
  readonly next?: string;
}

export interface SeededPullRequestWatch {
  readonly initialWatch: ThreadPullRequestWatch;
  readonly snapshot: WatchPullRequestSnapshot;
}

/** Floor an epoch millisecond timestamp to whole seconds (matching host comment precision). */
export function floorWholeSecondIso(ms: number): string {
  return DateTime.formatIso(DateTime.makeUnsafe(Math.floor(ms / 1000) * 1000));
}

const activeAt = (remark: PullRequestComment) => remark.editedAt ?? remark.createdAt;

function summarizeChecks(checks: ReadonlyArray<PullRequestCheck>): WatchPullRequestCheckSummary {
  let passed = 0;
  let pending = 0;
  let incomplete = false;
  const failed: Array<string> = [];
  for (const check of checks) {
    if (check.placeholder === true) incomplete = true;
    else if (check.status === "failure" || check.status === "cancelled") failed.push(check.name);
    else if (check.status === "pending" || check.status === "action-required") pending += 1;
    else passed += 1;
  }
  return { passed, pending, failed, ...(incomplete ? { incomplete: true as const } : {}) };
}

function summarizeRemark(remark: PullRequestComment): WatchPullRequestRemarkSummary {
  const body = snippet(remark.body);
  return {
    author: remark.author?.login ?? null,
    createdAt: remark.createdAt,
    reviewState: remark.reviewState,
    snippet: body.length === 0 ? (remark.reviewState ?? "reviewed") : body,
    url: remark.url,
  };
}

function seedRemarksWatermark(
  nonOwnRemarks: ReadonlyArray<PullRequestComment>,
  activityComplete: boolean,
  nowMs: number,
): { readonly remarksThrough: string; readonly remarkIds: ReadonlyArray<string> } {
  if (!activityComplete) {
    return { remarksThrough: floorWholeSecondIso(nowMs), remarkIds: [] };
  }
  if (nonOwnRemarks.length === 0) {
    return { remarksThrough: EPOCH_ISO, remarkIds: [] };
  }
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const remark of nonOwnRemarks) {
    const at = Date.parse(activeAt(remark));
    if (Number.isFinite(at) && at > latestMs) latestMs = at;
  }
  if (!Number.isFinite(latestMs)) {
    return { remarksThrough: floorWholeSecondIso(nowMs), remarkIds: [] };
  }
  const atLatest = nonOwnRemarks.filter((remark) => Date.parse(activeAt(remark)) === latestMs);
  return {
    remarksThrough: activeAt(atLatest[0]!),
    remarkIds: [...new Set(atLatest.map((remark) => remark.id))],
  };
}

/**
 * Seeds a watch's initial baseline and caller snapshot from a fresh PR detail and optional
 * activity read so checks or reviews that finished before `watch_pull_request` are never missed.
 */
export function seedPullRequestWatch(input: {
  readonly detail: PullRequestDetail;
  readonly activity: PullRequestActivity | undefined;
  readonly endedWatch: ThreadPullRequestWatch | undefined;
  readonly nowMs: number;
}): SeededPullRequestWatch {
  const { detail, activity, endedWatch, nowMs } = input;
  const startedAt = DateTime.formatIso(DateTime.makeUnsafe(nowMs));
  const own = (detail.viewer ?? detail.author?.login)?.toLowerCase();
  const activityComplete =
    activity !== undefined &&
    !(activity.commentsTruncated && activity.reviewThreadsTruncated !== false) &&
    !activity.reviewThreads.some((thread) => thread.nextCommentsCursor != null);
  const nonOwnRemarks = (activity?.comments ?? []).filter(
    (remark) => remark.author?.login.toLowerCase() !== own,
  );
  const { remarksThrough, remarkIds } = seedRemarksWatermark(
    nonOwnRemarks,
    activityComplete,
    nowMs,
  );

  const baseWatch: ThreadPullRequestWatch = {
    startedAt,
    headSha: null,
    failedChecks: [],
    passed: false,
    passedChecks: [],
    remarksThrough,
    remarkIds,
    conflicting: false,
    wakes: 0,
    awaitingBaseline: "all",
  };
  let initialWatch: ThreadPullRequestWatch = {
    ...evaluatePullRequestWatch(baseWatch, detail, null, nowMs).next,
    wakes: 0,
  };

  const realChecks = detail.checks.filter((check) => check.placeholder !== true);
  // Keep a finished no-checks timeout from an earlier watch on the same head.
  if (
    realChecks.length === 0 &&
    endedWatch !== undefined &&
    endedWatch.headSha === (detail.headSha ?? null) &&
    endedWatch.checksAwaitedSince === null
  ) {
    initialWatch = {
      ...initialWatch,
      checksAwaitedSince: null,
      checksPending: false,
    };
  }

  const checks = summarizeChecks(detail.checks);
  const runningCount = realChecks.filter((check) => check.status === "pending").length;
  const awaitingApprovalCount = realChecks.filter(
    (check) => check.status === "action-required",
  ).length;
  const unresolvedThreads =
    activity === undefined
      ? 0
      : activity.reviewThreads.filter((thread) => !thread.isResolved).length;

  const latestRemarks =
    nonOwnRemarks.length === 0
      ? undefined
      : [...nonOwnRemarks]
          .toSorted((left, right) => {
            const diff = Date.parse(activeAt(left)) - Date.parse(activeAt(right));
            return Number.isFinite(diff) && diff !== 0
              ? diff
              : left.createdAt.localeCompare(right.createdAt);
          })
          .slice(-MAX_SNAPSHOT_REMARKS)
          .map(summarizeRemark);

  const clauses: Array<string> = [];
  if (checks.failed.length > 0) {
    const unit = checks.failed.length === 1 ? "check" : "checks";
    clauses.push(
      runningCount > 0
        ? `${checks.failed.length} failing ${unit} (${runningCount} still pending)`
        : `${checks.failed.length} failing ${unit}`,
    );
  } else if (awaitingApprovalCount > 0) {
    clauses.push(
      `${awaitingApprovalCount} ${awaitingApprovalCount === 1 ? "check awaits" : "checks await"} approval`,
    );
  } else if (initialWatch.passed && checks.incomplete !== true) {
    if (runningCount > 0) {
      const reqCount = initialWatch.passedChecks.length;
      clauses.push(
        `all ${reqCount} required ${reqCount === 1 ? "check" : "checks"} passed (${runningCount} other still pending)`,
      );
    } else if (realChecks.length > 0) {
      clauses.push(
        `all ${realChecks.length} ${realChecks.length === 1 ? "check" : "checks"} passed`,
      );
    }
  }
  if (detail.mergeability === "conflicting") clauses.push("branch conflicts with base");
  if (detail.rebaseRequired === true) clauses.push("rebase required");
  if (nonOwnRemarks.length > 0) {
    clauses.push(
      `${nonOwnRemarks.length} existing ${nonOwnRemarks.length === 1 ? "remark" : "remarks"}`,
    );
  }
  if (unresolvedThreads > 0) {
    clauses.push(
      `${unresolvedThreads} unresolved ${unresolvedThreads === 1 ? "thread" : "threads"}`,
    );
  }

  const next =
    clauses.length === 0
      ? undefined
      : `Current state recorded as baseline (will not trigger a later wake): ${clauses.join("; ")}. Act on this now if ready (call unwatch_pull_request before handing back), or end your turn only if still waiting on a later change.`;

  return {
    initialWatch,
    snapshot: {
      headSha: detail.headSha ?? null,
      checks,
      mergeability: detail.mergeability,
      ...(detail.rebaseRequired === true ? { rebaseRequired: true as const } : {}),
      ...(unresolvedThreads > 0 ? { unresolvedThreads } : {}),
      ...(latestRemarks !== undefined ? { latestRemarks } : {}),
      ...(next !== undefined ? { next } : {}),
    },
  };
}

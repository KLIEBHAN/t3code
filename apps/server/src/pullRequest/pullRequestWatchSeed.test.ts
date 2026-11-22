import {
  ProjectId,
  SourceControlProviderKind,
  type PullRequestActivity,
  type PullRequestCheck,
  type PullRequestComment,
  type PullRequestDetail,
  type ThreadPullRequestWatch,
} from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { WatchPullRequestResult } from "../mcp/toolkits/pullRequests/tools.ts";
import { EPOCH_ISO, floorWholeSecondIso, seedPullRequestWatch } from "./pullRequestWatchSeed.ts";

const NOW_MS = Date.parse("2026-11-22T17:45:43.821Z");
const decodeWatchPullRequestResult = Schema.decodeUnknownSync(WatchPullRequestResult);

const makeDetail = (overrides: Partial<PullRequestDetail> = {}): PullRequestDetail => ({
  provider: SourceControlProviderKind.make("forgejo"),
  capabilities: {
    diff: true,
    comment: true,
    actions: ["merge", "close"],
    mergeMethods: ["merge"],
    search: false,
    checksAlwaysReport: false,
    review: { inlineComment: true, reply: true, resolve: true, verdicts: ["approve", "comment"] },
    reviewers: { request: true, listCandidates: false },
  },
  viewerPermissions: {
    actions: ["merge", "close"],
    comment: true,
    resolve: true,
    verdicts: ["approve", "comment"],
    requestReviewers: true,
  },
  projectId: ProjectId.make("project-1"),
  projectTitle: "docker-proxy",
  workspaceRoot: "/workspace/docker-proxy",
  repository: "fabi/docker-proxy",
  number: 39,
  title: "PR 39",
  body: "",
  url: "https://forgejo.internal/fabi/docker-proxy/pulls/39",
  author: { login: "fabi", name: "Fabi", avatarUrl: null },
  state: "open",
  isDraft: false,
  mergeability: "mergeable",
  additions: 1,
  deletions: 0,
  changedFiles: 1,
  headBranch: "feat/job-id",
  headSha: "e7cf68c111",
  baseBranch: "main",
  createdAt: "2026-11-22T17:44:00Z",
  updatedAt: "2026-11-22T17:45:43Z",
  mergedAt: null,
  closedAt: null,
  reviewers: [],
  labels: [],
  checks: [],
  mergeCapabilities: { merge: true, squash: false, rebase: false },
  viewer: "fabi",
  ...overrides,
});

const comment = (
  id: string,
  login: string,
  createdAt: string,
  body: string,
  overrides: Partial<PullRequestComment> = {},
): PullRequestComment => ({
  id,
  kind: "issue-comment",
  author: { login, name: null, avatarUrl: null },
  body,
  createdAt,
  url: `https://forgejo.internal/fabi/docker-proxy/pulls/39#issuecomment-${id}`,
  path: null,
  reviewState: null,
  ...overrides,
});

const check = (
  name: string,
  status: PullRequestCheck["status"],
  overrides: Partial<PullRequestCheck> = {},
): PullRequestCheck => ({
  name,
  status,
  description: null,
  url: null,
  ...overrides,
});

const emptyActivity: PullRequestActivity = {
  comments: [],
  commentCount: 0,
  commentsTruncated: false,
  reviewThreads: [],
  commits: [],
};

describe("seedPullRequestWatch", () => {
  it("floors timestamps to whole seconds", () => {
    assert.equal(floorWholeSecondIso(NOW_MS), "2026-11-22T17:45:43.000Z");
  });

  it("seeds epoch watermark and omits next when checks are pending with no non-own remarks", () => {
    const seeded = seedPullRequestWatch({
      detail: makeDetail({ checks: [check("pytest", "pending", { required: true })] }),
      activity: {
        ...emptyActivity,
        comments: [comment("1", "fabi", "2026-11-22T17:45:00Z", "Self note")],
        commentCount: 1,
      },
      endedWatch: undefined,
      nowMs: NOW_MS,
    });

    assert.equal(seeded.initialWatch.remarksThrough, EPOCH_ISO);
    assert.deepEqual(seeded.initialWatch.remarkIds, []);
    assert.isTrue(seeded.initialWatch.checksPending);
    assert.isUndefined(seeded.initialWatch.awaitingBaseline);
    assert.deepEqual(seeded.snapshot.checks, { passed: 0, pending: 1, failed: [] });
    assert.isUndefined(seeded.snapshot.latestRemarks);
    assert.isUndefined(seeded.snapshot.next);
  });

  it("summarizes latest 5 non-own remarks, strips markup, and encodes cleanly as WatchPullRequestResult", () => {
    const comments = [1, 2, 3, 4, 5, 6].map((index) =>
      comment(
        String(index),
        `bot-${index}`,
        `2026-11-22T17:45:0${index}Z`,
        index === 6 ? "<!-- hidden --><b>Clean</b> approval" : index === 5 ? "" : `Note ${index}`,
        index === 5 ? { kind: "review", reviewState: "approved" } : {},
      ),
    );
    const seeded = seedPullRequestWatch({
      detail: makeDetail({
        checks: [check("pytest", "success", { required: true })],
        mergeability: "conflicting",
        rebaseRequired: true,
      }),
      activity: {
        ...emptyActivity,
        comments,
        commentCount: comments.length,
        reviewThreads: [
          {
            id: "thread-1",
            path: "src/app.ts",
            line: 10,
            side: "right",
            isResolved: false,
            isOutdated: false,
            comments: [],
          },
          {
            id: "thread-2",
            path: "src/app.ts",
            line: 20,
            side: "right",
            isResolved: true,
            isOutdated: false,
            comments: [],
          },
        ],
      },
      endedWatch: undefined,
      nowMs: NOW_MS,
    });

    assert.equal(seeded.initialWatch.remarksThrough, "2026-11-22T17:45:06Z");
    assert.deepEqual(seeded.initialWatch.remarkIds, ["6"]);
    assert.equal(seeded.snapshot.unresolvedThreads, 1);
    assert.equal(seeded.snapshot.rebaseRequired, true);
    assert.lengthOf(seeded.snapshot.latestRemarks ?? [], 5);
    assert.equal(seeded.snapshot.latestRemarks?.[3]?.snippet, "approved");
    assert.equal(seeded.snapshot.latestRemarks?.[4]?.snippet, "Clean approval");
    assert.include(seeded.snapshot.next ?? "", "all 1 check passed");
    assert.include(seeded.snapshot.next ?? "", "branch conflicts with base");
    assert.include(seeded.snapshot.next ?? "", "rebase required");
    assert.include(seeded.snapshot.next ?? "", "6 existing remarks");
    assert.include(seeded.snapshot.next ?? "", "1 unresolved thread");

    const decoded = decodeWatchPullRequestResult({
      host: "forgejo.internal",
      repository: "fabi/docker-proxy",
      number: 39,
      url: "https://forgejo.internal/fabi/docker-proxy/pulls/39",
      watching: true,
      wasWatching: false,
      ...seeded.snapshot,
    });
    assert.equal(decoded.headSha, "e7cf68c111");
  });

  it("reports failing checks, approval-gated checks, and required-pass with pending advisory checks", () => {
    const failing = seedPullRequestWatch({
      detail: makeDetail({
        checks: [check("lint", "failure"), check("e2e", "pending")],
      }),
      activity: emptyActivity,
      endedWatch: undefined,
      nowMs: NOW_MS,
    });
    assert.include(failing.snapshot.next ?? "", "1 failing check (1 still pending)");
    assert.deepEqual(failing.initialWatch.owedChecks, ["lint"]);

    const gated = seedPullRequestWatch({
      detail: makeDetail({
        checks: [
          check("CI", "action-required", { url: "https://github.com/o/r/actions/runs/9/job/1" }),
        ],
      }),
      activity: emptyActivity,
      endedWatch: undefined,
      nowMs: NOW_MS,
    });
    assert.include(gated.snapshot.next ?? "", "1 check awaits approval");
    assert.isFalse(gated.initialWatch.checksPending);

    const requiredEarly = seedPullRequestWatch({
      detail: makeDetail({
        checks: [
          check("lint", "success", { required: true }),
          check("e2e", "pending", { required: false }),
        ],
      }),
      activity: emptyActivity,
      endedWatch: undefined,
      nowMs: NOW_MS,
    });
    assert.include(
      requiredEarly.snapshot.next ?? "",
      "all 1 required check passed (1 other still pending)",
    );
    assert.deepEqual(requiredEarly.initialWatch.owedChecks, ["e2e"]);
  });

  it("falls back to floored nowMs when activity is missing, truncated, or paginated", () => {
    for (const activity of [
      undefined,
      { ...emptyActivity, commentsTruncated: true },
      {
        ...emptyActivity,
        reviewThreads: [
          {
            id: "t1",
            path: "a.ts",
            line: 1,
            side: "right" as const,
            isResolved: false,
            isOutdated: false,
            comments: [],
            nextCommentsCursor: "cursor-2",
          },
        ],
      },
    ]) {
      const seeded = seedPullRequestWatch({
        detail: makeDetail({ checks: [check("ci", "pending")] }),
        activity,
        endedWatch: undefined,
        nowMs: NOW_MS,
      });
      assert.equal(seeded.initialWatch.remarksThrough, "2026-11-22T17:45:43.000Z");
      assert.deepEqual(seeded.initialWatch.remarkIds, []);
    }
  });

  it("preserves a finished no-checks timeout only when endedWatch completed a no-checks wait and checks are complete", () => {
    const timedOutWatch: ThreadPullRequestWatch = {
      startedAt: "2026-11-22T17:00:00.000Z",
      headSha: "e7cf68c111",
      failedChecks: [],
      passed: false,
      passedChecks: [],
      remarksThrough: "2026-11-22T17:00:00.000Z",
      remarkIds: [],
      conflicting: false,
      wakes: 0,
      checksAwaitedSince: null,
      checksPending: false,
    };
    const timedOutSeeded = seedPullRequestWatch({
      detail: makeDetail({ headSha: "e7cf68c111", checks: [] }),
      activity: emptyActivity,
      endedWatch: timedOutWatch,
      nowMs: NOW_MS,
    });
    assert.isNull(timedOutSeeded.initialWatch.checksAwaitedSince);
    assert.isFalse(timedOutSeeded.initialWatch.checksPending);

    // Pending CI followed by a placeholder-only read must keep checksPending true and baseline open.
    const pendingWatch: ThreadPullRequestWatch = {
      ...timedOutWatch,
      checksPending: true,
    };
    const placeholder = check("Workflow approval status", "pending", { placeholder: true });
    const pendingPlaceholder = seedPullRequestWatch({
      detail: makeDetail({ headSha: "e7cf68c111", checks: [placeholder] }),
      activity: emptyActivity,
      endedWatch: pendingWatch,
      nowMs: NOW_MS,
    });
    assert.isTrue(pendingPlaceholder.initialWatch.checksPending);
    assert.equal(pendingPlaceholder.initialWatch.awaitingBaseline, "checks");
    assert.equal(pendingPlaceholder.snapshot.checks?.incomplete, true);

    // Even after a genuine no-checks timeout, a placeholder-only read cannot confirm completion.
    const timedOutPlaceholder = seedPullRequestWatch({
      detail: makeDetail({ headSha: "e7cf68c111", checks: [placeholder] }),
      activity: emptyActivity,
      endedWatch: timedOutWatch,
      nowMs: NOW_MS,
    });
    assert.isTrue(timedOutPlaceholder.initialWatch.checksPending);
    assert.equal(timedOutPlaceholder.initialWatch.awaitingBaseline, "checks");

    // Previously passed checks with a null clock must not be mistaken for a no-checks timeout.
    const passedEmpty = seedPullRequestWatch({
      detail: makeDetail({ headSha: "e7cf68c111", checks: [] }),
      activity: emptyActivity,
      endedWatch: { ...timedOutWatch, passed: true, passedChecks: ["pytest"] },
      nowMs: NOW_MS,
    });
    assert.isTrue(passedEmpty.initialWatch.checksPending);
    assert.isNotNull(passedEmpty.initialWatch.checksAwaitedSince);
  });
});

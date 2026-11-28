import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, expect, it } from "@effect/vitest";
import {
  CommandId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  SourceControlProviderKind,
  ThreadId,
  type OrchestrationProjectShell,
  type PullRequestActivity,
  type PullRequestCheck,
  type PullRequestComment,
  type PullRequestDetail,
  type ThreadPullRequestWatch,
} from "@t3tools/contracts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as PullRequestService from "../pullRequest/PullRequestService.ts";
import * as PullRequestWatchService from "../pullRequest/PullRequestWatchService.ts";
import * as ServerSettings from "../serverSettings.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as CommandReceiptStore from "./CommandReceiptStore.ts";
import * as EffectOutbox from "./EffectOutbox.ts";
import * as EventStore from "./EventStore.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as PullRequestWatchReactor from "./PullRequestWatchReactor.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";
import { evaluatePullRequestWatch } from "./pullRequestWatch.ts";
import * as ProjectionReplay from "./testkit/ProjectionReplay.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";

const instanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId, model: "gpt-5.1-codex" };
const adapter = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("Runs here never reach a provider"),
} as ProviderAdapter.ProviderAdapterV2["Service"];

const PROJECT_ID = ProjectId.make("project:pr-watch-race");

const forgejoProject: OrchestrationProjectShell = {
  id: PROJECT_ID,
  title: "docker-proxy",
  workspaceRoot: "/workspace/docker-proxy",
  defaultModelSelection: null,
  scripts: [],
  repositoryIdentity: {
    canonicalKey: "forgejo.internal/fabi/docker-proxy",
    locator: {
      source: "git-remote",
      remoteName: "origin",
      remoteUrl: "https://forgejo.internal/fabi/docker-proxy.git",
    },
    provider: SourceControlProviderKind.make("forgejo"),
    displayName: "fabi/docker-proxy",
    owner: "fabi",
    name: "docker-proxy",
  },
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};

const makeLayer = () => {
  const layerDatabase = SqlitePersistence.layerMemory;
  const projectionStore = ProjectionStore.layer.pipe(
    Layer.provide(NodeCrypto.layerDigest),
    Layer.provide(layerDatabase),
  );
  const eventStore = EventStore.layer.pipe(Layer.provide(layerDatabase));
  return ThreadManagementService.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        layerDatabase,
        projectionStore,
        eventStore,
        ProjectionReplay.layer.pipe(
          Layer.provide(Layer.mergeAll(layerDatabase, eventStore, projectionStore)),
        ),
        EffectOutbox.layer.pipe(Layer.provide(layerDatabase)),
        ProviderReplayHarness.layerWithRegistry(
          { name: "pr-watch-race" },
          ProviderAdapterRegistry.layerFromAdapters([adapter]),
          { databaseLayer: layerDatabase, runEffectWorker: false },
        ),
      ),
    ),
    Layer.provideMerge(ServerSettings.layerTest()),
    Layer.provideMerge(CommandReceiptStore.layer.pipe(Layer.provide(layerDatabase))),
  );
};

const makeDetail = (overrides: Partial<PullRequestDetail> = {}): PullRequestDetail => ({
  provider: SourceControlProviderKind.make("forgejo"),
  capabilities: {
    diff: true,
    comment: true,
    actions: ["merge", "close"],
    mergeMethods: ["merge", "squash"],
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
  projectId: PROJECT_ID,
  projectTitle: "docker-proxy",
  workspaceRoot: "/workspace/docker-proxy",
  repository: "fabi/docker-proxy",
  number: 39,
  title: "Add X-Lavacrawl-Job-Id correlation",
  body: "Deterministic log matching",
  url: "https://forgejo.internal/fabi/docker-proxy/pulls/39",
  author: { login: "fabi", name: "Fabi", avatarUrl: null },
  state: "open",
  isDraft: false,
  mergeability: "mergeable",
  additions: 10,
  deletions: 2,
  changedFiles: 2,
  headBranch: "feat/job-id",
  headSha: "e7cf68c111111111111111111111111111111111",
  baseBranch: "main",
  createdAt: "2026-11-22T17:44:00Z",
  updatedAt: "2026-11-22T17:45:43Z",
  mergedAt: null,
  closedAt: null,
  reviewers: [],
  labels: [],
  checks: [],
  mergeCapabilities: { merge: true, squash: true, rebase: false },
  viewer: "fabi",
  ...overrides,
});

const makeComment = (
  id: string,
  login: string,
  createdAt: string,
  body: string,
  reviewState: PullRequestComment["reviewState"] = null,
): PullRequestComment => ({
  id,
  kind: reviewState === null ? "issue-comment" : "review",
  author: { login, name: null, avatarUrl: null },
  body,
  createdAt,
  url: `https://forgejo.internal/fabi/docker-proxy/pulls/39#issuecomment-${id}`,
  path: null,
  reviewState,
});

const emptyActivity: PullRequestActivity = {
  comments: [],
  commentCount: 0,
  commentsTruncated: false,
  reviewThreads: [],
  commits: [],
};

const createThread = (threadId: ThreadId) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    yield* orchestrator.dispatch({
      type: "thread.create",
      commandId: CommandId.make(`create:${threadId}`),
      threadId,
      projectId: PROJECT_ID,
      title: threadId,
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdBy: "user",
      creationSource: "web",
    });
  });

const watchTarget = {
  url: "https://forgejo.internal/fabi/docker-proxy/pulls/39",
};

describe("pull request watch race fixes", () => {
  it.effect(
    "Gap 1: watch_pull_request returns already-finished checks and remarks and seeds baseline cleanly",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(Date.parse("2026-11-22T17:45:44.500Z"));
        const threadId = ThreadId.make("race-gap-1");
        yield* createThread(threadId);
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const replay = yield* ProjectionReplay.ProjectionReplay;

        let currentDetail = makeDetail({
          checks: [
            {
              name: "pytest",
              status: "success",
              description: null,
              url: null,
              required: true,
            },
          ],
        });
        let currentActivity: PullRequestActivity = {
          ...emptyActivity,
          comments: [
            makeComment("55823", "forgejo-actions", "2026-11-22T17:45:43Z", "Review looks clean."),
            makeComment(
              "55824",
              "codex-reviewer",
              "2026-11-22T17:45:43Z",
              "Automatische Freigabe",
              "approved",
            ),
          ],
          commentCount: 2,
        };

        const pullRequestLayer = Layer.mock(PullRequestService.PullRequestService)({
          addressedProject: () => Effect.succeed(forgejoProject),
          invalidate: () => Effect.void,
          watchFingerprint: () => Effect.succeed(null),
          summary: () =>
            Effect.sync(() => ({
              projectId: PROJECT_ID,
              provider: SourceControlProviderKind.make("forgejo"),
              host: "forgejo.internal",
              repository: "fabi/docker-proxy",
              number: 39,
              title: currentDetail.title,
              url: currentDetail.url,
              state: currentDetail.state,
              headBranch: currentDetail.headBranch,
              baseBranch: currentDetail.baseBranch,
              updatedAt: currentDetail.updatedAt,
            })),
          detail: () => Effect.sync(() => currentDetail),
          activity: () => Effect.sync(() => currentActivity),
        });

        const serviceLayer = PullRequestWatchService.layer.pipe(
          Layer.provide(Layer.mergeAll(pullRequestLayer, NodeCrypto.layer)),
        );

        const result = yield* PullRequestWatchService.PullRequestWatchService.pipe(
          Effect.flatMap((service) =>
            service.setWatching({
              threadId,
              target: watchTarget,
              watching: true,
              until: "merged",
            }),
          ),
          Effect.provide(serviceLayer),
        );

        expect(result).toMatchObject({
          number: 39,
          watching: true,
          wasWatching: false,
          headSha: currentDetail.headSha,
          checks: { passed: 1, pending: 0, failed: [] },
          mergeability: "mergeable",
        });
        expect("latestRemarks" in result ? result.latestRemarks : undefined).toHaveLength(2);
        expect("next" in result ? result.next : undefined).toEqual(
          expect.stringContaining("baseline"),
        );

        const seededWatch = (yield* orchestrator.getThreadShell(threadId))?.pullRequests?.[0]
          ?.watch;
        assert.isDefined(seededWatch);
        assert.isUndefined(seededWatch?.awaitingBaseline);
        assert.equal(seededWatch?.headSha, currentDetail.headSha);
        assert.isTrue(seededWatch?.passed);
        assert.isFalse(seededWatch?.checksPending);
        assert.equal(seededWatch?.remarksThrough, "2026-11-22T17:45:43Z");
        assert.deepEqual(seededWatch?.remarkIds, ["55823", "55824"]);
        assert.isTrue((yield* replay.rebuild).valid);

        const reactor = yield* PullRequestWatchReactor.make.pipe(
          Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer, pullRequestLayer)),
        );
        // Same state on first sweep produces no duplicate wake.
        yield* reactor.sweep;
        const wakesAfterFirst = (yield* orchestrator.getThreadRecords(threadId, [
          "messages",
        ])).messages.filter((message) => message.notification != null);
        assert.lengthOf(wakesAfterFirst, 0);

        // A third comment stamped in the exact same whole second (different id) still wakes.
        currentActivity = {
          ...currentActivity,
          comments: [
            ...currentActivity.comments,
            makeComment("55825", "reviewer", "2026-11-22T17:45:43Z", "One late nit."),
          ],
          commentCount: 3,
        };
        yield* TestClock.adjust("10 minutes");
        yield* reactor.sweep;
        const wakesAfterSecond = (yield* orchestrator.getThreadRecords(threadId, [
          "messages",
        ])).messages.filter((message) => message.notification != null);
        assert.lengthOf(wakesAfterSecond, 1);
        assert.equal(wakesAfterSecond[0]?.notification?.summary, "#39: new comments");
      }).pipe(Effect.provide(makeLayer())),
  );

  it.effect(
    "Gap 1b: watch started with zero remarks seeds epoch watermark so clock-skewed comments wake",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(Date.parse("2026-11-22T17:45:44.821Z"));
        const threadId = ThreadId.make("race-gap-1b");
        yield* createThread(threadId);
        const orchestrator = yield* Orchestrator.OrchestratorV2;

        let checks: ReadonlyArray<PullRequestCheck> = [
          { name: "pytest", status: "pending", description: null, url: null, required: true },
        ];
        let comments: ReadonlyArray<PullRequestComment> = [];

        const pullRequestLayer = Layer.mock(PullRequestService.PullRequestService)({
          addressedProject: () => Effect.succeed(forgejoProject),
          invalidate: () => Effect.void,
          watchFingerprint: () => Effect.succeed(null),
          summary: () =>
            Effect.sync(() => ({
              projectId: PROJECT_ID,
              provider: SourceControlProviderKind.make("forgejo"),
              host: "forgejo.internal",
              repository: "fabi/docker-proxy",
              number: 39,
              title: "PR 39",
              url: watchTarget.url,
              state: "open",
              headBranch: "feat/job-id",
              baseBranch: "main",
              updatedAt: "2026-11-22T17:45:44Z",
            })),
          detail: () => Effect.sync(() => makeDetail({ checks })),
          activity: () =>
            Effect.sync(() => ({
              ...emptyActivity,
              comments,
              commentCount: comments.length,
            })),
        });

        const serviceLayer = PullRequestWatchService.layer.pipe(
          Layer.provide(Layer.mergeAll(pullRequestLayer, NodeCrypto.layer)),
        );

        const result = yield* PullRequestWatchService.PullRequestWatchService.pipe(
          Effect.flatMap((service) =>
            service.setWatching({ threadId, target: watchTarget, watching: true }),
          ),
          Effect.provide(serviceLayer),
        );
        expect(result).toMatchObject({
          watching: true,
          checks: { passed: 0, pending: 1, failed: [] },
        });
        assert.isUndefined("next" in result ? result.next : undefined);

        const watch = (yield* orchestrator.getThreadShell(threadId))?.pullRequests?.[0]?.watch;
        assert.equal(watch?.remarksThrough, "1970-01-01T00:00:00.000Z");
        assert.isTrue(watch?.checksPending);

        // Host clock is 6s behind local clock when check passes and bot posts review.
        checks = [
          { name: "pytest", status: "success", description: null, url: null, required: true },
        ];
        comments = [
          makeComment("55900", "codex-reviewer", "2026-11-22T17:45:38Z", "Approved", "approved"),
        ];
        const reactor = yield* PullRequestWatchReactor.make.pipe(
          Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer, pullRequestLayer)),
        );
        yield* reactor.sweep;
        const wakes = (yield* orchestrator.getThreadRecords(threadId, [
          "messages",
        ])).messages.filter((message) => message.notification != null);
        assert.lengthOf(wakes, 1);
        assert.equal(wakes[0]?.notification?.summary, "#39: checks passed, new comments");
      }).pipe(Effect.provide(makeLayer())),
  );

  it("Gap 2: evaluatePullRequestWatch reports checks-passed and checks-awaiting-approval on baseline when checksPending is true", () => {
    const baseWatch = (checksPending: boolean): ThreadPullRequestWatch => ({
      startedAt: "2026-11-22T17:45:00.000Z",
      headSha: null,
      failedChecks: [],
      passed: false,
      passedChecks: [],
      remarksThrough: "2026-11-22T17:45:00.000Z",
      remarkIds: [],
      conflicting: false,
      wakes: 0,
      awaitingBaseline: "all",
      checksPending,
    });
    const now = Date.parse("2026-11-22T17:46:00.000Z");

    const green = makeDetail({
      checks: [{ name: "pytest", status: "success", description: null, url: null, required: true }],
    });
    assert.deepEqual(evaluatePullRequestWatch(baseWatch(true), green, [], now).changes, [
      { kind: "checks-passed", count: 1, required: true },
    ]);
    assert.deepEqual(evaluatePullRequestWatch(baseWatch(false), green, [], now).changes, []);

    const gatedCheck: PullRequestCheck = {
      name: "CI",
      status: "action-required",
      description: null,
      url: "https://github.com/o/r/actions/runs/1/job/1",
    };
    const gated = makeDetail({ checks: [gatedCheck] });
    assert.deepEqual(evaluatePullRequestWatch(baseWatch(true), gated, [], now).changes, [
      { kind: "checks-awaiting-approval", checks: [gatedCheck] },
    ]);
    assert.deepEqual(evaluatePullRequestWatch(baseWatch(false), gated, [], now).changes, []);
  });

  it.effect(
    "Gap 3: fallback watch floors remarksThrough to whole seconds so same-second comments wake",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(Date.parse("2026-11-22T17:45:43.821Z"));
        const threadId = ThreadId.make("race-gap-3");
        yield* createThread(threadId);
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        yield* orchestrator.dispatch({
          type: "thread.pull-request.watch",
          commandId: CommandId.make("watch-fallback"),
          threadId,
          host: "forgejo.internal",
          repository: "fabi/docker-proxy",
          number: 39,
          watching: true,
          link: { url: watchTarget.url, source: "agent" },
        });
        const watch = (yield* orchestrator.getThreadShell(threadId))?.pullRequests?.[0]?.watch;
        assert.isDefined(watch);
        assert.equal(watch?.remarksThrough, "2026-11-22T17:45:43.000Z");

        const sameSecond = makeComment("55830", "reviewer", "2026-11-22T17:45:43Z", "Same second!");
        const report = evaluatePullRequestWatch(
          watch!,
          makeDetail(),
          [sameSecond],
          DateTime.toEpochMillis(yield* DateTime.now),
        );
        assert.deepEqual(report.changes, [{ kind: "remarks", remarks: [sameSecond] }]);
      }).pipe(Effect.provide(makeLayer())),
  );

  it.effect(
    "Gap 4: hosts without fingerprints read activity when checksDue triggers after checks-reopen",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(Date.parse("2026-11-22T17:40:00.000Z"));
        const threadId = ThreadId.make("race-gap-4");
        yield* createThread(threadId);
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        yield* orchestrator.dispatch({
          type: "thread.pull-request.watch",
          commandId: CommandId.make("watch-gap-4"),
          threadId,
          host: "forgejo.internal",
          repository: "fabi/docker-proxy",
          number: 39,
          watching: true,
          link: { url: watchTarget.url, source: "agent" },
        });

        let headSha = "1111111111111111111111111111111111111111";
        let checks: ReadonlyArray<PullRequestCheck> = [
          { name: "pytest", status: "success", description: null, url: null, required: true },
        ];
        let comments: ReadonlyArray<PullRequestComment> = [];

        const pullRequestLayer = Layer.mock(PullRequestService.PullRequestService)({
          invalidate: () => Effect.void,
          watchFingerprint: () => Effect.succeed(null),
          detail: () => Effect.sync(() => makeDetail({ headSha, checks })),
          activity: () =>
            Effect.sync(() => ({
              ...emptyActivity,
              comments,
              commentCount: comments.length,
            })),
        });

        const reactor = yield* PullRequestWatchReactor.make.pipe(
          Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer, pullRequestLayer)),
        );
        // Baseline sweep records quiet state (`inFlight: false`, `checksPending: false`).
        yield* reactor.sweep;
        assert.isFalse(
          (yield* orchestrator.getThreadShell(threadId))?.pullRequests?.[0]?.watch?.checksPending,
        );

        // New push triggers checks-reopen (`checksPending: undefined`), CI passes and AI reviews land.
        yield* orchestrator.dispatch({
          type: "thread.pull-request-watch.checks-reopen",
          commandId: CommandId.make("reopen-gap-4"),
          threadId,
        });
        yield* TestClock.adjust("1 minute");
        headSha = "e7cf68c111111111111111111111111111111111";
        checks = [
          { name: "pytest", status: "success", description: null, url: null, required: true },
        ];
        comments = [
          makeComment("55823", "forgejo-actions", "2026-11-22T17:40:43Z", "Clean review."),
          makeComment("55824", "codex-reviewer", "2026-11-22T17:40:44Z", "Approved", "approved"),
        ];

        // Sweep runs well before QUIET_REREAD_MS (10 min): must fetch activity too!
        yield* reactor.sweep;
        const wakes = (yield* orchestrator.getThreadRecords(threadId, [
          "messages",
        ])).messages.filter((message) => message.notification != null);
        assert.lengthOf(wakes, 1);
        assert.equal(wakes[0]?.notification?.summary, "#39: checks passed, new comments");
      }).pipe(Effect.provide(makeLayer())),
  );
});

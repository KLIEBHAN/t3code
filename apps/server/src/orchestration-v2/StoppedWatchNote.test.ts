import { assert, it } from "@effect/vitest";
import {
  MessageId,
  RunAttemptId,
  RunId,
  type OrchestrationV2Run,
  type ThreadPullRequestLink,
  type ThreadPullRequestWatch,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { pendingStoppedWatches, stoppedWatchNote } from "./StoppedWatchNote.ts";

const STOPPED_AT = "2026-11-19T23:44:22.000Z";
const at = (iso: string) => DateTime.makeUnsafe(iso);

const watchState: ThreadPullRequestWatch = {
  startedAt: "2026-11-19T23:41:30.000Z",
  headSha: null,
  failedChecks: [],
  passed: false,
  passedChecks: [],
  remarksThrough: "2026-11-19T23:41:30.000Z",
  remarkIds: [],
  conflicting: false,
  wakes: 0,
};

const link = (number: number, extra: Partial<ThreadPullRequestLink> = {}): ThreadPullRequestLink =>
  ({
    host: "github.com",
    repository: "acme/app",
    number,
    url: `https://github.com/acme/app/pull/${number}`,
    source: "agent",
    linkedAt: "2026-11-19T23:41:30.000Z",
    snapshot: null,
    stack: null,
    endedWatch: { ...watchState, stoppedAt: STOPPED_AT },
    ...extra,
  }) as ThreadPullRequestLink;

const run = (ordinal: number, startedAt: string, extra: Partial<OrchestrationV2Run> = {}) =>
  ({
    id: RunId.make(`run:${ordinal}`),
    userMessageId: MessageId.make(`message:${ordinal}`),
    activeAttemptId: RunAttemptId.make(`attempt:${ordinal}`),
    status: "completed",
    startedAt: at(startedAt),
    ...extra,
  }) as OrchestrationV2Run;

const pending = (input: {
  readonly pullRequests: ReadonlyArray<ThreadPullRequestLink>;
  readonly runs: ReadonlyArray<OrchestrationV2Run>;
  readonly completed?: ReadonlyArray<OrchestrationV2Run>;
  readonly compactions?: ReadonlyArray<OrchestrationV2Run>;
}) =>
  pendingStoppedWatches({
    pullRequests: input.pullRequests,
    run: input.runs.at(-1)!,
    runs: input.runs,
    attempts: input.runs.map((source) => ({
      id: source.activeAttemptId!,
      runId: source.id,
      startedAt: source.startedAt,
    })),
    providerTurns: (input.completed ?? []).map((source) => ({
      runAttemptId: source.activeAttemptId!,
      status: "completed" as const,
    })),
    compactionMessageIds: () =>
      new Set((input.compactions ?? []).map((source) => source.userMessageId)),
  }).map((entry) => entry.number);

it("tells the first prompted turn after Stop which watches it ended, and only that turn", () => {
  const stopped = run(2, "2026-11-19T23:44:04.000Z", { status: "interrupted" });
  const next = run(3, "2026-11-19T23:44:25.000Z");
  const later = run(4, "2026-11-19T23:50:00.000Z");

  assert.deepEqual(pending({ pullRequests: [link(66)], runs: [stopped, next] }), [66]);
  // Delivered once the turn that carried it completed.
  assert.deepEqual(
    pending({ pullRequests: [link(66)], runs: [stopped, next, later], completed: [next] }),
    [],
  );
  // A turn that started in the same millisecond as Stop carried it too.
  const sameInstant = run(3, STOPPED_AT);
  assert.deepEqual(
    pending({
      pullRequests: [link(66)],
      runs: [stopped, sameInstant, later],
      completed: [sameInstant],
    }),
    [],
  );
  // A turn that started after Stop but never completed has not delivered it.
  assert.deepEqual(
    pending({
      pullRequests: [link(66)],
      runs: [stopped, { ...next, status: "interrupted" }, later],
    }),
    [66],
  );
  // Turns that completed before Stop say nothing about it.
  const before = run(1, "2026-11-19T23:30:00.000Z");
  assert.deepEqual(
    pending({ pullRequests: [link(66)], runs: [before, stopped, next], completed: [before] }),
    [66],
  );
});

it("drops the note when the pull request is watched again, unlinked, or ended another way", () => {
  const next = run(3, "2026-11-19T23:44:25.000Z");
  const rewatched = link(66, { watch: watchState, endedWatch: undefined });
  const endedByMerge = link(67, { endedWatch: watchState });
  const dismissed = link(68, { source: "stack-dismissed" });

  assert.deepEqual(
    pending({ pullRequests: [rewatched, endedByMerge, dismissed], runs: [next] }),
    [],
  );
  assert.deepEqual(pending({ pullRequests: [], runs: [next] }), []);
});

it("keeps the note away from compactions and goal commands, which do not count as delivery", () => {
  const compaction = run(3, "2026-11-19T23:44:25.000Z");
  const next = run(4, "2026-11-19T23:45:00.000Z");

  assert.deepEqual(
    pending({ pullRequests: [link(66)], runs: [compaction], compactions: [compaction] }),
    [],
  );
  assert.deepEqual(
    pending({
      pullRequests: [link(66)],
      runs: [compaction, next],
      completed: [compaction],
      compactions: [compaction],
    }),
    [66],
  );
});

it("does not repeat the note in a steer's replacement attempt of the same run", () => {
  const next = run(3, "2026-11-19T23:44:25.000Z");
  const replaced = { ...next, activeAttemptId: RunAttemptId.make("attempt:3b") };
  const result = pendingStoppedWatches({
    pullRequests: [link(66)],
    run: replaced,
    runs: [replaced],
    attempts: [
      { id: RunAttemptId.make("attempt:3"), runId: next.id, startedAt: next.startedAt },
      { id: RunAttemptId.make("attempt:3b"), runId: next.id, startedAt: next.startedAt },
    ],
    providerTurns: [{ runAttemptId: RunAttemptId.make("attempt:3"), status: "completed" }],
    compactionMessageIds: () => new Set(),
  });

  assert.deepEqual(result, []);
});

it("names every pending pull request, since delivery covers all of them", () => {
  assert.equal(stoppedWatchNote([]), "");
  const note = stoppedWatchNote(Array.from({ length: 12 }, (_, index) => link(index + 1)));
  assert.include(note, "- #1 https://github.com/acme/app/pull/1");
  assert.include(note, "- #12 https://github.com/acme/app/pull/12");
});

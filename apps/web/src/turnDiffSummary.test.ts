import { CheckpointRef, TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";
import type { TurnDiffSummary } from "./types";
import {
  buildTurnDiffSummaryByCheckpointTurnCount,
  hasTurnDiffFallbackPatch,
  isTurnDiffNavigable,
  isTurnDiffOpenable,
  resolveCheckpointTurnCount,
} from "./turnDiffSummary";

function makeSummary(overrides: Partial<TurnDiffSummary> = {}): TurnDiffSummary {
  return {
    turnId: TurnId.makeUnsafe("turn-1"),
    completedAt: "2026-03-08T12:00:00.000Z",
    files: [{ path: "src/app.ts" }],
    ...overrides,
  };
}

describe("turnDiffSummary", () => {
  it("resolves checkpoint turn counts from explicit summary metadata", () => {
    const summary = makeSummary({ checkpointTurnCount: 4 });

    expect(resolveCheckpointTurnCount(summary, {})).toBe(4);
  });

  it("falls back to inferred checkpoint turn counts by turn id", () => {
    const turnId = TurnId.makeUnsafe("turn-2");
    const summary = makeSummary({ turnId });

    expect(resolveCheckpointTurnCount(summary, { [turnId]: 7 })).toBe(7);
  });

  it("treats diffs without checkpoint refs as unavailable", () => {
    const summary = makeSummary({ checkpointTurnCount: 3 });

    expect(isTurnDiffNavigable(summary, new Map(), {})).toBe(false);
  });

  it("treats the first diff with a checkpoint ref as navigable", () => {
    const summary = makeSummary({
      checkpointRef: CheckpointRef.makeUnsafe("refs/t3/checkpoints/thread-1/turn/1"),
      checkpointTurnCount: 1,
    });

    expect(isTurnDiffNavigable(summary, new Map(), {})).toBe(true);
  });

  it("treats diffs with missing previous checkpoints as unavailable", () => {
    const summary = makeSummary({
      checkpointRef: CheckpointRef.makeUnsafe("refs/t3/checkpoints/thread-1/turn/3"),
      checkpointTurnCount: 3,
    });

    expect(isTurnDiffNavigable(summary, new Map(), {})).toBe(false);
  });

  it("treats diffs with checkpoint refs and intact history as navigable", () => {
    const previousSummary = makeSummary({
      turnId: TurnId.makeUnsafe("turn-2"),
      checkpointRef: CheckpointRef.makeUnsafe("refs/t3/checkpoints/thread-1/turn/2"),
      checkpointTurnCount: 2,
    });
    const summary = makeSummary({
      turnId: TurnId.makeUnsafe("turn-3"),
      checkpointRef: CheckpointRef.makeUnsafe("refs/t3/checkpoints/thread-1/turn/3"),
      checkpointTurnCount: 3,
    });
    const byTurnCount = buildTurnDiffSummaryByCheckpointTurnCount([previousSummary, summary], {});

    expect(isTurnDiffNavigable(summary, byTurnCount, {})).toBe(true);
  });

  it("treats provider unified diffs as openable without checkpoint history", () => {
    const summary = makeSummary({
      turnId: TurnId.makeUnsafe("turn-provider-diff"),
      unifiedDiff: "diff --git a/file.ts b/file.ts\n+hello\n",
    });

    expect(hasTurnDiffFallbackPatch(summary)).toBe(true);
    expect(isTurnDiffOpenable(summary, new Map(), {})).toBe(true);
  });
});

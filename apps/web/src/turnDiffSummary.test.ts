import { CheckpointRef, TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";
import type { TurnDiffSummary } from "./types";
import { isTurnDiffNavigable, resolveCheckpointTurnCount } from "./turnDiffSummary";

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

    expect(isTurnDiffNavigable(summary, {})).toBe(false);
  });

  it("treats diffs with checkpoint refs and turn counts as navigable", () => {
    const summary = makeSummary({
      checkpointRef: CheckpointRef.makeUnsafe("refs/t3/checkpoints/thread-1/turn/3"),
      checkpointTurnCount: 3,
    });

    expect(isTurnDiffNavigable(summary, {})).toBe(true);
  });
});

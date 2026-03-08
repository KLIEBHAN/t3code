import { TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import type { TurnDiffSummary } from "./types";
import { findWorkLogFileStat } from "./workLogFileStats";

function makeSummary(files: TurnDiffSummary["files"]): TurnDiffSummary {
  return {
    turnId: TurnId.makeUnsafe("turn-1"),
    completedAt: "2026-03-08T12:00:00.000Z",
    files,
  };
}

describe("findWorkLogFileStat", () => {
  it("returns stats for an exact file-path match", () => {
    const stat = findWorkLogFileStat(
      makeSummary([{ path: "apps/web/src/components/ChatView.tsx", additions: 12, deletions: 4 }]),
      "apps/web/src/components/ChatView.tsx",
    );

    expect(stat).toEqual({ additions: 12, deletions: 4 });
  });

  it("matches an absolute work-log path against a relative checkpoint path", () => {
    const stat = findWorkLogFileStat(
      makeSummary([{ path: "apps/web/src/components/ChatView.tsx", additions: 7, deletions: 1 }]),
      "/Users/fabi/Documents/workspace/t3code/apps/web/src/components/ChatView.tsx",
    );

    expect(stat).toEqual({ additions: 7, deletions: 1 });
  });

  it("returns null when suffix matching would be ambiguous", () => {
    const stat = findWorkLogFileStat(
      makeSummary([
        { path: "apps/web/src/components/ChatView.tsx", additions: 7, deletions: 1 },
        { path: "packages/ui/src/components/ChatView.tsx", additions: 3, deletions: 2 },
      ]),
      "/Users/fabi/Documents/workspace/t3code/ChatView.tsx",
    );

    expect(stat).toBeNull();
  });

  it("returns null when the diff file has no numeric stats", () => {
    const stat = findWorkLogFileStat(
      makeSummary([{ path: "apps/web/src/components/ChatView.tsx" }]),
      "apps/web/src/components/ChatView.tsx",
    );

    expect(stat).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import {
  INITIAL_TURN_SCOPED_COLLAPSE_STATE,
  setTurnScopedCollapsed,
  syncTurnScopedCollapseState,
} from "./turnScopedCollapseState";

describe("turnScopedCollapseState", () => {
  it("opens state for a new turn", () => {
    expect(
      syncTurnScopedCollapseState(
        {
          turnId: "turn-old",
          collapsed: true,
        },
        "turn-new",
      ),
    ).toEqual({
      turnId: "turn-new",
      collapsed: false,
    });
  });

  it("preserves collapsed state for the same turn", () => {
    const current = {
      turnId: "turn-1",
      collapsed: true,
    };

    expect(syncTurnScopedCollapseState(current, "turn-1")).toBe(current);
  });

  it("clears state when there is no active turn", () => {
    expect(
      syncTurnScopedCollapseState(
        {
          turnId: "turn-1",
          collapsed: true,
        },
        null,
      ),
    ).toEqual(INITIAL_TURN_SCOPED_COLLAPSE_STATE);
  });

  it("toggles collapsed state for the current turn", () => {
    const expanded = setTurnScopedCollapsed(INITIAL_TURN_SCOPED_COLLAPSE_STATE, "turn-1", false);

    expect(setTurnScopedCollapsed(expanded, "turn-1", true)).toEqual({
      turnId: "turn-1",
      collapsed: true,
    });
  });
});

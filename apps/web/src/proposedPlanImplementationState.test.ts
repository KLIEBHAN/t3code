import { describe, expect, it } from "vitest";

import {
  deriveProposedPlanImplementationState,
  isLegacyProposedPlanImplementationUnknown,
} from "./proposedPlanImplementationState";

describe("deriveProposedPlanImplementationState", () => {
  it("treats post-tracking unimplemented plans as actionable", () => {
    expect(
      deriveProposedPlanImplementationState({
        createdAt: "2026-03-19T09:00:00.000Z",
        implementedAt: null,
        implementationThreadId: null,
      }),
    ).toBe("actionable");
  });

  it("treats implemented plans as implemented", () => {
    expect(
      deriveProposedPlanImplementationState({
        createdAt: "2026-03-19T09:00:00.000Z",
        implementedAt: "2026-03-19T09:05:00.000Z",
        implementationThreadId: "thread-implement" as never,
      }),
    ).toBe("implemented");
  });

  it("treats pre-tracking unimplemented plans as legacy unknown", () => {
    expect(
      deriveProposedPlanImplementationState({
        createdAt: "2026-03-07T17:50:27.358Z",
        implementedAt: null,
        implementationThreadId: null,
      }),
    ).toBe("legacyUnknown");
    expect(
      isLegacyProposedPlanImplementationUnknown({
        createdAt: "2026-03-07T17:50:27.358Z",
        implementedAt: null,
        implementationThreadId: null,
      }),
    ).toBe(true);
  });
});

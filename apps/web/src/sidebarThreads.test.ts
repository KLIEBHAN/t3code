import { ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { groupThreadsByProject, resolveThreadActivityAt } from "./sidebarThreads";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE, type Thread } from "./types";

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: ThreadId.makeUnsafe("thread-1"),
    codexThreadId: null,
    projectId: ProjectId.makeUnsafe("project-1"),
    title: "Thread",
    model: "gpt-5.3-codex",
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    session: null,
    messages: [],
    turnDiffSummaries: [],
    activities: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-02-13T00:00:00.000Z",
    updatedAt: "2026-02-13T00:00:00.000Z",
    latestTurn: null,
    branch: null,
    worktreePath: null,
    ...overrides,
  };
}

describe("resolveThreadActivityAt", () => {
  it("prefers updatedAt when it is valid", () => {
    const thread = makeThread({
      createdAt: "2026-02-13T00:00:00.000Z",
      updatedAt: "2026-02-14T00:00:00.000Z",
    });

    expect(resolveThreadActivityAt(thread)).toBe("2026-02-14T00:00:00.000Z");
  });

  it("falls back to createdAt when updatedAt is invalid", () => {
    const thread = makeThread({
      createdAt: "2026-02-13T00:00:00.000Z",
      updatedAt: "not-a-date",
    });

    expect(resolveThreadActivityAt(thread)).toBe("2026-02-13T00:00:00.000Z");
  });
});

describe("groupThreadsByProject", () => {
  it("sorts each project by most recent activity instead of creation time", () => {
    const projectId = ProjectId.makeUnsafe("project-1");
    const threads = [
      makeThread({
        id: ThreadId.makeUnsafe("older-created-newer-active"),
        projectId,
        createdAt: "2026-02-10T00:00:00.000Z",
        updatedAt: "2026-02-14T12:00:00.000Z",
      }),
      makeThread({
        id: ThreadId.makeUnsafe("newer-created-older-active"),
        projectId,
        createdAt: "2026-02-12T00:00:00.000Z",
        updatedAt: "2026-02-13T12:00:00.000Z",
      }),
    ];

    const grouped = groupThreadsByProject(threads);

    expect(grouped.get(projectId)?.map((thread) => thread.id)).toEqual([
      ThreadId.makeUnsafe("older-created-newer-active"),
      ThreadId.makeUnsafe("newer-created-older-active"),
    ]);
  });
});

import { describe, expect, it, vi } from "vitest";

import type { ProjectId, ThreadId } from "@t3tools/contracts";

import type { DraftThreadState, ProjectDraftThread } from "./composerDraftStore";
import { deriveNewThreadDraftOptions, openThreadDraftForProject } from "./threadDraftNavigation";

const PROJECT_ID = "project-1" as ProjectId;
const ROUTE_THREAD_ID = "thread-route" as ThreadId;

function createDependencies(input?: {
  storedDraftThread?: ProjectDraftThread | null;
  routeDraftThread?: DraftThreadState | null;
  routeThreadId?: ThreadId | null;
}) {
  const navigateToThread = vi.fn<(threadId: ThreadId) => Promise<void>>().mockResolvedValue();
  const setProjectDraftThreadId = vi.fn();
  const setDraftThreadContext = vi.fn();
  const clearProjectDraftThreadId = vi.fn();

  return {
    navigateToThread,
    setProjectDraftThreadId,
    setDraftThreadContext,
    clearProjectDraftThreadId,
    dependencies: {
      getDraftThreadByProjectId: () => input?.storedDraftThread ?? null,
      getDraftThread: () => input?.routeDraftThread ?? null,
      setProjectDraftThreadId,
      setDraftThreadContext,
      clearProjectDraftThreadId,
      routeThreadId: input?.routeThreadId ?? ROUTE_THREAD_ID,
      navigateToThread,
    },
  };
}

describe("deriveNewThreadDraftOptions", () => {
  it("preserves thread context when requested", () => {
    expect(
      deriveNewThreadDraftOptions({
        activeThread: { branch: "feature", worktreePath: "/repo/worktrees/feature" },
        activeDraftThread: null,
        preserveContext: true,
      }),
    ).toEqual({
      branch: "feature",
      worktreePath: "/repo/worktrees/feature",
      envMode: "worktree",
    });
  });

  it("forces local mode for new-local behavior", () => {
    expect(
      deriveNewThreadDraftOptions({
        activeThread: { branch: "feature", worktreePath: "/repo/worktrees/feature" },
        activeDraftThread: null,
        preserveContext: false,
      }),
    ).toEqual({
      branch: null,
      worktreePath: null,
      envMode: "local",
    });
  });
});

describe("openThreadDraftForProject", () => {
  it("reuses and navigates to an existing project draft thread", async () => {
    const { dependencies, navigateToThread, setProjectDraftThreadId } = createDependencies({
      storedDraftThread: {
        threadId: "thread-existing" as ThreadId,
        projectId: PROJECT_ID,
        createdAt: "2026-03-08T10:00:00.000Z",
        branch: null,
        worktreePath: null,
        envMode: "local",
        runtimeMode: "full-access",
        interactionMode: "default",
      },
      routeThreadId: null,
    });

    await openThreadDraftForProject(PROJECT_ID, dependencies);

    expect(setProjectDraftThreadId).toHaveBeenCalledWith(PROJECT_ID, "thread-existing");
    expect(navigateToThread).toHaveBeenCalledWith("thread-existing");
  });

  it("reuses the routed draft thread for the same project without navigating", async () => {
    const { dependencies, navigateToThread, setProjectDraftThreadId } = createDependencies({
      routeDraftThread: {
        projectId: PROJECT_ID,
        createdAt: "2026-03-08T10:00:00.000Z",
        branch: "main",
        worktreePath: null,
        envMode: "local",
        runtimeMode: "full-access",
        interactionMode: "default",
      },
    });

    await openThreadDraftForProject(PROJECT_ID, dependencies, {
      branch: "feature",
    });

    expect(setProjectDraftThreadId).toHaveBeenCalledWith(PROJECT_ID, ROUTE_THREAD_ID);
    expect(navigateToThread).not.toHaveBeenCalled();
  });
});

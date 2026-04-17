import { describe, expect, it, vi } from "vitest";

import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime";

import type { DraftThreadState, ProjectDraftThread } from "./composerDraftStore";
import { deriveNewThreadDraftOptions, openThreadDraftForProject } from "./threadDraftNavigation";

const PROJECT_ID = "project-1" as ProjectId;
const ROUTE_THREAD_ID = "thread-route" as ThreadId;
const ENVIRONMENT_ID = "environment-1" as EnvironmentId;

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
      getDraftThreadByProjectId: undefined as never,
      getDraftThreadByProjectRef: () => input?.storedDraftThread ?? null,
      getDraftThread: () => input?.routeDraftThread ?? null,
      setProjectDraftThreadId: (projectId: ProjectId, threadId: ThreadId, options?: unknown) =>
        setProjectDraftThreadId(scopeProjectRef(ENVIRONMENT_ID, projectId), threadId, options),
      setDraftThreadContext,
      clearProjectDraftThreadId: (projectId: ProjectId) =>
        clearProjectDraftThreadId(scopeProjectRef(ENVIRONMENT_ID, projectId)),
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
        environmentId: ENVIRONMENT_ID,
        logicalProjectKey: "environment-1:project-1",
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

    expect(setProjectDraftThreadId).toHaveBeenCalledWith(
      scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID),
      "thread-existing",
      undefined,
    );
    expect(navigateToThread).toHaveBeenCalledWith("thread-existing");
  });

  it("reuses the routed draft thread for the same project without navigating", async () => {
    const { dependencies, navigateToThread, setProjectDraftThreadId } = createDependencies({
      routeDraftThread: {
        threadId: ROUTE_THREAD_ID,
        environmentId: ENVIRONMENT_ID,
        logicalProjectKey: "environment-1:project-1",
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

    expect(setProjectDraftThreadId).toHaveBeenCalledWith(
      scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID),
      ROUTE_THREAD_ID,
      undefined,
    );
    expect(navigateToThread).not.toHaveBeenCalled();
  });
});

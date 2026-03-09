import { DEFAULT_MODEL_BY_PROVIDER, type ProjectId, type ThreadId } from "@t3tools/contracts";

import type { ProjectDraftThread } from "./composerDraftStore";
import { readNativeApi } from "./nativeApi";
import { deriveNewThreadDraftOptions, openThreadDraftForProject } from "./threadDraftNavigation";
import type { Project, Thread } from "./types";
import { toastManager } from "./components/ui/toast";
import { newCommandId, newProjectId } from "./lib/utils";
import { formatWorktreePathForDisplay, getOrphanedWorktreePathForThread } from "./worktreeCleanup";
import { isNonEmpty as isNonEmptyString } from "effect/String";

async function copyTextToClipboard(text: string): Promise<void> {
  if (typeof navigator === "undefined" || navigator.clipboard?.writeText === undefined) {
    throw new Error("Clipboard API unavailable.");
  }
  await navigator.clipboard.writeText(text);
}

export async function openSidebarThreadDraft(options: {
  projectId: ProjectId;
  draftOptions?: Parameters<typeof openThreadDraftForProject>[2];
  getDraftThreadByProjectId: (projectId: ProjectId) => ProjectDraftThread | null;
  getDraftThread: Parameters<typeof openThreadDraftForProject>[1]["getDraftThread"];
  setProjectDraftThreadId: Parameters<typeof openThreadDraftForProject>[1]["setProjectDraftThreadId"];
  setDraftThreadContext: Parameters<typeof openThreadDraftForProject>[1]["setDraftThreadContext"];
  clearProjectDraftThreadId: Parameters<typeof openThreadDraftForProject>[1]["clearProjectDraftThreadId"];
  routeThreadId: ThreadId | null;
  navigateToThread: Parameters<typeof openThreadDraftForProject>[1]["navigateToThread"];
}): Promise<void> {
  await openThreadDraftForProject(
    options.projectId,
    {
      getDraftThreadByProjectId: options.getDraftThreadByProjectId,
      getDraftThread: options.getDraftThread,
      setProjectDraftThreadId: options.setProjectDraftThreadId,
      setDraftThreadContext: options.setDraftThreadContext,
      clearProjectDraftThreadId: options.clearProjectDraftThreadId,
      routeThreadId: options.routeThreadId,
      navigateToThread: options.navigateToThread,
    },
    options.draftOptions,
  );
}

export async function addSidebarProjectFromPath(options: {
  rawCwd: string;
  isAddingProject: boolean;
  projects: ReadonlyArray<Project>;
  shouldBrowseForProjectImmediately: boolean;
  focusMostRecentThreadForProject: (projectId: ProjectId) => void;
  openThreadDraft: (projectId: ProjectId) => Promise<void>;
  startAddingProject: () => void;
  finishAddingProject: () => void;
  failAddingProject: (description: string) => void;
}): Promise<void> {
  const cwd = options.rawCwd.trim();
  if (!cwd || options.isAddingProject) {
    return;
  }

  const api = readNativeApi();
  if (!api) {
    return;
  }

  options.startAddingProject();

  const existingProject = options.projects.find((project) => project.cwd === cwd);
  if (existingProject) {
    options.focusMostRecentThreadForProject(existingProject.id);
    options.finishAddingProject();
    return;
  }

  const projectId = newProjectId();
  const createdAt = new Date().toISOString();
  const title = cwd.split(/[/\\]/).findLast(isNonEmptyString) ?? cwd;

  try {
    await api.orchestration.dispatchCommand({
      type: "project.create",
      commandId: newCommandId(),
      projectId,
      title,
      workspaceRoot: cwd,
      defaultModel: DEFAULT_MODEL_BY_PROVIDER.codex,
      createdAt,
    });
    await options.openThreadDraft(projectId).catch(() => undefined);
  } catch (error) {
    const description =
      error instanceof Error ? error.message : "An error occurred while adding the project.";
    if (options.shouldBrowseForProjectImmediately) {
      toastManager.add({
        type: "error",
        title: "Failed to add project",
        description,
      });
    }
    options.failAddingProject(description);
    return;
  }

  options.finishAddingProject();
}

export async function pickSidebarProjectFolder(options: {
  isPickingFolder: boolean;
  shouldBrowseForProjectImmediately: boolean;
  setIsPickingFolder: (nextValue: boolean) => void;
  focusProjectPathInput: () => void;
  addProjectFromPath: (pickedPath: string) => Promise<void>;
}): Promise<void> {
  const api = readNativeApi();
  if (!api || options.isPickingFolder) {
    return;
  }

  options.setIsPickingFolder(true);
  let pickedPath: string | null = null;
  try {
    pickedPath = await api.dialogs.pickFolder();
  } catch {
    // Ignore picker failures and leave the current thread selection unchanged.
  }

  if (pickedPath) {
    await options.addProjectFromPath(pickedPath);
  } else if (!options.shouldBrowseForProjectImmediately) {
    options.focusProjectPathInput();
  }

  options.setIsPickingFolder(false);
}

export function deriveSidebarNewThreadDraftOptions(input: {
  activeThread: Thread | null;
  activeDraftThread: Parameters<typeof deriveNewThreadDraftOptions>[0]["activeDraftThread"];
  preserveContext: boolean;
}) {
  return deriveNewThreadDraftOptions({
    activeThread: input.activeThread,
    activeDraftThread: input.activeDraftThread,
    preserveContext: input.preserveContext,
  });
}

export async function showSidebarThreadContextMenu(options: {
  threadId: ThreadId;
  position: { x: number; y: number };
  threads: ReadonlyArray<Thread>;
  projects: ReadonlyArray<Project>;
  routeThreadId: ThreadId | null;
  confirmThreadDelete: boolean;
  markThreadUnread: (threadId: ThreadId) => void;
  beginRenameThread: (thread: Thread) => void;
  clearComposerDraftForThread: (threadId: ThreadId) => void;
  clearProjectDraftThreadById: (projectId: ProjectId, threadId: ThreadId) => void;
  clearTerminalState: (threadId: ThreadId) => void;
  navigateToThread: (threadId: ThreadId) => void;
  navigateHome: () => void;
  removeWorktree: (input: { cwd: string; path: string; force: boolean }) => Promise<unknown>;
}): Promise<void> {
  const api = readNativeApi();
  if (!api) {
    return;
  }

  const clicked = await api.contextMenu.show(
    [
      { id: "rename", label: "Rename thread" },
      { id: "mark-unread", label: "Mark unread" },
      { id: "copy-thread-id", label: "Copy Thread ID" },
      { id: "delete", label: "Delete", destructive: true },
    ],
    options.position,
  );
  const thread = options.threads.find((entry) => entry.id === options.threadId);
  if (!thread) {
    return;
  }

  if (clicked === "rename") {
    options.beginRenameThread(thread);
    return;
  }

  if (clicked === "mark-unread") {
    options.markThreadUnread(options.threadId);
    return;
  }

  if (clicked === "copy-thread-id") {
    try {
      await copyTextToClipboard(options.threadId);
      toastManager.add({
        type: "success",
        title: "Thread ID copied",
        description: options.threadId,
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Failed to copy thread ID",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    }
    return;
  }

  if (clicked !== "delete") {
    return;
  }

  if (options.confirmThreadDelete) {
    const confirmed = await api.dialogs.confirm(
      [
        `Delete thread "${thread.title}"?`,
        "This permanently clears conversation history for this thread.",
      ].join("\n"),
    );
    if (!confirmed) {
      return;
    }
  }

  const threadProject = options.projects.find((project) => project.id === thread.projectId);
  const orphanedWorktreePath = getOrphanedWorktreePathForThread(options.threads, options.threadId);
  const displayWorktreePath = orphanedWorktreePath
    ? formatWorktreePathForDisplay(orphanedWorktreePath)
    : null;
  const canDeleteWorktree = orphanedWorktreePath !== null && threadProject !== undefined;
  const shouldDeleteWorktree =
    canDeleteWorktree &&
    (await api.dialogs.confirm(
      [
        "This thread is the only one linked to this worktree:",
        displayWorktreePath ?? orphanedWorktreePath,
        "",
        "Delete the worktree too?",
      ].join("\n"),
    ));

  if (thread.session && thread.session.status !== "closed") {
    await api.orchestration
      .dispatchCommand({
        type: "thread.session.stop",
        commandId: newCommandId(),
        threadId: options.threadId,
        createdAt: new Date().toISOString(),
      })
      .catch(() => undefined);
  }

  try {
    await api.terminal.close({
      threadId: options.threadId,
      deleteHistory: true,
    });
  } catch {
    // Terminal may already be closed.
  }

  const shouldNavigateToFallback = options.routeThreadId === options.threadId;
  const fallbackThreadId =
    options.threads.find((entry) => entry.id !== options.threadId)?.id ?? null;

  await api.orchestration.dispatchCommand({
    type: "thread.delete",
    commandId: newCommandId(),
    threadId: options.threadId,
  });
  options.clearComposerDraftForThread(options.threadId);
  options.clearProjectDraftThreadById(thread.projectId, thread.id);
  options.clearTerminalState(options.threadId);

  if (shouldNavigateToFallback) {
    if (fallbackThreadId) {
      options.navigateToThread(fallbackThreadId);
    } else {
      options.navigateHome();
    }
  }

  if (!shouldDeleteWorktree || !orphanedWorktreePath || !threadProject) {
    return;
  }

  try {
    await options.removeWorktree({
      cwd: threadProject.cwd,
      path: orphanedWorktreePath,
      force: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error removing worktree.";
    console.error("Failed to remove orphaned worktree after thread deletion", {
      threadId: options.threadId,
      projectCwd: threadProject.cwd,
      worktreePath: orphanedWorktreePath,
      error,
    });
    toastManager.add({
      type: "error",
      title: "Thread deleted, but worktree removal failed",
      description: `Could not remove ${displayWorktreePath ?? orphanedWorktreePath}. ${message}`,
    });
  }
}

export async function showSidebarProjectContextMenu(options: {
  projectId: ProjectId;
  position: { x: number; y: number };
  projects: ReadonlyArray<Project>;
  threads: ReadonlyArray<Thread>;
  getDraftThreadByProjectId: (projectId: ProjectId) => ProjectDraftThread | null;
  clearComposerDraftForThread: (threadId: ThreadId) => void;
  clearProjectDraftThreadId: (projectId: ProjectId) => void;
}): Promise<void> {
  const api = readNativeApi();
  if (!api) {
    return;
  }

  const clicked = await api.contextMenu.show(
    [{ id: "delete", label: "Delete", destructive: true }],
    options.position,
  );
  if (clicked !== "delete") {
    return;
  }

  const project = options.projects.find((entry) => entry.id === options.projectId);
  if (!project) {
    return;
  }

  const projectThreads = options.threads.filter((thread) => thread.projectId === options.projectId);
  if (projectThreads.length > 0) {
    toastManager.add({
      type: "warning",
      title: "Project is not empty",
      description: "Delete all threads in this project before deleting it.",
    });
    return;
  }

  const confirmed = await api.dialogs.confirm(
    [`Delete project "${project.name}"?`, "This action cannot be undone."].join("\n"),
  );
  if (!confirmed) {
    return;
  }

  try {
    const projectDraftThread = options.getDraftThreadByProjectId(options.projectId);
    if (projectDraftThread) {
      options.clearComposerDraftForThread(projectDraftThread.threadId);
    }
    options.clearProjectDraftThreadId(options.projectId);
    await api.orchestration.dispatchCommand({
      type: "project.delete",
      commandId: newCommandId(),
      projectId: options.projectId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error deleting project.";
    console.error("Failed to remove project", { projectId: options.projectId, error });
    toastManager.add({
      type: "error",
      title: `Failed to delete "${project.name}"`,
      description: message,
    });
  }
}

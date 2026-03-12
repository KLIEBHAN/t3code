import {
  type CollisionDetection,
  type DragCancelEvent,
  type DragEndEvent,
  type DragStartEvent,
  PointerSensor,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { ProjectId, ResolvedKeybindingsConfig, ThreadId } from "@t3tools/contracts";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useRef,
} from "react";

import type { DraftThreadState } from "./composerDraftStore";
import { isChatNewLocalShortcut, isChatNewShortcut, isSidebarToggleShortcut } from "./keybindings";
import { isTerminalFocusedInDocument } from "./terminalFocus";
import { deriveSidebarNewThreadDraftOptions } from "./sidebarActions";
import type { Project, Thread } from "./types";
import { useSidebar } from "./components/ui/sidebar";

export function useSidebarProjectInteractions(options: {
  projects: ReadonlyArray<Project>;
  reorderProjects: (activeProjectId: ProjectId, overProjectId: ProjectId) => void;
  toggleProject: (projectId: ProjectId) => void;
}) {
  const { projects, reorderProjects, toggleProject } = options;
  const dragInProgressRef = useRef(false);
  const suppressProjectClickAfterDragRef = useRef(false);

  const projectDnDSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );

  const projectCollisionDetection = useCallback<CollisionDetection>((args) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) {
      return pointerCollisions;
    }

    return closestCorners(args);
  }, []);

  const handleProjectDragEnd = useCallback(
    (event: DragEndEvent) => {
      dragInProgressRef.current = false;
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const activeProject = projects.find((project) => project.id === active.id);
      const overProject = projects.find((project) => project.id === over.id);
      if (!activeProject || !overProject) return;
      reorderProjects(activeProject.id, overProject.id);
    },
    [projects, reorderProjects],
  );

  const handleProjectDragStart = useCallback((_event: DragStartEvent) => {
    dragInProgressRef.current = true;
    suppressProjectClickAfterDragRef.current = true;
  }, []);

  const handleProjectDragCancel = useCallback((_event: DragCancelEvent) => {
    dragInProgressRef.current = false;
    suppressProjectClickAfterDragRef.current = false;
  }, []);

  const handleProjectTitlePointerDownCapture = useCallback(() => {
    suppressProjectClickAfterDragRef.current = false;
  }, []);

  const handleProjectTitleClick = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>, projectId: ProjectId) => {
      if (dragInProgressRef.current) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (suppressProjectClickAfterDragRef.current) {
        suppressProjectClickAfterDragRef.current = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      toggleProject(projectId);
    },
    [toggleProject],
  );

  const handleProjectTitleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>, projectId: ProjectId) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      if (dragInProgressRef.current) return;
      toggleProject(projectId);
    },
    [toggleProject],
  );

  return {
    projectDnDSensors,
    projectCollisionDetection,
    handleProjectDragEnd,
    handleProjectDragStart,
    handleProjectDragCancel,
    handleProjectTitlePointerDownCapture,
    handleProjectTitleClick,
    handleProjectTitleKeyDown,
  };
}

export function useSidebarNewThreadShortcuts(options: {
  routeThreadId: ThreadId | null;
  threads: ReadonlyArray<Thread>;
  projects: ReadonlyArray<Project>;
  keybindings: ResolvedKeybindingsConfig;
  getDraftThread: (threadId: ThreadId) => DraftThreadState | null;
  openThreadDraft: (
    projectId: ProjectId,
    draftOptions?: ReturnType<typeof deriveSidebarNewThreadDraftOptions>,
  ) => Promise<void>;
}) {
  const { getDraftThread, keybindings, openThreadDraft, projects, routeThreadId, threads } =
    options;

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      const activeThread = routeThreadId
        ? threads.find((thread) => thread.id === routeThreadId)
        : undefined;
      const activeDraftThread = routeThreadId ? getDraftThread(routeThreadId) : null;

      if (isChatNewLocalShortcut(event, keybindings)) {
        const projectId =
          activeThread?.projectId ?? activeDraftThread?.projectId ?? projects[0]?.id;
        if (!projectId) return;
        event.preventDefault();
        void openThreadDraft(
          projectId,
          deriveSidebarNewThreadDraftOptions({
            activeThread: activeThread ?? null,
            activeDraftThread,
            preserveContext: false,
          }),
        );
        return;
      }

      if (!isChatNewShortcut(event, keybindings)) return;
      const projectId = activeThread?.projectId ?? activeDraftThread?.projectId ?? projects[0]?.id;
      if (!projectId) return;
      event.preventDefault();
      void openThreadDraft(
        projectId,
        deriveSidebarNewThreadDraftOptions({
          activeThread: activeThread ?? null,
          activeDraftThread,
          preserveContext: true,
        }),
      );
    };

    window.addEventListener("keydown", onWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", onWindowKeyDown);
    };
  }, [getDraftThread, keybindings, openThreadDraft, projects, routeThreadId, threads]);
}

export function useSidebarVisibilityShortcut(options: { keybindings: ResolvedKeybindingsConfig }) {
  const { keybindings } = options;
  const { toggleSidebar } = useSidebar();

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (
        !isSidebarToggleShortcut(event, keybindings, {
          context: { terminalFocus: isTerminalFocusedInDocument() },
        })
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      toggleSidebar();
    };

    window.addEventListener("keydown", onWindowKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", onWindowKeyDown, { capture: true });
    };
  }, [keybindings, toggleSidebar]);
}

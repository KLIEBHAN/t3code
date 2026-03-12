import {
  ChevronRightIcon,
  FolderIcon,
  GitPullRequestIcon,
  SquarePenIcon,
  TerminalIcon,
} from "lucide-react";
import {
  memo,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ProjectId, ThreadId } from "@t3tools/contracts";

import { resolveServerHttpOrigin } from "../serverOrigins";
import type { SidebarPrStatusIndicator, SidebarTerminalStatusIndicator } from "../sidebarStatus";
import type { Project, Thread } from "../types";
import type { ThreadStatusPill } from "./Sidebar.logic";
import { Collapsible, CollapsibleContent } from "./ui/collapsible";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import {
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "./ui/sidebar";

const THREAD_PREVIEW_LIMIT = 6;
const ProjectFavicon = memo(function ProjectFavicon({ cwd }: { cwd: string }) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const serverHttpOrigin = resolveServerHttpOrigin();
  const src = `${serverHttpOrigin}/api/project-favicon?cwd=${encodeURIComponent(cwd)}`;

  if (status === "error") {
    return <FolderIcon className="size-3.5 shrink-0 text-muted-foreground/50" />;
  }

  return (
    <img
      src={src}
      alt=""
      className={`size-3.5 shrink-0 rounded-sm object-contain ${status === "loading" ? "hidden" : ""}`}
      onLoad={() => setStatus("loaded")}
      onError={() => setStatus("error")}
    />
  );
});

type SortableProjectHandleProps = Pick<ReturnType<typeof useSortable>, "attributes" | "listeners">;

const SortableProjectItem = memo(function SortableProjectItem(props: {
  projectId: ProjectId;
  children: (handleProps: SortableProjectHandleProps) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } =
    useSortable({ id: props.projectId });

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      className={`group/menu-item relative rounded-md ${
        isDragging ? "z-20 opacity-80" : ""
      } ${isOver && !isDragging ? "ring-1 ring-primary/40" : ""}`}
      data-sidebar="menu-item"
      data-slot="sidebar-menu-item"
    >
      {props.children({ attributes, listeners })}
    </li>
  );
});

function SidebarProjectThreadRow(props: {
  thread: Thread;
  isActive: boolean;
  threadStatus: ThreadStatusPill | null;
  prStatus: SidebarPrStatusIndicator | null;
  terminalStatus: SidebarTerminalStatusIndicator | null;
  relativeUpdatedAtLabel: string;
  renamingThreadId: ThreadId | null;
  renamingTitle: string;
  renamingInputRef: MutableRefObject<HTMLInputElement | null>;
  renamingCommittedRef: MutableRefObject<boolean>;
  onNavigate: (threadId: ThreadId) => void;
  onContextMenu: (threadId: ThreadId, position: { x: number; y: number }) => void;
  onOpenPrLink: (event: MouseEvent<HTMLElement>, prUrl: string) => void;
  onRenamingTitleChange: (nextTitle: string) => void;
  onCommitRename: (threadId: ThreadId, newTitle: string, originalTitle: string) => void;
  onCancelRename: () => void;
}) {
  const prStatus = props.prStatus;

  return (
    <SidebarMenuSubItem className="w-full">
      <SidebarMenuSubButton
        render={<div role="button" tabIndex={0} />}
        size="sm"
        isActive={props.isActive}
        className={`h-7 w-full translate-x-0 cursor-default justify-start px-2 text-left hover:bg-accent hover:text-foreground ${
          props.isActive
            ? "bg-accent/85 text-foreground font-medium ring-1 ring-border/70 dark:bg-accent/55 dark:ring-border/50"
            : "text-muted-foreground"
        }`}
        onClick={() => {
          props.onNavigate(props.thread.id);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          props.onNavigate(props.thread.id);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          props.onContextMenu(props.thread.id, {
            x: event.clientX,
            y: event.clientY,
          });
        }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
          {prStatus && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={prStatus.tooltip}
                    className={`inline-flex items-center justify-center ${prStatus.colorClass} cursor-pointer rounded-sm outline-hidden focus-visible:ring-1 focus-visible:ring-ring`}
                    onClick={(event) => {
                      props.onOpenPrLink(event, prStatus.url);
                    }}
                  >
                    <GitPullRequestIcon className="size-3" />
                  </button>
                }
              />
              <TooltipPopup side="top">{prStatus.tooltip}</TooltipPopup>
            </Tooltip>
          )}
          {props.threadStatus && (
            <span
              className={`inline-flex items-center gap-1 text-[10px] ${props.threadStatus.colorClass}`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${props.threadStatus.dotClass} ${
                  props.threadStatus.pulse ? "animate-pulse" : ""
                }`}
              />
              <span className="hidden md:inline">{props.threadStatus.label}</span>
            </span>
          )}
          {props.renamingThreadId === props.thread.id ? (
            <input
              ref={(element) => {
                if (element && props.renamingInputRef.current !== element) {
                  props.renamingInputRef.current = element;
                  element.focus();
                  element.select();
                }
              }}
              className="min-w-0 flex-1 truncate rounded border border-ring bg-transparent px-0.5 text-xs outline-none"
              value={props.renamingTitle}
              onChange={(event) => props.onRenamingTitleChange(event.target.value)}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Enter") {
                  event.preventDefault();
                  props.renamingCommittedRef.current = true;
                  props.onCommitRename(props.thread.id, props.renamingTitle, props.thread.title);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  props.renamingCommittedRef.current = true;
                  props.onCancelRename();
                }
              }}
              onBlur={() => {
                if (!props.renamingCommittedRef.current) {
                  props.onCommitRename(props.thread.id, props.renamingTitle, props.thread.title);
                }
              }}
              onClick={(event) => event.stopPropagation()}
            />
          ) : (
            <span className="min-w-0 flex-1 truncate text-xs">{props.thread.title}</span>
          )}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {props.terminalStatus && (
            <span
              role="img"
              aria-label={props.terminalStatus.label}
              title={props.terminalStatus.label}
              className={`inline-flex items-center justify-center ${props.terminalStatus.colorClass}`}
            >
              <TerminalIcon
                className={`size-3 ${props.terminalStatus.pulse ? "animate-pulse" : ""}`}
              />
            </span>
          )}
          <span
            className={`text-[10px] ${
              props.isActive ? "text-foreground/65" : "text-muted-foreground/40"
            }`}
          >
            {props.relativeUpdatedAtLabel}
          </span>
        </div>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  );
}

export interface SidebarProjectListProps {
  projects: ReadonlyArray<Project>;
  threadsByProjectId: ReadonlyMap<ProjectId, Thread[]>;
  expandedThreadListsByProject: ReadonlySet<ProjectId>;
  routeThreadId: ThreadId | null;
  newThreadShortcutLabel: string | null;
  renamingThreadId: ThreadId | null;
  renamingTitle: string;
  renamingInputRef: MutableRefObject<HTMLInputElement | null>;
  renamingCommittedRef: MutableRefObject<boolean>;
  resolveThreadStatus: (thread: Thread) => ThreadStatusPill | null;
  resolvePrStatus: (threadId: ThreadId) => SidebarPrStatusIndicator | null;
  resolveTerminalStatus: (threadId: ThreadId) => SidebarTerminalStatusIndicator | null;
  getThreadTimestampLabel: (thread: Thread) => string;
  onProjectTitlePointerDownCapture: () => void;
  onProjectTitleClick: (event: MouseEvent<HTMLButtonElement>, projectId: ProjectId) => void;
  onProjectTitleKeyDown: (event: KeyboardEvent<HTMLButtonElement>, projectId: ProjectId) => void;
  onProjectContextMenu: (projectId: ProjectId, position: { x: number; y: number }) => void;
  onStartNewThread: (projectId: ProjectId) => void;
  onThreadNavigate: (threadId: ThreadId) => void;
  onThreadContextMenu: (threadId: ThreadId, position: { x: number; y: number }) => void;
  onOpenPrLink: (event: MouseEvent<HTMLElement>, prUrl: string) => void;
  onRenamingTitleChange: (nextTitle: string) => void;
  onCommitRename: (threadId: ThreadId, newTitle: string, originalTitle: string) => void;
  onCancelRename: () => void;
  onExpandThreadList: (projectId: ProjectId) => void;
  onCollapseThreadList: (projectId: ProjectId) => void;
}

export const SidebarProjectList = memo(function SidebarProjectList(props: SidebarProjectListProps) {
  return (
    <SidebarMenu>
      <SortableContext
        items={props.projects.map((project) => project.id)}
        strategy={verticalListSortingStrategy}
      >
        {props.projects.map((project) => {
          const projectThreads = props.threadsByProjectId.get(project.id) ?? [];
          const isThreadListExpanded = props.expandedThreadListsByProject.has(project.id);
          const hasHiddenThreads = projectThreads.length > THREAD_PREVIEW_LIMIT;
          const visibleThreads =
            hasHiddenThreads && !isThreadListExpanded
              ? projectThreads.slice(0, THREAD_PREVIEW_LIMIT)
              : projectThreads;

          return (
            <SortableProjectItem key={project.id} projectId={project.id}>
              {(dragHandleProps) => (
                <Collapsible className="group/collapsible" open={project.expanded}>
                  <div className="group/project-header relative">
                    <SidebarMenuButton
                      size="sm"
                      className="cursor-grab gap-2 px-2 py-1.5 text-left active:cursor-grabbing hover:bg-accent group-hover/project-header:bg-accent group-hover/project-header:text-sidebar-accent-foreground"
                      data-sidebar-project-button="true"
                      {...dragHandleProps.attributes}
                      {...dragHandleProps.listeners}
                      onPointerDownCapture={props.onProjectTitlePointerDownCapture}
                      onClick={(event) => props.onProjectTitleClick(event, project.id)}
                      onKeyDown={(event) => props.onProjectTitleKeyDown(event, project.id)}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        props.onProjectContextMenu(project.id, {
                          x: event.clientX,
                          y: event.clientY,
                        });
                      }}
                    >
                      <ChevronRightIcon
                        className={`-ml-0.5 size-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-150 ${
                          project.expanded ? "rotate-90" : ""
                        }`}
                      />
                      <ProjectFavicon cwd={project.cwd} />
                      <span className="flex-1 truncate text-xs font-medium text-foreground/90">
                        {project.name}
                      </span>
                    </SidebarMenuButton>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <SidebarMenuAction
                            render={
                              <button
                                type="button"
                                aria-label={`Create new thread in ${project.name}`}
                              />
                            }
                            showOnHover
                            className="top-1 right-1 size-5 rounded-md p-0 text-muted-foreground/70 hover:bg-secondary hover:text-foreground"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              props.onStartNewThread(project.id);
                            }}
                          >
                            <SquarePenIcon className="size-3.5" />
                          </SidebarMenuAction>
                        }
                      />
                      <TooltipPopup side="top">
                        {props.newThreadShortcutLabel
                          ? `New thread (${props.newThreadShortcutLabel})`
                          : "New thread"}
                      </TooltipPopup>
                    </Tooltip>
                  </div>

                  <CollapsibleContent keepMounted>
                    <SidebarMenuSub className="mx-1 my-0 w-full translate-x-0 gap-0 px-1.5 py-0">
                      {visibleThreads.map((thread) => (
                        <SidebarProjectThreadRow
                          key={thread.id}
                          thread={thread}
                          isActive={props.routeThreadId === thread.id}
                          threadStatus={props.resolveThreadStatus(thread)}
                          prStatus={props.resolvePrStatus(thread.id)}
                          terminalStatus={props.resolveTerminalStatus(thread.id)}
                          relativeUpdatedAtLabel={props.getThreadTimestampLabel(thread)}
                          renamingThreadId={props.renamingThreadId}
                          renamingTitle={props.renamingTitle}
                          renamingInputRef={props.renamingInputRef}
                          renamingCommittedRef={props.renamingCommittedRef}
                          onNavigate={props.onThreadNavigate}
                          onContextMenu={props.onThreadContextMenu}
                          onOpenPrLink={props.onOpenPrLink}
                          onRenamingTitleChange={props.onRenamingTitleChange}
                          onCommitRename={props.onCommitRename}
                          onCancelRename={props.onCancelRename}
                        />
                      ))}

                      {hasHiddenThreads && !isThreadListExpanded && (
                        <SidebarMenuSubItem className="w-full">
                          <SidebarMenuSubButton
                            render={<button type="button" />}
                            size="sm"
                            className="h-6 w-full translate-x-0 justify-start px-2 text-left text-[10px] text-muted-foreground/60 hover:bg-accent hover:text-muted-foreground/80"
                            onClick={() => props.onExpandThreadList(project.id)}
                          >
                            <span>Show more</span>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      )}
                      {hasHiddenThreads && isThreadListExpanded && (
                        <SidebarMenuSubItem className="w-full">
                          <SidebarMenuSubButton
                            render={<button type="button" />}
                            size="sm"
                            className="h-6 w-full translate-x-0 justify-start px-2 text-left text-[10px] text-muted-foreground/60 hover:bg-accent hover:text-muted-foreground/80"
                            onClick={() => props.onCollapseThreadList(project.id)}
                          >
                            <span>Show less</span>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      )}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </SortableProjectItem>
          );
        })}
      </SortableContext>
    </SidebarMenu>
  );
});

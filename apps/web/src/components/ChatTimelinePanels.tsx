import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRightIcon, FileIcon, FolderClosedIcon, FolderIcon } from "lucide-react";
import type { TurnId } from "@t3tools/contracts";

import type { TurnDiffFileChange, TurnDiffSummary } from "../types";
import { basenameOfPath, getVscodeIconUrlForEntry } from "../vscode-icons";
import { findWorkLogFileStat } from "../workLogFileStats";
import {
  buildTurnDiffTree,
  summarizeTurnDiffStats,
  type TurnDiffTreeNode,
} from "../lib/turnDiffTree";
import { cn } from "~/lib/utils";
import { Button } from "./ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

const MAX_VISIBLE_WORK_LOG_ENTRIES = 6;

export interface TimelineWorkEntryViewModel {
  id: string;
  tone: "thinking" | "tool" | "info" | "error";
  label: string;
  command?: string | null;
  detail?: string | null;
  result?: string | null;
  changedFiles?: readonly string[];
  turnId?: TurnId;
}

function hasNonZeroStat(stat: { additions: number; deletions: number }): boolean {
  return stat.additions > 0 || stat.deletions > 0;
}

function workToneClass(tone: TimelineWorkEntryViewModel["tone"]): string {
  if (tone === "error") return "text-rose-300/50 dark:text-rose-300/50";
  if (tone === "tool") return "text-muted-foreground/70";
  if (tone === "thinking") return "text-muted-foreground/50";
  return "text-muted-foreground/40";
}

const DiffStatLabel = memo(function DiffStatLabel(props: {
  additions: number;
  deletions: number;
  showParentheses?: boolean;
}) {
  const { additions, deletions, showParentheses = false } = props;
  return (
    <>
      {showParentheses && <span className="text-muted-foreground/70">(</span>}
      <span className="text-success">+{additions}</span>
      <span className="mx-0.5 text-muted-foreground/70">/</span>
      <span className="text-destructive">-{deletions}</span>
      {showParentheses && <span className="text-muted-foreground/70">)</span>}
    </>
  );
});

export const VscodeEntryIcon = memo(function VscodeEntryIcon(props: {
  pathValue: string;
  kind: "file" | "directory";
  theme: "light" | "dark";
  className?: string;
}) {
  const [failedIconUrl, setFailedIconUrl] = useState<string | null>(null);
  const iconUrl = useMemo(
    () => getVscodeIconUrlForEntry(props.pathValue, props.kind, props.theme),
    [props.kind, props.pathValue, props.theme],
  );
  const failed = failedIconUrl === iconUrl;

  if (failed) {
    return props.kind === "directory" ? (
      <FolderIcon className={cn("size-4 text-muted-foreground/80", props.className)} />
    ) : (
      <FileIcon className={cn("size-4 text-muted-foreground/80", props.className)} />
    );
  }

  return (
    <img
      src={iconUrl}
      alt=""
      aria-hidden="true"
      className={cn("size-4 shrink-0", props.className)}
      loading="lazy"
      onError={() => setFailedIconUrl(iconUrl)}
    />
  );
});

function collectDirectoryPaths(nodes: ReadonlyArray<TurnDiffTreeNode>): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (node.kind !== "directory") continue;
    paths.push(node.path);
    paths.push(...collectDirectoryPaths(node.children));
  }
  return paths;
}

function buildDirectoryExpansionState(
  directoryPaths: ReadonlyArray<string>,
  expanded: boolean,
): Record<string, boolean> {
  const expandedState: Record<string, boolean> = {};
  for (const directoryPath of directoryPaths) {
    expandedState[directoryPath] = expanded;
  }
  return expandedState;
}

const ChangedFilesTree = memo(function ChangedFilesTree(props: {
  turnId: TurnId;
  files: ReadonlyArray<TurnDiffFileChange>;
  allDirectoriesExpanded: boolean;
  resolvedTheme: "light" | "dark";
  onOpenTurnDiff: (turnId: TurnId, filePath?: string, sourceElement?: HTMLElement | null) => void;
}) {
  const { files, allDirectoriesExpanded, onOpenTurnDiff, resolvedTheme, turnId } = props;
  const treeNodes = useMemo(() => buildTurnDiffTree(files), [files]);
  const directoryPathsKey = useMemo(
    () => collectDirectoryPaths(treeNodes).join("\u0000"),
    [treeNodes],
  );
  const allDirectoryExpansionState = useMemo(
    () =>
      buildDirectoryExpansionState(
        directoryPathsKey ? directoryPathsKey.split("\u0000") : [],
        allDirectoriesExpanded,
      ),
    [allDirectoriesExpanded, directoryPathsKey],
  );
  const [expandedDirectories, setExpandedDirectories] = useState<Record<string, boolean>>(() =>
    buildDirectoryExpansionState(directoryPathsKey ? directoryPathsKey.split("\u0000") : [], true),
  );

  useEffect(() => {
    setExpandedDirectories(allDirectoryExpansionState);
  }, [allDirectoryExpansionState]);

  const toggleDirectory = useCallback((pathValue: string, fallbackExpanded: boolean) => {
    setExpandedDirectories((current) => ({
      ...current,
      [pathValue]: !(current[pathValue] ?? fallbackExpanded),
    }));
  }, []);

  const renderTreeNode = (node: TurnDiffTreeNode, depth: number) => {
    const leftPadding = 8 + depth * 14;
    if (node.kind === "directory") {
      const isExpanded = expandedDirectories[node.path] ?? depth === 0;
      return (
        <div key={`dir:${node.path}`}>
          <button
            type="button"
            className="group flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left hover:bg-background/80"
            style={{ paddingLeft: `${leftPadding}px` }}
            onClick={() => toggleDirectory(node.path, depth === 0)}
          >
            <ChevronRightIcon
              aria-hidden="true"
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground/70 transition-transform group-hover:text-foreground/80",
                isExpanded && "rotate-90",
              )}
            />
            {isExpanded ? (
              <FolderIcon className="size-3.5 shrink-0 text-muted-foreground/75" />
            ) : (
              <FolderClosedIcon className="size-3.5 shrink-0 text-muted-foreground/75" />
            )}
            <span className="truncate font-mono text-[11px] text-muted-foreground/90 group-hover:text-foreground/90">
              {node.name}
            </span>
            {hasNonZeroStat(node.stat) && (
              <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums">
                <DiffStatLabel additions={node.stat.additions} deletions={node.stat.deletions} />
              </span>
            )}
          </button>
          {isExpanded && (
            <div className="space-y-0.5">
              {node.children.map((childNode) => renderTreeNode(childNode, depth + 1))}
            </div>
          )}
        </div>
      );
    }

    return (
      <button
        key={`file:${node.path}`}
        type="button"
        className="group flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left hover:bg-background/80"
        style={{ paddingLeft: `${leftPadding}px` }}
        data-scroll-anchor-ignore="true"
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => onOpenTurnDiff(turnId, node.path, event.currentTarget)}
      >
        <span aria-hidden="true" className="size-3.5 shrink-0" />
        <VscodeEntryIcon
          pathValue={node.path}
          kind="file"
          theme={resolvedTheme}
          className="size-3.5 text-muted-foreground/70"
        />
        <span className="truncate font-mono text-[11px] text-muted-foreground/80 group-hover:text-foreground/90">
          {node.name}
        </span>
        {node.stat && (
          <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums">
            <DiffStatLabel additions={node.stat.additions} deletions={node.stat.deletions} />
          </span>
        )}
      </button>
    );
  };

  return <div className="space-y-0.5">{treeNodes.map((node) => renderTreeNode(node, 0))}</div>;
});

export const TimelineWorkGroupCard = memo(function TimelineWorkGroupCard(props: {
  groupId: string;
  groupedEntries: ReadonlyArray<TimelineWorkEntryViewModel>;
  isExpanded: boolean;
  openToolResultsByEntryId: Record<string, true>;
  turnDiffSummaryByTurnId: Map<TurnId, TurnDiffSummary>;
  canOpenTurnDiff: (turnId: TurnId) => boolean;
  onToggleGroup: (groupId: string) => void;
  onSetToolResultOpen: (entryId: string, open: boolean) => void;
  onOpenTurnDiff: (turnId: TurnId, filePath?: string, sourceElement?: HTMLElement | null) => void;
  onDiffTriggerMouseDown: (event: React.MouseEvent<HTMLElement>) => void;
  resolvedTheme: "light" | "dark";
}) {
  const hasOverflow = props.groupedEntries.length > MAX_VISIBLE_WORK_LOG_ENTRIES;
  const visibleEntries =
    hasOverflow && !props.isExpanded
      ? props.groupedEntries.slice(-MAX_VISIBLE_WORK_LOG_ENTRIES)
      : props.groupedEntries;
  const hiddenCount = props.groupedEntries.length - visibleEntries.length;
  const onlyToolEntries = props.groupedEntries.every((entry) => entry.tone === "tool");
  const groupLabel = onlyToolEntries
    ? props.groupedEntries.length === 1
      ? "Tool call"
      : `Tool calls (${props.groupedEntries.length})`
    : props.groupedEntries.length === 1
      ? "Work event"
      : `Work log (${props.groupedEntries.length})`;

  return (
    <div className="rounded-lg border border-border/80 bg-card/45 px-3 py-2">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/65">
          {groupLabel}
        </p>
        {hasOverflow && (
          <button
            type="button"
            className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/55 transition-colors duration-150 hover:text-muted-foreground/80"
            onClick={() => props.onToggleGroup(props.groupId)}
          >
            {props.isExpanded ? "Show less" : `Show ${hiddenCount} more`}
          </button>
        )}
      </div>
      <div className="space-y-1">
        {visibleEntries.map((workEntry) => {
          const inlineDetail =
            workEntry.detail && (!workEntry.command || workEntry.detail !== workEntry.command)
              ? workEntry.detail
              : null;
          const resultText = workEntry.result ?? null;
          const hasResult = typeof resultText === "string" && resultText.length > 0;

          return (
            <div key={`work-row:${workEntry.id}`} className="flex items-start gap-2 py-0.5">
              <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/30" />
              <div className="min-w-0 flex-1 py-[2px]">
                {hasResult ? (
                  <Collapsible
                    className="mt-0.5"
                    open={props.openToolResultsByEntryId[workEntry.id] === true}
                    onOpenChange={(open) => props.onSetToolResultOpen(workEntry.id, open)}
                  >
                    <CollapsibleTrigger
                      render={
                        <button type="button" className="group block w-full rounded-md text-left" />
                      }
                    >
                      <div className="rounded-md border border-border/70 bg-background/80 transition-colors group-hover:border-border group-hover:bg-background/90">
                        <div className="flex items-start gap-1.5 px-2 py-1">
                          <ChevronRightIcon className="mt-0.5 size-3 shrink-0 text-muted-foreground/70 transition-transform duration-200 group-data-[panel-open]:rotate-90" />
                          <div className="min-w-0 flex-1">
                            <p
                              className={`text-[11px] leading-relaxed ${workToneClass(workEntry.tone)}`}
                            >
                              {workEntry.label}
                            </p>
                            {workEntry.command && (
                              <div className="mt-1 overflow-x-auto font-mono text-[11px] leading-relaxed text-foreground/80 whitespace-pre-wrap break-all">
                                {workEntry.command}
                              </div>
                            )}
                            <div className="mt-1 text-[10px] uppercase tracking-[0.08em] text-muted-foreground/70">
                              {props.openToolResultsByEntryId[workEntry.id] === true
                                ? "Hide output"
                                : "Show output"}
                            </div>
                          </div>
                        </div>
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <pre className="mt-1 overflow-x-auto rounded-md border border-border/70 bg-background/85 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-foreground/80 whitespace-pre-wrap break-words">
                        {resultText}
                      </pre>
                    </CollapsibleContent>
                  </Collapsible>
                ) : (
                  <>
                    <p className={`text-[11px] leading-relaxed ${workToneClass(workEntry.tone)}`}>
                      {workEntry.label}
                    </p>
                    {workEntry.command && (
                      <pre className="mt-1 overflow-x-auto rounded-md border border-border/70 bg-background/80 px-2 py-1 font-mono text-[11px] leading-relaxed text-foreground/80">
                        {workEntry.command}
                      </pre>
                    )}
                  </>
                )}
                {workEntry.changedFiles && workEntry.changedFiles.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {workEntry.changedFiles.slice(0, 6).map((filePath) => {
                      const fileLabel = basenameOfPath(filePath);
                      const canOpenDiff =
                        workEntry.turnId !== undefined && props.canOpenTurnDiff(workEntry.turnId);
                      const fileStat =
                        workEntry.turnId !== undefined
                          ? findWorkLogFileStat(
                              props.turnDiffSummaryByTurnId.get(workEntry.turnId),
                              filePath,
                            )
                          : null;

                      return (
                        <Tooltip key={`${workEntry.id}:${filePath}`}>
                          <TooltipTrigger
                            render={
                              canOpenDiff ? (
                                <button
                                  type="button"
                                  className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-md border border-border/70 bg-background/65 px-1.5 py-0.5 text-[10px] text-muted-foreground/85 transition-colors hover:border-border hover:bg-background/85 hover:text-foreground/90"
                                  data-scroll-anchor-ignore="true"
                                  onMouseDown={props.onDiffTriggerMouseDown}
                                  onClick={(event) => {
                                    if (!workEntry.turnId) return;
                                    props.onOpenTurnDiff(
                                      workEntry.turnId,
                                      filePath,
                                      event.currentTarget,
                                    );
                                  }}
                                />
                              ) : (
                                <span className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-md border border-dashed border-border/60 bg-background/55 px-1.5 py-0.5 text-[10px] text-muted-foreground/70" />
                              )
                            }
                          >
                            <VscodeEntryIcon
                              pathValue={filePath}
                              kind="file"
                              theme={props.resolvedTheme}
                              className="size-3 shrink-0 text-muted-foreground/70"
                            />
                            <span className="truncate font-mono">{fileLabel}</span>
                            {fileStat && hasNonZeroStat(fileStat) && (
                              <span className="shrink-0 font-mono text-[9px] tabular-nums">
                                <DiffStatLabel
                                  additions={fileStat.additions}
                                  deletions={fileStat.deletions}
                                />
                              </span>
                            )}
                          </TooltipTrigger>
                          <TooltipPopup side="top">
                            <div className="space-y-1">
                              <div className="font-mono text-[10px]">{filePath}</div>
                              {fileStat && hasNonZeroStat(fileStat) && (
                                <div className="text-[10px]">
                                  <DiffStatLabel
                                    additions={fileStat.additions}
                                    deletions={fileStat.deletions}
                                  />
                                </div>
                              )}
                              {canOpenDiff ? (
                                <div className="text-[10px] text-muted-foreground/80">
                                  Click to open diff
                                </div>
                              ) : (
                                <div className="text-[10px] text-muted-foreground/80">
                                  Diff not available yet for this turn
                                </div>
                              )}
                            </div>
                          </TooltipPopup>
                        </Tooltip>
                      );
                    })}
                    {workEntry.changedFiles.length > 6 && (
                      <span className="px-1 text-[10px] text-muted-foreground/65">
                        +{workEntry.changedFiles.length - 6} more files
                      </span>
                    )}
                  </div>
                )}
                {inlineDetail && !hasResult && (
                  <p
                    className="mt-1 text-[11px] leading-relaxed text-muted-foreground/75"
                    title={workEntry.detail ?? undefined}
                  >
                    {inlineDetail}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

export const AssistantChangedFilesCard = memo(function AssistantChangedFilesCard(props: {
  turnSummary: TurnDiffSummary;
  allDirectoriesExpanded: boolean;
  resolvedTheme: "light" | "dark";
  onToggleAllDirectories: (turnId: TurnId) => void;
  onOpenTurnDiff: (turnId: TurnId, filePath?: string, sourceElement?: HTMLElement | null) => void;
}) {
  const checkpointFiles = props.turnSummary.files;
  if (checkpointFiles.length === 0) {
    return null;
  }

  const summaryStat = summarizeTurnDiffStats(checkpointFiles);

  return (
    <div className="mt-2 rounded-lg border border-border/80 bg-card/45 p-2.5">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/65">
          <span>Changed files ({checkpointFiles.length})</span>
          {hasNonZeroStat(summaryStat) && (
            <>
              <span className="mx-1">•</span>
              <DiffStatLabel additions={summaryStat.additions} deletions={summaryStat.deletions} />
            </>
          )}
        </p>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => props.onToggleAllDirectories(props.turnSummary.turnId)}
          >
            {props.allDirectoriesExpanded ? "Collapse all" : "Expand all"}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            data-scroll-anchor-ignore="true"
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) =>
              props.onOpenTurnDiff(
                props.turnSummary.turnId,
                checkpointFiles[0]?.path,
                event.currentTarget,
              )
            }
          >
            View diff
          </Button>
        </div>
      </div>
      <ChangedFilesTree
        key={`changed-files-tree:${props.turnSummary.turnId}`}
        turnId={props.turnSummary.turnId}
        files={checkpointFiles}
        allDirectoriesExpanded={props.allDirectoriesExpanded}
        resolvedTheme={props.resolvedTheme}
        onOpenTurnDiff={props.onOpenTurnDiff}
      />
    </div>
  );
});

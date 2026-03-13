import { parsePatchFiles } from "@pierre/diffs";
import { FileDiff, type FileDiffMetadata, Virtualizer } from "@pierre/diffs/react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { ThreadId, type TurnId } from "@t3tools/contracts";
import { ChevronLeftIcon, ChevronRightIcon, Columns2Icon, Rows3Icon } from "lucide-react";
import {
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { openInPreferredEditor } from "../editorPreferences";
import { gitBranchesQueryOptions } from "~/lib/gitReactQuery";
import { checkpointDiffQueryOptions } from "~/lib/providerReactQuery";
import { cn } from "~/lib/utils";
import { readNativeApi } from "../nativeApi";
import { resolvePathLinkTarget } from "../terminal-links";
import { parseDiffRouteSearch, stripDiffSearchParams } from "../diffRouteSearch";
import { useTheme } from "../hooks/useTheme";
import { buildPatchCacheKey } from "../lib/diffRendering";
import { resolveDiffThemeName } from "../lib/diffRendering";
import { useTurnDiffSummaries } from "../hooks/useTurnDiffSummaries";
import {
  hasTurnDiffFallbackPatch,
  isTurnDiffNavigable,
  isTurnDiffOpenable,
  resolveCheckpointTurnCount,
} from "../turnDiffSummary";
import { pathsReferToSameFileChange } from "../workLogFileStats";
import { useStore } from "../store";
import { useAppSettings } from "../appSettings";
import { formatShortTimestamp } from "../timestampFormat";
import { DiffPanelLoadingState, DiffPanelShell, type DiffPanelMode } from "./DiffPanelShell";
import { ToggleGroup, Toggle } from "./ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

type DiffRenderMode = "stacked" | "split";
type DiffThemeType = "light" | "dark";

const DIFF_PANEL_UNSAFE_CSS = `
[data-diffs-header],
[data-diff],
[data-file],
[data-error-wrapper],
[data-virtualizer-buffer] {
  --diffs-bg: color-mix(in srgb, var(--card) 90%, var(--background)) !important;
  --diffs-light-bg: color-mix(in srgb, var(--card) 90%, var(--background)) !important;
  --diffs-dark-bg: color-mix(in srgb, var(--card) 90%, var(--background)) !important;
  --diffs-token-light-bg: transparent;
  --diffs-token-dark-bg: transparent;

  --diffs-bg-context-override: color-mix(in srgb, var(--background) 97%, var(--foreground));
  --diffs-bg-hover-override: color-mix(in srgb, var(--background) 94%, var(--foreground));
  --diffs-bg-separator-override: color-mix(in srgb, var(--background) 95%, var(--foreground));
  --diffs-bg-buffer-override: color-mix(in srgb, var(--background) 90%, var(--foreground));

  --diffs-bg-addition-override: color-mix(in srgb, var(--background) 92%, var(--success));
  --diffs-bg-addition-number-override: color-mix(in srgb, var(--background) 88%, var(--success));
  --diffs-bg-addition-hover-override: color-mix(in srgb, var(--background) 85%, var(--success));
  --diffs-bg-addition-emphasis-override: color-mix(in srgb, var(--background) 80%, var(--success));

  --diffs-bg-deletion-override: color-mix(in srgb, var(--background) 92%, var(--destructive));
  --diffs-bg-deletion-number-override: color-mix(in srgb, var(--background) 88%, var(--destructive));
  --diffs-bg-deletion-hover-override: color-mix(in srgb, var(--background) 85%, var(--destructive));
  --diffs-bg-deletion-emphasis-override: color-mix(
    in srgb,
    var(--background) 80%,
    var(--destructive)
  );

  background-color: var(--diffs-bg) !important;
}

[data-file-info] {
  background-color: color-mix(in srgb, var(--card) 94%, var(--foreground)) !important;
  border-block-color: var(--border) !important;
  color: var(--foreground) !important;
}

[data-diffs-header] {
  position: sticky !important;
  top: 0;
  z-index: 4;
  background-color: color-mix(in srgb, var(--card) 94%, var(--foreground)) !important;
  border-bottom: 1px solid var(--border) !important;
}

[data-title] {
  cursor: pointer;
  transition:
    color 120ms ease,
    text-decoration-color 120ms ease;
  text-decoration: underline;
  text-decoration-color: transparent;
  text-underline-offset: 2px;
}

[data-title]:hover {
  color: color-mix(in srgb, var(--foreground) 84%, var(--primary)) !important;
  text-decoration-color: currentColor;
}
`;

type RenderablePatch =
  | {
      kind: "files";
      files: FileDiffMetadata[];
    }
  | {
      kind: "raw";
      text: string;
      reason: string;
    };

function getRenderablePatch(
  patch: string | undefined,
  cacheScope = "diff-panel",
): RenderablePatch | null {
  if (!patch) return null;
  const normalizedPatch = patch.trim();
  if (normalizedPatch.length === 0) return null;

  try {
    const parsedPatches = parsePatchFiles(
      normalizedPatch,
      buildPatchCacheKey(normalizedPatch, cacheScope),
    );
    const files = parsedPatches.flatMap((parsedPatch) => parsedPatch.files);
    if (files.length > 0) {
      return { kind: "files", files };
    }

    return {
      kind: "raw",
      text: normalizedPatch,
      reason: "Unsupported diff format. Showing raw patch.",
    };
  } catch {
    return {
      kind: "raw",
      text: normalizedPatch,
      reason: "Failed to parse patch. Showing raw patch.",
    };
  }
}

function resolveFileDiffPath(fileDiff: FileDiffMetadata): string {
  const raw = fileDiff.name ?? fileDiff.prevName ?? "";
  if (raw.startsWith("a/") || raw.startsWith("b/")) {
    return raw.slice(2);
  }
  return raw;
}

function buildFileDiffRenderKey(fileDiff: FileDiffMetadata): string {
  return fileDiff.cacheKey ?? `${fileDiff.prevName ?? "none"}:${fileDiff.name}`;
}

function scrollSelectedDiffFileIntoView(options: {
  patchViewportElement: HTMLDivElement;
  selectedFilePath: string;
}): boolean {
  const { patchViewportElement, selectedFilePath } = options;
  const scrollContainer = patchViewportElement.querySelector<HTMLElement>(".diff-render-surface");
  if (!scrollContainer) {
    return false;
  }
  const target = Array.from(
    patchViewportElement.querySelectorAll<HTMLElement>("[data-diff-file-path]"),
  ).find((element) => {
    const diffFilePath = element.dataset.diffFilePath;
    return diffFilePath ? pathsReferToSameFileChange(diffFilePath, selectedFilePath) : false;
  });
  if (!target) {
    return false;
  }

  const containerRect = scrollContainer.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const nextScrollTop = Math.max(
    0,
    scrollContainer.scrollTop + (targetRect.top - containerRect.top),
  );

  if (Math.abs(scrollContainer.scrollTop - nextScrollTop) > 1) {
    scrollContainer.scrollTo({ top: nextScrollTop, behavior: "auto" });
  }

  return true;
}
interface DiffPanelProps {
  mode?: DiffPanelMode;
}

export { DiffWorkerPoolProvider } from "./DiffWorkerPoolProvider";

export default function DiffPanel({ mode = "inline" }: DiffPanelProps) {
  const navigate = useNavigate();
  const { resolvedTheme } = useTheme();
  const { settings } = useAppSettings();
  const [diffRenderMode, setDiffRenderMode] = useState<DiffRenderMode>("stacked");
  const [patchViewportElement, setPatchViewportElement] = useState<HTMLDivElement | null>(null);
  const [patchViewportMetrics, setPatchViewportMetrics] = useState({
    width: 0,
    height: 0,
    revision: 0,
  });
  const turnStripRef = useRef<HTMLDivElement>(null);
  const [canScrollTurnStripLeft, setCanScrollTurnStripLeft] = useState(false);
  const [canScrollTurnStripRight, setCanScrollTurnStripRight] = useState(false);
  const routeThreadId = useParams({
    strict: false,
    select: (params) => (params.threadId ? ThreadId.makeUnsafe(params.threadId) : null),
  });
  const diffSearch = useSearch({ strict: false, select: (search) => parseDiffRouteSearch(search) });
  const activeThreadId = routeThreadId;
  const activeThread = useStore((store) =>
    activeThreadId ? store.threads.find((thread) => thread.id === activeThreadId) : undefined,
  );
  const activeProjectId = activeThread?.projectId ?? null;
  const activeProject = useStore((store) =>
    activeProjectId ? store.projects.find((project) => project.id === activeProjectId) : undefined,
  );
  const activeCwd = activeThread?.worktreePath ?? activeProject?.cwd;
  const gitBranchesQuery = useQuery(gitBranchesQueryOptions(activeCwd ?? null));
  const isGitRepo = gitBranchesQuery.data?.isRepo ?? true;
  const {
    turnDiffSummaries,
    turnDiffSummaryByTurnId,
    turnDiffSummaryByCheckpointTurnCount,
    inferredCheckpointTurnCountByTurnId,
  } = useTurnDiffSummaries(activeThread);
  const isSummaryNavigable = useCallback(
    (summary: (typeof turnDiffSummaries)[number] | undefined): boolean =>
      isTurnDiffNavigable(
        summary,
        turnDiffSummaryByCheckpointTurnCount,
        inferredCheckpointTurnCountByTurnId,
      ),
    [inferredCheckpointTurnCountByTurnId, turnDiffSummaryByCheckpointTurnCount],
  );
  const isSummaryOpenable = useCallback(
    (summary: (typeof turnDiffSummaries)[number] | undefined): boolean =>
      isTurnDiffOpenable(
        summary,
        turnDiffSummaryByCheckpointTurnCount,
        inferredCheckpointTurnCountByTurnId,
      ),
    [inferredCheckpointTurnCountByTurnId, turnDiffSummaryByCheckpointTurnCount],
  );
  const orderedTurnDiffSummaries = useMemo(
    () =>
      [...turnDiffSummaries].toSorted((left, right) => {
        const leftTurnCount =
          resolveCheckpointTurnCount(left, inferredCheckpointTurnCountByTurnId) ?? 0;
        const rightTurnCount =
          resolveCheckpointTurnCount(right, inferredCheckpointTurnCountByTurnId) ?? 0;
        if (leftTurnCount !== rightTurnCount) {
          return rightTurnCount - leftTurnCount;
        }
        return right.completedAt.localeCompare(left.completedAt);
      }),
    [inferredCheckpointTurnCountByTurnId, turnDiffSummaries],
  );

  const selectedTurnId = diffSearch.diffTurnId ?? null;
  const hasSelectedTurnRequest = selectedTurnId !== null;
  const selectedTurn =
    selectedTurnId === null
      ? undefined
      : (() => {
          const summary = turnDiffSummaryByTurnId.get(selectedTurnId);
          return isSummaryOpenable(summary) ? summary : undefined;
        })();
  const selectedFilePath = selectedTurn ? (diffSearch.diffFilePath ?? null) : null;
  const selectedCheckpointTurnCount =
    selectedTurn && isSummaryNavigable(selectedTurn)
      ? resolveCheckpointTurnCount(selectedTurn, inferredCheckpointTurnCountByTurnId)
      : undefined;
  const selectedCheckpointRange = useMemo(
    () =>
      typeof selectedCheckpointTurnCount === "number"
        ? {
            fromTurnCount: Math.max(0, selectedCheckpointTurnCount - 1),
            toTurnCount: selectedCheckpointTurnCount,
          }
        : null,
    [selectedCheckpointTurnCount],
  );
  const conversationCheckpointTurnCount = useMemo(() => {
    const turnCounts = orderedTurnDiffSummaries
      .map((summary) => resolveCheckpointTurnCount(summary, inferredCheckpointTurnCountByTurnId))
      .filter((value): value is number => typeof value === "number");
    if (turnCounts.length === 0) {
      return undefined;
    }
    const latest = Math.max(...turnCounts);
    return latest > 0 ? latest : undefined;
  }, [inferredCheckpointTurnCountByTurnId, orderedTurnDiffSummaries]);
  const conversationCheckpointRange = useMemo(
    () =>
      !hasSelectedTurnRequest && typeof conversationCheckpointTurnCount === "number"
        ? {
            fromTurnCount: 0,
            toTurnCount: conversationCheckpointTurnCount,
          }
        : null,
    [conversationCheckpointTurnCount, hasSelectedTurnRequest],
  );
  const activeCheckpointRange = hasSelectedTurnRequest
    ? selectedCheckpointRange
    : conversationCheckpointRange;
  const conversationCacheScope = useMemo(() => {
    if (hasSelectedTurnRequest || orderedTurnDiffSummaries.length === 0) {
      return null;
    }
    return `conversation:${orderedTurnDiffSummaries.map((summary) => summary.turnId).join(",")}`;
  }, [hasSelectedTurnRequest, orderedTurnDiffSummaries]);
  const activeCheckpointDiffQuery = useQuery(
    checkpointDiffQueryOptions({
      threadId: activeThreadId,
      fromTurnCount: activeCheckpointRange?.fromTurnCount ?? null,
      toTurnCount: activeCheckpointRange?.toTurnCount ?? null,
      cacheScope: hasSelectedTurnRequest ? `turn:${selectedTurnId}` : conversationCacheScope,
      enabled: isGitRepo,
    }),
  );
  const selectedTurnCheckpointDiff = hasSelectedTurnRequest
    ? activeCheckpointDiffQuery.data?.diff
    : undefined;
  const conversationCheckpointDiff = hasSelectedTurnRequest
    ? undefined
    : activeCheckpointDiffQuery.data?.diff;
  const isLoadingCheckpointDiff = activeCheckpointDiffQuery.isLoading;
  const checkpointDiffError =
    activeCheckpointDiffQuery.error instanceof Error
      ? activeCheckpointDiffQuery.error.message
      : activeCheckpointDiffQuery.error
        ? "Failed to load checkpoint diff."
        : null;

  const selectedPatch = hasSelectedTurnRequest
    ? (selectedTurnCheckpointDiff ?? selectedTurn?.unifiedDiff)
    : conversationCheckpointDiff;
  const hasResolvedPatch = typeof selectedPatch === "string";
  const hasNoNetChanges = hasResolvedPatch && selectedPatch.trim().length === 0;
  const selectedTurnUnavailableMessage = useMemo(() => {
    if (selectedTurnId === null) {
      return null;
    }
    const summary = turnDiffSummaryByTurnId.get(selectedTurnId);
    if (!summary) {
      return "This turn diff is unavailable.";
    }
    if (isSummaryOpenable(summary)) {
      return null;
    }
    return "This turn diff is unavailable because the required checkpoint history is incomplete.";
  }, [isSummaryOpenable, selectedTurnId, turnDiffSummaryByTurnId]);
  const renderablePatch = useMemo(
    () => getRenderablePatch(selectedPatch, `diff-panel:${resolvedTheme}`),
    [resolvedTheme, selectedPatch],
  );
  const renderableFiles = useMemo(() => {
    if (!renderablePatch || renderablePatch.kind !== "files") {
      return [];
    }
    return renderablePatch.files.toSorted((left, right) =>
      resolveFileDiffPath(left).localeCompare(resolveFileDiffPath(right), undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
  }, [renderablePatch]);
  const canRenderVirtualizedPatch =
    renderablePatch?.kind === "files" &&
    patchViewportMetrics.width > 1 &&
    patchViewportMetrics.height > 1;
  const virtualizerRenderKey = useMemo(
    () =>
      [resolvedTheme, diffRenderMode, renderableFiles.length, patchViewportMetrics.revision].join(
        ":",
      ),
    [diffRenderMode, patchViewportMetrics.revision, renderableFiles.length, resolvedTheme],
  );

  useLayoutEffect(() => {
    const viewport = patchViewportElement;
    if (!viewport) {
      return;
    }

    let frameId: number | null = null;
    const syncViewportMetrics = () => {
      const nextRect = viewport.getBoundingClientRect();
      const nextWidth = Math.round(nextRect.width);
      const nextHeight = Math.round(nextRect.height);
      setPatchViewportMetrics((current) => {
        if (current.width === nextWidth && current.height === nextHeight) {
          return current;
        }
        const isVisible = nextWidth > 1 && nextHeight > 1;
        const wasVisible = current.width > 1 && current.height > 1;
        return {
          width: nextWidth,
          height: nextHeight,
          revision:
            isVisible &&
            (!wasVisible || nextWidth !== current.width || nextHeight !== current.height)
              ? current.revision + 1
              : current.revision,
        };
      });
    };
    const scheduleSyncViewportMetrics = () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        syncViewportMetrics();
      });
    };

    syncViewportMetrics();

    if (typeof ResizeObserver === "undefined") {
      return () => {
        if (frameId !== null) {
          window.cancelAnimationFrame(frameId);
        }
      };
    }

    const observer = new ResizeObserver(() => {
      scheduleSyncViewportMetrics();
    });
    observer.observe(viewport);

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      observer.disconnect();
    };
  }, [patchViewportElement]);

  useEffect(() => {
    if (diffSearch.diff !== "1") {
      return;
    }

    let firstFrameId: number | null = window.requestAnimationFrame(() => {
      firstFrameId = null;
      secondFrameId = window.requestAnimationFrame(() => {
        secondFrameId = null;
        setPatchViewportMetrics((current) => ({
          ...current,
          revision: current.revision + 1,
        }));
      });
    });
    let secondFrameId: number | null = null;

    return () => {
      if (firstFrameId !== null) {
        window.cancelAnimationFrame(firstFrameId);
      }
      if (secondFrameId !== null) {
        window.cancelAnimationFrame(secondFrameId);
      }
    };
  }, [diffSearch.diff, selectedFilePath, selectedTurnId]);

  useEffect(() => {
    if (!selectedFilePath || !patchViewportElement || !canRenderVirtualizedPatch) {
      return;
    }

    let frameId: number | null = null;
    let attempts = 0;

    const tryScroll = () => {
      if (
        scrollSelectedDiffFileIntoView({
          patchViewportElement,
          selectedFilePath,
        })
      ) {
        return;
      }
      if (attempts >= 6) {
        return;
      }
      attempts += 1;
      frameId = window.requestAnimationFrame(tryScroll);
    };

    frameId = window.requestAnimationFrame(tryScroll);

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [canRenderVirtualizedPatch, patchViewportElement, selectedFilePath, virtualizerRenderKey]);

  const openDiffFileInEditor = useCallback(
    (filePath: string) => {
      const api = readNativeApi();
      if (!api) return;
      const targetPath = activeCwd ? resolvePathLinkTarget(filePath, activeCwd) : filePath;
      void openInPreferredEditor(api, targetPath).catch((error) => {
        console.warn("Failed to open diff file in editor.", error);
      });
    },
    [activeCwd],
  );

  const selectTurn = (turnId: TurnId) => {
    if (!activeThread) return;
    void navigate({
      to: "/$threadId",
      params: { threadId: activeThread.id },
      search: (previous) => {
        const rest = stripDiffSearchParams(previous);
        return { ...rest, diff: "1", diffTurnId: turnId };
      },
    });
  };
  const selectWholeConversation = () => {
    if (!activeThread) return;
    void navigate({
      to: "/$threadId",
      params: { threadId: activeThread.id },
      search: (previous) => {
        const rest = stripDiffSearchParams(previous);
        return { ...rest, diff: "1" };
      },
    });
  };
  const updateTurnStripScrollState = useCallback(() => {
    const element = turnStripRef.current;
    if (!element) {
      setCanScrollTurnStripLeft(false);
      setCanScrollTurnStripRight(false);
      return;
    }

    const maxScrollLeft = Math.max(0, element.scrollWidth - element.clientWidth);
    setCanScrollTurnStripLeft(element.scrollLeft > 4);
    setCanScrollTurnStripRight(element.scrollLeft < maxScrollLeft - 4);
  }, []);
  const scrollTurnStripBy = useCallback((offset: number) => {
    const element = turnStripRef.current;
    if (!element) return;
    element.scrollBy({ left: offset, behavior: "smooth" });
  }, []);
  const onTurnStripWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    const element = turnStripRef.current;
    if (!element) return;
    if (element.scrollWidth <= element.clientWidth + 1) return;
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;

    event.preventDefault();
    element.scrollBy({ left: event.deltaY, behavior: "auto" });
  }, []);

  useEffect(() => {
    const element = turnStripRef.current;
    if (!element) return;

    const frameId = window.requestAnimationFrame(() => updateTurnStripScrollState());
    const onScroll = () => updateTurnStripScrollState();

    element.addEventListener("scroll", onScroll, { passive: true });

    const resizeObserver = new ResizeObserver(() => updateTurnStripScrollState());
    resizeObserver.observe(element);

    return () => {
      window.cancelAnimationFrame(frameId);
      element.removeEventListener("scroll", onScroll);
      resizeObserver.disconnect();
    };
  }, [updateTurnStripScrollState]);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => updateTurnStripScrollState());
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [orderedTurnDiffSummaries, selectedTurnId, updateTurnStripScrollState]);

  useEffect(() => {
    const element = turnStripRef.current;
    if (!element) return;

    const selectedChip = element.querySelector<HTMLElement>("[data-turn-chip-selected='true']");
    selectedChip?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [selectedTurn?.turnId, selectedTurnId]);

  const headerRow = (
    <>
      <div className="relative min-w-0 flex-1 [-webkit-app-region:no-drag]">
        {canScrollTurnStripLeft && (
          <div className="pointer-events-none absolute inset-y-0 left-8 z-10 w-7 bg-linear-to-r from-card to-transparent" />
        )}
        {canScrollTurnStripRight && (
          <div className="pointer-events-none absolute inset-y-0 right-8 z-10 w-7 bg-linear-to-l from-card to-transparent" />
        )}
        <button
          type="button"
          className={cn(
            "absolute left-0 top-1/2 z-20 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-md border bg-background/90 text-muted-foreground transition-colors",
            canScrollTurnStripLeft
              ? "border-border/70 hover:border-border hover:text-foreground"
              : "cursor-not-allowed border-border/40 text-muted-foreground/40",
          )}
          onClick={() => scrollTurnStripBy(-180)}
          disabled={!canScrollTurnStripLeft}
          aria-label="Scroll turn list left"
        >
          <ChevronLeftIcon className="size-3.5" />
        </button>
        <button
          type="button"
          className={cn(
            "absolute right-0 top-1/2 z-20 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-md border bg-background/90 text-muted-foreground transition-colors",
            canScrollTurnStripRight
              ? "border-border/70 hover:border-border hover:text-foreground"
              : "cursor-not-allowed border-border/40 text-muted-foreground/40",
          )}
          onClick={() => scrollTurnStripBy(180)}
          disabled={!canScrollTurnStripRight}
          aria-label="Scroll turn list right"
        >
          <ChevronRightIcon className="size-3.5" />
        </button>
        <div
          ref={turnStripRef}
          className="turn-chip-strip flex gap-1 overflow-x-auto px-8 py-0.5"
          onWheel={onTurnStripWheel}
        >
          <button
            type="button"
            className="shrink-0 rounded-md"
            onClick={selectWholeConversation}
            data-turn-chip-selected={selectedTurnId === null}
          >
            <div
              className={cn(
                "rounded-md border px-2 py-1 text-left transition-colors",
                selectedTurnId === null
                  ? "border-border bg-accent text-accent-foreground"
                  : "border-border/70 bg-background/70 text-muted-foreground/80 hover:border-border hover:text-foreground/80",
              )}
            >
              <div className="text-[10px] leading-tight font-medium">All turns</div>
            </div>
          </button>
          {orderedTurnDiffSummaries.map((summary) => {
            const isOpenable = isSummaryOpenable(summary);
            const isFallbackDiff =
              hasTurnDiffFallbackPatch(summary) && !isSummaryNavigable(summary);
            const chipButton = (
              <button
                key={summary.turnId}
                type="button"
                className="shrink-0 rounded-md"
                onClick={() => {
                  if (!isOpenable) {
                    return;
                  }
                  selectTurn(summary.turnId);
                }}
                title={summary.turnId}
                aria-disabled={!isOpenable || undefined}
                data-turn-chip-selected={summary.turnId === selectedTurnId}
              >
                <div
                  className={cn(
                    "rounded-md border px-2 py-1 text-left transition-colors",
                    summary.turnId === selectedTurnId
                      ? "border-border bg-accent text-accent-foreground"
                      : "border-border/70 bg-background/70 text-muted-foreground/80 hover:border-border hover:text-foreground/80",
                    !isOpenable &&
                      "cursor-not-allowed opacity-50 hover:border-border/70 hover:text-muted-foreground/80",
                  )}
                >
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] leading-tight font-medium">
                      Turn{" "}
                      {summary.checkpointTurnCount ??
                        inferredCheckpointTurnCountByTurnId[summary.turnId] ??
                        "?"}
                    </span>
                    <span className="text-[9px] leading-tight opacity-70">
                      {formatShortTimestamp(summary.completedAt, settings.timestampFormat)}
                    </span>
                  </div>
                </div>
              </button>
            );

            if (isOpenable) {
              if (!isFallbackDiff) {
                return chipButton;
              }
              return (
                <Tooltip key={`${summary.turnId}:provider-diff`}>
                  <TooltipTrigger render={chipButton} />
                  <TooltipPopup side="top">
                    Showing provider diff preview until checkpoint diff is ready.
                  </TooltipPopup>
                </Tooltip>
              );
            }

            return (
              <Tooltip key={`${summary.turnId}:unavailable`}>
                <TooltipTrigger render={chipButton} />
                <TooltipPopup side="top">
                  This turn diff is unavailable because the required checkpoint history is
                  incomplete.
                </TooltipPopup>
              </Tooltip>
            );
          })}
        </div>
      </div>
      <ToggleGroup
        className="shrink-0 [-webkit-app-region:no-drag]"
        variant="outline"
        size="xs"
        value={[diffRenderMode]}
        onValueChange={(value) => {
          const next = value[0];
          if (next === "stacked" || next === "split") {
            setDiffRenderMode(next);
          }
        }}
      >
        <Toggle aria-label="Stacked diff view" value="stacked">
          <Rows3Icon className="size-3" />
        </Toggle>
        <Toggle aria-label="Split diff view" value="split">
          <Columns2Icon className="size-3" />
        </Toggle>
      </ToggleGroup>
    </>
  );

  return (
    <DiffPanelShell mode={mode} header={headerRow}>
      {!activeThread ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
          Select a thread to inspect turn diffs.
        </div>
      ) : !isGitRepo ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
          Turn diffs are unavailable because this project is not a git repository.
        </div>
      ) : orderedTurnDiffSummaries.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
          No completed turns yet.
        </div>
      ) : (
        <>
          <div
            ref={setPatchViewportElement}
            className="diff-panel-viewport min-h-0 min-w-0 flex-1 overflow-hidden"
          >
            {checkpointDiffError && !renderablePatch && (
              <div className="px-3">
                <p className="mb-2 text-[11px] text-red-500/80">{checkpointDiffError}</p>
              </div>
            )}
            {!renderablePatch ? (
              isLoadingCheckpointDiff ? (
                <DiffPanelLoadingState label="Loading checkpoint diff..." />
              ) : (
                <div className="flex h-full items-center justify-center px-3 py-2 text-xs text-muted-foreground/70">
                  <p>
                    {selectedTurnUnavailableMessage
                      ? selectedTurnUnavailableMessage
                      : hasNoNetChanges
                        ? "No net changes in this selection."
                        : "No patch available for this selection."}
                  </p>
                </div>
              )
            ) : renderablePatch.kind === "files" && !canRenderVirtualizedPatch ? (
              <div className="flex h-full items-center justify-center px-3 py-2 text-xs text-muted-foreground/70">
                <p>Preparing diff viewer...</p>
              </div>
            ) : renderablePatch.kind === "files" ? (
              <Virtualizer
                key={virtualizerRenderKey}
                className="diff-render-surface h-full min-h-0 overflow-auto px-2 pb-2"
                config={{
                  overscrollSize: 600,
                  intersectionObserverMargin: 1200,
                }}
              >
                {renderableFiles.map((fileDiff) => {
                  const filePath = resolveFileDiffPath(fileDiff);
                  const fileKey = buildFileDiffRenderKey(fileDiff);
                  const themedFileKey = `${fileKey}:${resolvedTheme}`;
                  return (
                    <div
                      key={themedFileKey}
                      data-diff-file-path={filePath}
                      className="diff-render-file mb-2 rounded-md first:mt-2 last:mb-0"
                      onClickCapture={(event) => {
                        const nativeEvent = event.nativeEvent as MouseEvent;
                        const composedPath = nativeEvent.composedPath?.() ?? [];
                        const clickedHeader = composedPath.some((node) => {
                          if (!(node instanceof Element)) return false;
                          return node.hasAttribute("data-title");
                        });
                        if (!clickedHeader) return;
                        openDiffFileInEditor(filePath);
                      }}
                    >
                      <FileDiff
                        fileDiff={fileDiff}
                        options={{
                          diffStyle: diffRenderMode === "split" ? "split" : "unified",
                          lineDiffType: "none",
                          theme: resolveDiffThemeName(resolvedTheme),
                          themeType: resolvedTheme as DiffThemeType,
                          unsafeCSS: DIFF_PANEL_UNSAFE_CSS,
                        }}
                      />
                    </div>
                  );
                })}
              </Virtualizer>
            ) : (
              <div className="h-full overflow-auto p-2">
                <div className="space-y-2">
                  <p className="text-[11px] text-muted-foreground/75">{renderablePatch.reason}</p>
                  <pre className="max-h-[72vh] overflow-auto rounded-md border border-border/70 bg-background/70 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground/90">
                    {renderablePatch.text}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </DiffPanelShell>
  );
}

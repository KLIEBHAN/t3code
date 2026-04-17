import type { ServerCustomSlashCommand, ThreadId } from "@t3tools/contracts";
import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import {
  canBrowsePromptHistoryDown,
  canBrowsePromptHistoryUp,
  type ChatPromptHistory,
} from "../../chatPromptHistory";
import {
  collapseExpandedComposerCursor,
  detectComposerTrigger,
  expandCollapsedComposerCursor,
  type ComposerTrigger,
} from "../../composer-logic";

interface ComposerPromptSnapshot {
  value: string;
  cursor: number;
  expandedCursor: number;
  terminalContextIds: string[];
}

interface UseComposerPromptHistoryNavigationOptions {
  activeThreadId: ThreadId | null;
  customSlashCommands: readonly ServerCustomSlashCommand[];
  hasActivePendingProgress: boolean;
  promptHistory: ChatPromptHistory;
  promptRef: MutableRefObject<string>;
  readComposerSnapshot: () => ComposerPromptSnapshot;
  scheduleComposerFocus: () => void;
  setComposerCursor: (nextCursor: number) => void;
  setComposerHighlightedItemId: Dispatch<SetStateAction<string | null>>;
  setComposerTrigger: Dispatch<SetStateAction<ComposerTrigger | null>>;
  setPrompt: (nextPrompt: string) => void;
  showPlanFollowUpPrompt: boolean;
}

export function useComposerPromptHistoryNavigation(
  options: UseComposerPromptHistoryNavigationOptions,
) {
  const applyPromptHistorySelection = useCallback(
    (nextPrompt: string) => {
      options.promptRef.current = nextPrompt;
      options.setPrompt(nextPrompt);
      const nextCursor = collapseExpandedComposerCursor(nextPrompt, nextPrompt.length);
      options.setComposerCursor(nextCursor);
      options.setComposerTrigger(
        detectComposerTrigger(
          nextPrompt,
          expandCollapsedComposerCursor(nextPrompt, nextCursor),
          options.customSlashCommands,
        ),
      );
      options.setComposerHighlightedItemId(null);
      options.scheduleComposerFocus();
    },
    [options],
  );

  const replaceComposerPrompt = useCallback(
    (nextPrompt: string) => {
      if (options.activeThreadId) {
        options.promptHistory.resetBrowsing(options.activeThreadId);
      }
      applyPromptHistorySelection(nextPrompt);
    },
    [applyPromptHistorySelection, options],
  );

  const handlePromptHistoryKey = useCallback(
    (key: "ArrowUp" | "ArrowDown", event: KeyboardEvent): boolean => {
      if (
        !options.activeThreadId ||
        event.shiftKey ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        options.hasActivePendingProgress ||
        options.showPlanFollowUpPrompt
      ) {
        return false;
      }

      const snapshot = options.readComposerSnapshot();
      const isBrowsing = options.promptHistory.isBrowsing(options.activeThreadId);
      const canNavigateUp =
        key === "ArrowUp" &&
        canBrowsePromptHistoryUp({
          isBrowsing,
          snapshot,
        });
      const canNavigateDown =
        key === "ArrowDown" &&
        canBrowsePromptHistoryDown({
          isBrowsing,
          snapshot,
        });
      if (!canNavigateUp && !canNavigateDown) {
        return false;
      }

      const nextPrompt = options.promptHistory.browse(
        options.activeThreadId,
        key === "ArrowUp" ? "up" : "down",
        snapshot.value,
      );
      if (nextPrompt === null) {
        return false;
      }

      applyPromptHistorySelection(nextPrompt);
      return true;
    },
    [applyPromptHistorySelection, options],
  );

  return {
    applyPromptHistorySelection,
    handlePromptHistoryKey,
    replaceComposerPrompt,
  };
}

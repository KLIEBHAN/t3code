import { type ThreadId } from "@t3tools/contracts";

const MAX_PROMPT_HISTORY_ENTRIES = 50;

type HistoryDirection = "up" | "down";

export interface PromptHistoryCursorSnapshot {
  value: string;
  cursor: number;
}

interface PromptHistoryBrowseState {
  draft: string;
  index: number;
}

export interface ChatPromptHistory {
  browse: (threadId: ThreadId, direction: HistoryDirection, currentDraft: string) => string | null;
  isBrowsing: (threadId: ThreadId) => boolean;
  recordPrompt: (threadId: ThreadId, prompt: string) => void;
  resetBrowsing: (threadId: ThreadId) => void;
}

export function canBrowsePromptHistoryUp(snapshot: PromptHistoryCursorSnapshot): boolean {
  return snapshot.value.length === 0 || snapshot.cursor <= 0;
}

export function canBrowsePromptHistoryDown(options: {
  isBrowsing: boolean;
  snapshot: PromptHistoryCursorSnapshot;
}): boolean {
  return options.isBrowsing && options.snapshot.cursor >= options.snapshot.value.length;
}

export function createChatPromptHistory(): ChatPromptHistory {
  const entriesByThreadId = new Map<ThreadId, string[]>();
  const browseStateByThreadId = new Map<ThreadId, PromptHistoryBrowseState>();

  return {
    browse(threadId, direction, currentDraft) {
      const history = entriesByThreadId.get(threadId);
      if (!history || history.length === 0) {
        return null;
      }

      const existingState = browseStateByThreadId.get(threadId);
      if (direction === "up") {
        if (!existingState) {
          const firstIndex = history.length - 1;
          browseStateByThreadId.set(threadId, {
            draft: currentDraft,
            index: firstIndex,
          });
          return history[firstIndex] ?? null;
        }

        const nextIndex = Math.max(0, existingState.index - 1);
        if (nextIndex !== existingState.index) {
          browseStateByThreadId.set(threadId, {
            ...existingState,
            index: nextIndex,
          });
        }
        return history[nextIndex] ?? null;
      }

      if (!existingState) {
        return null;
      }

      const nextIndex = existingState.index + 1;
      if (nextIndex >= history.length) {
        browseStateByThreadId.delete(threadId);
        return existingState.draft;
      }

      browseStateByThreadId.set(threadId, {
        ...existingState,
        index: nextIndex,
      });
      return history[nextIndex] ?? null;
    },

    isBrowsing(threadId) {
      return browseStateByThreadId.has(threadId);
    },

    recordPrompt(threadId, prompt) {
      const normalizedPrompt = prompt.trim();
      if (normalizedPrompt.length === 0) {
        browseStateByThreadId.delete(threadId);
        return;
      }

      const existingHistory = entriesByThreadId.get(threadId) ?? [];
      const lastPrompt = existingHistory[existingHistory.length - 1];
      if (lastPrompt === normalizedPrompt) {
        browseStateByThreadId.delete(threadId);
        return;
      }

      entriesByThreadId.set(threadId, [
        ...existingHistory.slice(-(MAX_PROMPT_HISTORY_ENTRIES - 1)),
        normalizedPrompt,
      ]);
      browseStateByThreadId.delete(threadId);
    },

    resetBrowsing(threadId) {
      browseStateByThreadId.delete(threadId);
    },
  };
}

import { type ThreadId } from "@t3tools/contracts";
import { getSafeLocalStorage } from "./lib/browserStorage";

const MAX_PROMPT_HISTORY_ENTRIES = 50;
const PROMPT_HISTORY_STORAGE_KEY = "t3code:prompt-history:v1";

type HistoryDirection = "up" | "down";

export interface PromptHistoryCursorSnapshot {
  value: string;
  cursor: number;
}

interface PromptHistoryBrowseState {
  draft: string;
  index: number;
}

interface PersistedPromptHistoryState {
  entriesByThreadId: Record<string, string[]>;
}

export interface ChatPromptHistory {
  browse: (threadId: ThreadId, direction: HistoryDirection, currentDraft: string) => string | null;
  isBrowsing: (threadId: ThreadId) => boolean;
  recordPrompt: (threadId: ThreadId, prompt: string) => void;
  resetBrowsing: (threadId: ThreadId) => void;
}

export function canBrowsePromptHistoryUp(options: {
  isBrowsing: boolean;
  snapshot: PromptHistoryCursorSnapshot;
}): boolean {
  const { isBrowsing, snapshot } = options;
  if (snapshot.value.length === 0 || snapshot.cursor <= 0) {
    return true;
  }
  return isBrowsing && snapshot.cursor >= snapshot.value.length;
}

export function canBrowsePromptHistoryDown(options: {
  isBrowsing: boolean;
  snapshot: PromptHistoryCursorSnapshot;
}): boolean {
  return options.isBrowsing && options.snapshot.cursor >= options.snapshot.value.length;
}

function normalizePersistedPromptEntries(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object") {
    return {};
  }

  const candidate = value as Partial<PersistedPromptHistoryState>;
  if (!candidate.entriesByThreadId || typeof candidate.entriesByThreadId !== "object") {
    return {};
  }

  const normalizedEntries: Record<string, string[]> = {};

  for (const [threadId, entries] of Object.entries(candidate.entriesByThreadId)) {
    if (threadId.length === 0 || !Array.isArray(entries)) {
      continue;
    }

    const normalizedHistory = entries
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .slice(-MAX_PROMPT_HISTORY_ENTRIES);

    if (normalizedHistory.length > 0) {
      normalizedEntries[threadId] = normalizedHistory;
    }
  }

  return normalizedEntries;
}

function loadPersistedPromptHistory(): Map<ThreadId, string[]> {
  const storage = getSafeLocalStorage();
  const raw = storage.getItem(PROMPT_HISTORY_STORAGE_KEY);
  if (!raw) {
    return new Map();
  }

  try {
    const parsed = JSON.parse(raw);
    return new Map(
      Object.entries(normalizePersistedPromptEntries(parsed)).map(([threadId, history]) => [
        threadId as ThreadId,
        history,
      ]),
    );
  } catch {
    return new Map();
  }
}

function persistPromptHistory(entriesByThreadId: Map<ThreadId, string[]>): void {
  const persisted: PersistedPromptHistoryState = {
    entriesByThreadId: Object.fromEntries(entriesByThreadId),
  };

  getSafeLocalStorage().setItem(PROMPT_HISTORY_STORAGE_KEY, JSON.stringify(persisted));
}

export function createChatPromptHistory(): ChatPromptHistory {
  const entriesByThreadId = loadPersistedPromptHistory();
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
      persistPromptHistory(entriesByThreadId);
      browseStateByThreadId.delete(threadId);
    },

    resetBrowsing(threadId) {
      browseStateByThreadId.delete(threadId);
    },
  };
}

import { type ThreadId } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  canBrowsePromptHistoryDown,
  canBrowsePromptHistoryUp,
  createChatPromptHistory,
  shouldResetPromptHistoryBrowsing,
} from "./chatPromptHistory";

const THREAD_ID_1 = "thread-1" as ThreadId;

function createTestStorage(): Storage {
  const entries = new Map<string, string>();

  return {
    get length() {
      return entries.size;
    },
    clear() {
      entries.clear();
    },
    getItem(key) {
      return entries.get(key) ?? null;
    },
    key(index) {
      return Array.from(entries.keys())[index] ?? null;
    },
    removeItem(key) {
      entries.delete(key);
    },
    setItem(key, value) {
      entries.set(key, String(value));
    },
  };
}

const originalLocalStorage = globalThis.localStorage;

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: createTestStorage(),
  });
});

afterEach(() => {
  if (originalLocalStorage === undefined) {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  } else {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: originalLocalStorage,
    });
  }
  vi.restoreAllMocks();
});

describe("chatPromptHistory", () => {
  it("browses backward and forward through prompt history before restoring the draft", () => {
    const history = createChatPromptHistory();

    history.recordPrompt(THREAD_ID_1, "first prompt");
    history.recordPrompt(THREAD_ID_1, "second prompt");
    history.recordPrompt(THREAD_ID_1, "third prompt");

    expect(
      canBrowsePromptHistoryUp({
        isBrowsing: history.isBrowsing(THREAD_ID_1),
        snapshot: { value: "", cursor: 0 },
      }),
    ).toBe(true);

    expect(history.browse(THREAD_ID_1, "up", "draft text")).toBe("third prompt");
    expect(history.browse(THREAD_ID_1, "up", "draft text")).toBe("second prompt");

    expect(
      canBrowsePromptHistoryDown({
        isBrowsing: history.isBrowsing(THREAD_ID_1),
        snapshot: { value: "second prompt", cursor: "second prompt".length },
      }),
    ).toBe(true);

    expect(history.browse(THREAD_ID_1, "down", "ignored draft")).toBe("third prompt");
    expect(history.browse(THREAD_ID_1, "down", "ignored draft")).toBe("draft text");
    expect(history.isBrowsing(THREAD_ID_1)).toBe(false);
  });

  it("does not reset browsing when only the cursor changes", () => {
    expect(
      shouldResetPromptHistoryBrowsing({
        previousPrompt: "third prompt",
        nextPrompt: "third prompt",
        previousTerminalContextIds: [],
        nextTerminalContextIds: [],
      }),
    ).toBe(false);
  });

  it("resets browsing when the prompt text or terminal contexts change", () => {
    expect(
      shouldResetPromptHistoryBrowsing({
        previousPrompt: "third prompt",
        nextPrompt: "changed prompt",
        previousTerminalContextIds: [],
        nextTerminalContextIds: [],
      }),
    ).toBe(true);

    expect(
      shouldResetPromptHistoryBrowsing({
        previousPrompt: "third prompt",
        nextPrompt: "third prompt",
        previousTerminalContextIds: ["ctx-1"],
        nextTerminalContextIds: ["ctx-1", "ctx-2"],
      }),
    ).toBe(true);
  });
});

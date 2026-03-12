import { type ThreadId } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  canBrowsePromptHistoryDown,
  canBrowsePromptHistoryUp,
  createChatPromptHistory,
} from "./chatPromptHistory";

const THREAD_ID_1 = "thread-1" as ThreadId;
const THREAD_ID_2 = "thread-2" as ThreadId;

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
  it("browses backward through prompts and restores the draft when moving past the newest entry", () => {
    const history = createChatPromptHistory();

    history.recordPrompt(THREAD_ID_1, "first prompt");
    history.recordPrompt(THREAD_ID_1, "second prompt");

    expect(history.browse(THREAD_ID_1, "up", "draft text")).toBe("second prompt");
    expect(history.browse(THREAD_ID_1, "up", "ignored draft")).toBe("first prompt");
    expect(history.browse(THREAD_ID_1, "down", "ignored draft")).toBe("second prompt");
    expect(history.browse(THREAD_ID_1, "down", "ignored draft")).toBe("draft text");
    expect(history.isBrowsing(THREAD_ID_1)).toBe(false);
  });

  it("deduplicates consecutive prompts and keeps thread histories isolated", () => {
    const history = createChatPromptHistory();

    history.recordPrompt(THREAD_ID_1, "same prompt");
    history.recordPrompt(THREAD_ID_1, "same prompt");
    history.recordPrompt(THREAD_ID_2, "other prompt");

    expect(history.browse(THREAD_ID_1, "up", "")).toBe("same prompt");
    expect(history.browse(THREAD_ID_1, "up", "")).toBe("same prompt");
    expect(history.browse(THREAD_ID_2, "up", "")).toBe("other prompt");
  });

  it("allows continuing backward through history from the end of a recalled multiline prompt", () => {
    const history = createChatPromptHistory();

    history.recordPrompt(THREAD_ID_1, "older prompt");
    history.recordPrompt(THREAD_ID_1, "line 1\nline 2");

    expect(
      canBrowsePromptHistoryUp({
        isBrowsing: history.isBrowsing(THREAD_ID_1),
        snapshot: { value: "", cursor: 0 },
      }),
    ).toBe(true);

    const latestPrompt = history.browse(THREAD_ID_1, "up", "");
    expect(latestPrompt).toBe("line 1\nline 2");
    expect(history.isBrowsing(THREAD_ID_1)).toBe(true);

    expect(
      canBrowsePromptHistoryUp({
        isBrowsing: history.isBrowsing(THREAD_ID_1),
        snapshot: {
          value: latestPrompt ?? "",
          cursor: (latestPrompt ?? "").length,
        },
      }),
    ).toBe(true);

    expect(history.browse(THREAD_ID_1, "up", latestPrompt ?? "")).toBe("older prompt");
  });

  it("only allows history navigation at the prompt boundaries", () => {
    expect(
      canBrowsePromptHistoryUp({
        isBrowsing: false,
        snapshot: { value: "", cursor: 0 },
      }),
    ).toBe(true);
    expect(
      canBrowsePromptHistoryUp({
        isBrowsing: false,
        snapshot: { value: "line 1\nline 2", cursor: 0 },
      }),
    ).toBe(true);
    expect(
      canBrowsePromptHistoryUp({
        isBrowsing: false,
        snapshot: { value: "line 1\nline 2", cursor: 7 },
      }),
    ).toBe(false);
    expect(
      canBrowsePromptHistoryUp({
        isBrowsing: true,
        snapshot: { value: "line 1\nline 2", cursor: "line 1\nline 2".length },
      }),
    ).toBe(true);
    expect(
      canBrowsePromptHistoryUp({
        isBrowsing: true,
        snapshot: { value: "line 1\nline 2", cursor: 7 },
      }),
    ).toBe(false);

    expect(
      canBrowsePromptHistoryDown({
        isBrowsing: true,
        snapshot: { value: "line 1\nline 2", cursor: "line 1\nline 2".length },
      }),
    ).toBe(true);
    expect(
      canBrowsePromptHistoryDown({
        isBrowsing: true,
        snapshot: { value: "line 1\nline 2", cursor: 7 },
      }),
    ).toBe(false);
    expect(
      canBrowsePromptHistoryDown({
        isBrowsing: false,
        snapshot: { value: "line 1\nline 2", cursor: "line 1\nline 2".length },
      }),
    ).toBe(false);
  });

  it("persists prompt entries across history instances without persisting browsing state", () => {
    const history = createChatPromptHistory();

    history.recordPrompt(THREAD_ID_1, "first prompt");
    history.recordPrompt(THREAD_ID_1, "second prompt");
    expect(history.browse(THREAD_ID_1, "up", "draft before reload")).toBe("second prompt");
    expect(history.isBrowsing(THREAD_ID_1)).toBe(true);

    const reloadedHistory = createChatPromptHistory();

    expect(reloadedHistory.isBrowsing(THREAD_ID_1)).toBe(false);
    expect(reloadedHistory.browse(THREAD_ID_1, "down", "ignored draft")).toBe(null);
    expect(reloadedHistory.browse(THREAD_ID_1, "up", "")).toBe("second prompt");
    expect(reloadedHistory.browse(THREAD_ID_1, "up", "")).toBe("first prompt");
  });

  it("ignores malformed persisted prompt history payloads", () => {
    globalThis.localStorage.setItem("t3code:prompt-history:v1", "{not-json");
    expect(() => createChatPromptHistory()).not.toThrow();
    expect(createChatPromptHistory().browse(THREAD_ID_1, "up", "")).toBe(null);

    globalThis.localStorage.setItem(
      "t3code:prompt-history:v1",
      JSON.stringify({
        entriesByThreadId: {
          [THREAD_ID_1]: ["  valid prompt  ", "", 123, null],
          "": ["ignored"],
        },
      }),
    );

    const history = createChatPromptHistory();
    expect(history.browse(THREAD_ID_1, "up", "")).toBe("valid prompt");
  });
});

import { type ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  canBrowsePromptHistoryDown,
  canBrowsePromptHistoryUp,
  createChatPromptHistory,
} from "./chatPromptHistory";

const THREAD_ID_1 = "thread-1" as ThreadId;
const THREAD_ID_2 = "thread-2" as ThreadId;

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

  it("only allows history navigation at the prompt boundaries", () => {
    expect(canBrowsePromptHistoryUp({ value: "", cursor: 0 })).toBe(true);
    expect(canBrowsePromptHistoryUp({ value: "line 1\nline 2", cursor: 0 })).toBe(true);
    expect(canBrowsePromptHistoryUp({ value: "line 1\nline 2", cursor: 7 })).toBe(false);

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
});

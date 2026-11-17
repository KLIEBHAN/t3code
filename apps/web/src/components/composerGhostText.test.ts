import { describe, expect, it } from "vite-plus/test";

import { composerGhostRemainder, nextComposerGhostWord } from "./composerGhostText";

describe("composerGhostRemainder", () => {
  it("returns the rest while the draft is the suggestion's start", () => {
    expect(composerGhostRemainder("Run the", "Run the tests again")).toBe(" tests again");
  });

  it("leaves an empty draft to the placeholder", () => {
    expect(composerGhostRemainder("", "Run the tests")).toBeNull();
  });

  it("has nothing once the draft leaves the suggestion or covers it", () => {
    expect(composerGhostRemainder("Run a", "Run the tests")).toBeNull();
    expect(composerGhostRemainder("Run the tests", "Run the tests")).toBeNull();
    expect(composerGhostRemainder("Run the tests now", "Run the tests")).toBeNull();
    expect(composerGhostRemainder("run", "Run the tests")).toBeNull();
  });

  it("has nothing without a suggestion", () => {
    expect(composerGhostRemainder("Run", null)).toBeNull();
  });
});

describe("nextComposerGhostWord", () => {
  it("takes the next word with the whitespace before it", () => {
    expect(nextComposerGhostWord(" tests again")).toBe(" tests");
    expect(nextComposerGhostWord("he tests")).toBe("he");
    expect(nextComposerGhostWord("\nnext line")).toBe("\nnext");
  });

  it("takes trailing whitespace whole", () => {
    expect(nextComposerGhostWord("  ")).toBe("  ");
  });
});

describe("draftCompletionContext", () => {
  it("keeps the start and the end of a long message, within the extension's limits", async () => {
    const { draftCompletionContext } = await import("./chat/useDraftCompletion");
    const assistant = `RESULT ${"x".repeat(2_000)}${"y".repeat(3_000)} LAST`;
    const context = draftCompletionContext({
      lastUser: "short question",
      lastAssistant: assistant,
      earlier: [
        { role: "assistant", text: `  ${"e".repeat(2_000)}`, runId: "r0", streaming: false },
      ],
    });
    expect(context.lastUser).toBe("short question");
    expect(context.lastAssistant).toBe(`RESULT ${"x".repeat(1_492)}\n…\n${"y".repeat(1_493)} LAST`);
    expect(context.recent).toEqual([{ role: "assistant", text: "e".repeat(1_200) }]);
    expect(
      draftCompletionContext({ lastUser: undefined, lastAssistant: undefined, earlier: [] }),
    ).toEqual({});
  });
});

describe("latestExchange", () => {
  const message = (role: string, text: string, runId: string | null, streaming = false) => ({
    role,
    text,
    runId,
    streaming,
  });

  it("pairs the latest finished answer with its run's user message, after the earlier final answers", async () => {
    const { latestExchange } = await import("./chat/useDraftCompletion");
    expect(
      latestExchange([
        message("user", "first", "r1"),
        message("assistant", "checking files", "r1"),
        message("assistant", "answer 1", "r1"),
        message("user", "second", "r2"),
        message("assistant", "answer 2", "r2"),
        message("assistant", "still writing", "r3", true),
      ]),
    ).toEqual({
      lastUser: "second",
      lastAssistant: "answer 2",
      earlier: [message("user", "first", "r1"), message("assistant", "answer 1", "r1")],
    });
  });

  it("keeps an older user message among the earlier ones when a subagent started the run", async () => {
    const { latestExchange } = await import("./chat/useDraftCompletion");
    expect(
      latestExchange([
        message("user", "I answer 48 to 50 later", "r96"),
        message("assistant", "answer 96", "r96"),
        message("assistant", "answer 99, decide 50 to 52", "r99"),
      ]),
    ).toEqual({
      lastUser: undefined,
      lastAssistant: "answer 99, decide 50 to 52",
      earlier: [
        message("user", "I answer 48 to 50 later", "r96"),
        message("assistant", "answer 96", "r96"),
      ],
    });
  });

  it("keeps the newest six earlier messages and none before the first answer", async () => {
    const { latestExchange } = await import("./chat/useDraftCompletion");
    const runs = Array.from({ length: 5 }, (_, index) => [
      message("user", `q${index}`, `r${index}`),
      message("assistant", `a${index}`, `r${index}`),
    ]).flat();
    expect(latestExchange(runs).earlier.map(({ text }) => text)).toEqual([
      "q1",
      "a1",
      "q2",
      "a2",
      "q3",
      "a3",
    ]);
    expect(latestExchange([message("user", "only", "r1")]).earlier).toEqual([]);
  });
});

describe("turnItemMessages", () => {
  it("keeps user and assistant messages with their text, run, and streaming state", async () => {
    const { turnItemMessages } = await import("./chat/useDraftCompletion");
    const projected = (item: Record<string, unknown>) => ({ item }) as never;
    expect(
      turnItemMessages([
        projected({ type: "user_message", text: "question", runId: "r1" }),
        projected({ type: "tool_call", runId: "r1" }),
        projected({ type: "assistant_message", text: "answer", runId: "r1", streaming: false }),
        projected({ type: "assistant_message", text: "still", runId: "r2", streaming: true }),
      ]),
    ).toEqual([
      { role: "user", text: "question", runId: "r1", streaming: false },
      { role: "assistant", text: "answer", runId: "r1", streaming: false },
      { role: "assistant", text: "still", runId: "r2", streaming: true },
    ]);
  });
});

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
    const context = draftCompletionContext("short question", assistant);
    expect(context.lastUser).toBe("short question");
    expect(context.lastAssistant).toBe(`RESULT ${"x".repeat(1_492)}\n…\n${"y".repeat(1_493)} LAST`);
    expect(draftCompletionContext(undefined, undefined)).toEqual({});
  });
});

describe("latestExchange", () => {
  const message = (role: string, text: string, runId: string | null, streaming = false) => ({
    role,
    text,
    runId,
    streaming,
  });

  it("pairs the latest finished answer with the user message of its run", async () => {
    const { latestExchange } = await import("./chat/useDraftCompletion");
    expect(
      latestExchange([
        message("user", "first", "r1"),
        message("assistant", "answer 1", "r1"),
        message("user", "second", "r2"),
        message("assistant", "answer 2", "r2"),
        message("assistant", "still writing", "r3", true),
      ]),
    ).toEqual({ lastUser: "second", lastAssistant: "answer 2" });
  });

  it("sends no older user message when a subagent or scheduled task started the run", async () => {
    const { latestExchange } = await import("./chat/useDraftCompletion");
    expect(
      latestExchange([
        message("user", "I answer 48 to 50 later", "r96"),
        message("assistant", "answer 96", "r96"),
        message("assistant", "answer 99, decide 50 to 52", "r99"),
      ]),
    ).toEqual({ lastUser: undefined, lastAssistant: "answer 99, decide 50 to 52" });
  });
});

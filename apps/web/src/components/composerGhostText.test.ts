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
    const assistant = `RESULT ${"x".repeat(5_000)} LAST`;
    const context = draftCompletionContext("short question", assistant);
    expect(context.lastUser).toBe("short question");
    expect(context.lastAssistant?.length).toBe(3_000);
    expect(context.lastAssistant?.startsWith("RESULT ")).toBe(true);
    expect(context.lastAssistant?.endsWith(" LAST")).toBe(true);
    expect(draftCompletionContext(undefined, undefined)).toEqual({});
  });
});

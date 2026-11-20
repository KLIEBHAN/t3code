// Fork: unit tests for mobile composer suggestion helpers.
import { type ProviderInstanceId, type RunId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  composerSuggestionRemainder,
  draftCompletionContext,
  formatSuggestionPreview,
  latestExchange,
  nextComposerSuggestionWord,
  offeredPromptSuggestion,
  resolveDraftCompletionModel,
} from "./composerSuggestions";

describe("composerSuggestionRemainder", () => {
  it("returns the full suggestion when the draft is empty", () => {
    expect(composerSuggestionRemainder("", "Run the tests")).toBe("Run the tests");
  });

  it("returns the suffix while the draft prefixes the suggestion", () => {
    expect(composerSuggestionRemainder("Run ", "Run the tests")).toBe("the tests");
    expect(composerSuggestionRemainder("Run th", "Run the tests")).toBe("e tests");
  });

  it("returns null when the draft equals or diverges from the suggestion", () => {
    expect(composerSuggestionRemainder("Run the tests", "Run the tests")).toBeNull();
    expect(composerSuggestionRemainder("Fix", "Run the tests")).toBeNull();
    expect(composerSuggestionRemainder("Run", null)).toBeNull();
  });
});

describe("nextComposerSuggestionWord", () => {
  it("takes leading whitespace together with the next word", () => {
    expect(nextComposerSuggestionWord(" the unit tests")).toBe(" the");
    expect(nextComposerSuggestionWord("e tests")).toBe("e");
    expect(nextComposerSuggestionWord("tests")).toBe("tests");
  });
});

describe("formatSuggestionPreview", () => {
  it("keeps an unfinished word prefix muted for mid-word completions", () => {
    expect(formatSuggestionPreview("Fix the te", "Fix the tests in auth.ts")).toEqual({
      prefix: "te",
      remainder: "sts in auth.ts",
    });
  });

  it("shows only the new words after a space boundary", () => {
    expect(formatSuggestionPreview("Fix ", "Fix the tests")).toEqual({
      prefix: "",
      remainder: "the tests",
    });
    expect(formatSuggestionPreview("Fix", "Fix the tests")).toEqual({
      prefix: "",
      remainder: "the tests",
    });
  });

  it("returns null for whitespace-only remainders", () => {
    expect(formatSuggestionPreview("Fix", "Fix   ")).toBeNull();
    expect(formatSuggestionPreview("", "   ")).toBeNull();
  });
});

describe("resolveDraftCompletionModel", () => {
  const instance = "pi" as ProviderInstanceId;

  it("prefers the configured Labs model over the thread model", () => {
    expect(
      resolveDraftCompletionModel({
        serverSettings: {
          draftCompletionInstanceId: "pi-fast",
          draftCompletionModel: "cpa/cpa-small",
        },
        selectedProviderDriver: "pi",
        selectedModelSelection: { instanceId: instance, model: "cpa/cpa-pro" },
      }),
    ).toEqual({ instanceId: "pi-fast", model: "cpa/cpa-small" });
  });

  it("falls back to the thread's Pi model and otherwise leaves the choice to the server", () => {
    expect(
      resolveDraftCompletionModel({
        serverSettings: { draftCompletionInstanceId: "", draftCompletionModel: "" },
        selectedProviderDriver: "pi",
        selectedModelSelection: { instanceId: instance, model: "cpa/cpa-worker-plus" },
      }),
    ).toEqual({ instanceId: "pi", model: "cpa/cpa-worker-plus" });

    expect(
      resolveDraftCompletionModel({
        serverSettings: null,
        selectedProviderDriver: "codex",
        selectedModelSelection: { instanceId: instance, model: "gpt-5" },
      }),
    ).toBeUndefined();
  });
});

describe("latestExchange and draftCompletionContext", () => {
  it("extracts the latest finished run and keeps only final answers among earlier turns", () => {
    const exchange = latestExchange([
      { role: "user", text: "First question", runId: "r1", streaming: false },
      { role: "assistant", text: "Narration", runId: "r1", streaming: false },
      { role: "assistant", text: "First answer", runId: "r1", streaming: false },
      { role: "user", text: "Second question", runId: "r2", streaming: false },
      { role: "assistant", text: "Second answer", runId: "r2", streaming: false },
      { role: "assistant", text: "Streaming...", runId: "r3", streaming: true },
    ]);
    expect(draftCompletionContext(exchange)).toEqual({
      lastUser: "Second question",
      lastAssistant: "Second answer",
      recent: [
        { role: "user", text: "First question" },
        { role: "assistant", text: "First answer" },
      ],
    });
  });

  it("omits lastUser when the latest run had no user message", () => {
    const exchange = latestExchange([
      { role: "user", text: "Old question", runId: "r1", streaming: false },
      { role: "assistant", text: "Old answer", runId: "r1", streaming: false },
      { role: "assistant", text: "Scheduled summary", runId: "r2", streaming: false },
    ]);
    expect(draftCompletionContext(exchange)).toEqual({
      lastAssistant: "Scheduled summary",
      recent: [
        { role: "user", text: "Old question" },
        { role: "assistant", text: "Old answer" },
      ],
    });
  });
});

describe("offeredPromptSuggestion", () => {
  it("offers the suggestion only when its run is the latest completed run", () => {
    const runId = "run-2" as RunId;
    const suggestion = { runId, text: "Push and open a PR" };
    expect(
      offeredPromptSuggestion(
        suggestion,
        {
          runId,
          status: "completed",
          startedAt: "2026-11-20T10:00:00Z",
        },
        [],
      ),
    ).toEqual(suggestion);
    expect(
      offeredPromptSuggestion(
        suggestion,
        {
          runId: "run-3" as RunId,
          status: "running",
          startedAt: "2026-11-20T10:02:00Z",
        },
        [],
      ),
    ).toBeNull();
  });
});

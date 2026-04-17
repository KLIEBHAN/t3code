import { describe, expect, it } from "vitest";

import {
  findMatchingSlashCommands,
  hasSlashCommandPrefix,
  parseStandaloneSlashCommand,
} from "./slashCommands";

describe("findMatchingSlashCommands", () => {
  it("returns built-in slash commands for an empty query", () => {
    expect(findMatchingSlashCommands("").map((command) => command.id)).toEqual([
      "model",
      "review",
      "compact",
      "plan",
      "default",
      "new",
      "new-local",
      "terminal",
      "diff",
      "editor",
      "init",
    ]);
  });

  it("matches aliases and search terms", () => {
    expect(findMatchingSlashCommands("open").map((command) => command.id)).toEqual(["editor"]);
    expect(findMatchingSlashCommands("worktree").map((command) => command.id)).toEqual([
      "new-local",
    ]);
    expect(findMatchingSlashCommands("handoff").map((command) => command.id)).toContain("compact");
    expect(findMatchingSlashCommands("git").map((command) => command.id)).toContain("init");
  });
});

describe("hasSlashCommandPrefix", () => {
  it("accepts partial prefixes for known commands", () => {
    expect(hasSlashCommandPrefix("pl")).toBe(true);
    expect(hasSlashCommandPrefix("rev")).toBe(true);
    expect(hasSlashCommandPrefix("comp")).toBe(true);
    expect(hasSlashCommandPrefix("new-l")).toBe(true);
    expect(hasSlashCommandPrefix("zzz")).toBe(false);
  });
});

describe("parseStandaloneSlashCommand", () => {
  it("parses standalone execute commands", () => {
    expect(parseStandaloneSlashCommand("/terminal")).toBe("terminal");
    expect(parseStandaloneSlashCommand(" /new-local ")).toBe("new-local");
    expect(parseStandaloneSlashCommand("/review")).toBe("review");
    expect(parseStandaloneSlashCommand("/compact")).toBe("compact");
    expect(parseStandaloneSlashCommand("/init")).toBe("init");
  });

  it("accepts aliases for execute commands", () => {
    expect(parseStandaloneSlashCommand("/open")).toBe("editor");
  });

  it("rejects commands that require arguments or trailing text", () => {
    expect(parseStandaloneSlashCommand("/model")).toBeNull();
    expect(parseStandaloneSlashCommand("/new now")).toBeNull();
  });
});

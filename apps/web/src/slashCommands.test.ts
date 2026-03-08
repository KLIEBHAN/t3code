import { describe, expect, it } from "vitest";

import {
  findMatchingSlashCommands,
  hasSlashCommandPrefix,
  parseStandaloneSlashCommand,
} from "./slashCommands";

const CUSTOM_COMMANDS = [
  {
    command: "deploy",
    description: "Deploy the current project",
    prompt: "# Deploy\nRun the deployment workflow for this repo.",
    sourcePath: "/tmp/slash-commands/deploy.md",
  },
] as const;

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

  it("includes custom commands in search results", () => {
    expect(findMatchingSlashCommands("deploy", CUSTOM_COMMANDS).map((command) => command.id)).toEqual([
      "custom:deploy",
    ]);
    expect(
      findMatchingSlashCommands("current project", CUSTOM_COMMANDS).map((command) => command.id),
    ).toContain("custom:deploy");
  });
});

describe("hasSlashCommandPrefix", () => {
  it("accepts partial prefixes for known commands", () => {
    expect(hasSlashCommandPrefix("pl")).toBe(true);
    expect(hasSlashCommandPrefix("rev")).toBe(true);
    expect(hasSlashCommandPrefix("comp")).toBe(true);
    expect(hasSlashCommandPrefix("new-l")).toBe(true);
    expect(hasSlashCommandPrefix("op")).toBe(true);
    expect(hasSlashCommandPrefix("ter")).toBe(true);
    expect(hasSlashCommandPrefix("cha")).toBe(true);
    expect(hasSlashCommandPrefix("zzz")).toBe(false);
  });

  it("accepts custom command prefixes", () => {
    expect(hasSlashCommandPrefix("dep", CUSTOM_COMMANDS)).toBe(true);
  });
});

describe("parseStandaloneSlashCommand", () => {
  it("parses standalone execute commands", () => {
    expect(parseStandaloneSlashCommand("/terminal")?.id).toBe("terminal");
    expect(parseStandaloneSlashCommand(" /new-local ")?.id).toBe("new-local");
    expect(parseStandaloneSlashCommand("/review")?.id).toBe("review");
    expect(parseStandaloneSlashCommand("/compact")?.id).toBe("compact");
    expect(parseStandaloneSlashCommand("/init")?.id).toBe("init");
  });

  it("accepts aliases for execute commands", () => {
    expect(parseStandaloneSlashCommand("/open")?.id).toBe("editor");
  });

  it("parses custom commands", () => {
    const parsed = parseStandaloneSlashCommand("/deploy", CUSTOM_COMMANDS);
    expect(parsed?.id).toBe("custom:deploy");
    expect(parsed?.source).toBe("custom");
  });

  it("rejects commands that require arguments or trailing text", () => {
    expect(parseStandaloneSlashCommand("/model")).toBeNull();
    expect(parseStandaloneSlashCommand("/new now")).toBeNull();
  });
});

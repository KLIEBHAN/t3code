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
      "plan",
      "default",
    ]);
  });

  it("matches aliases and search terms", () => {
    expect(findMatchingSlashCommands("chat").map((command) => command.id)).toEqual(["default"]);
    expect(findMatchingSlashCommands("planning").map((command) => command.id)).toEqual(["plan"]);
    expect(findMatchingSlashCommands("models").map((command) => command.id)).toEqual(["model"]);
  });

  it("includes custom commands in search results", () => {
    expect(
      findMatchingSlashCommands("deploy", CUSTOM_COMMANDS).map((command) => command.id),
    ).toEqual(["custom:deploy"]);
    expect(
      findMatchingSlashCommands("current project", CUSTOM_COMMANDS).map((command) => command.id),
    ).toContain("custom:deploy");
  });
});

describe("hasSlashCommandPrefix", () => {
  it("accepts partial prefixes for known commands", () => {
    expect(hasSlashCommandPrefix("pl")).toBe(true);
    expect(hasSlashCommandPrefix("def")).toBe(true);
    expect(hasSlashCommandPrefix("cha")).toBe(false);
    expect(hasSlashCommandPrefix("rev")).toBe(false);
    expect(hasSlashCommandPrefix("zzz")).toBe(false);
  });

  it("accepts custom command prefixes", () => {
    expect(hasSlashCommandPrefix("dep", CUSTOM_COMMANDS)).toBe(true);
  });
});

describe("parseStandaloneSlashCommand", () => {
  it("parses standalone execute commands", () => {
    expect(parseStandaloneSlashCommand(" /plan ")?.id).toBe("plan");
    expect(parseStandaloneSlashCommand("/default")?.id).toBe("default");
  });

  it("accepts aliases for execute commands", () => {
    expect(parseStandaloneSlashCommand("/chat")?.id).toBe("default");
  });

  it("parses custom commands", () => {
    const parsed = parseStandaloneSlashCommand("/deploy", CUSTOM_COMMANDS);
    expect(parsed?.id).toBe("custom:deploy");
    expect(parsed?.source).toBe("custom");
  });

  it("rejects commands that require arguments or trailing text", () => {
    expect(parseStandaloneSlashCommand("/model")).toBeNull();
    expect(parseStandaloneSlashCommand("/review")).toBeNull();
    expect(parseStandaloneSlashCommand("/terminal")).toBeNull();
    expect(parseStandaloneSlashCommand("/new now")).toBeNull();
  });
});

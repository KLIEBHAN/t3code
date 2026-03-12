import type { ServerCustomSlashCommand } from "@t3tools/contracts";
import {
  BUILTIN_CHAT_SLASH_COMMANDS,
  slashCommandNames,
  type BuiltinChatSlashCommand,
  type BuiltinSlashCommandSpec,
} from "@t3tools/shared/slashCommands";

export interface BuiltinSlashCommandDefinition {
  source: "builtin";
  id: BuiltinChatSlashCommand;
  label: `/${string}`;
  description: string;
  mode: "insert" | "execute";
  keybindingCommand?: BuiltinSlashCommandSpec["keybindingCommand"];
  aliases?: readonly string[];
  searchTerms?: readonly string[];
}

export interface CustomSlashCommandDefinition {
  source: "custom";
  id: `custom:${string}`;
  name: string;
  label: string;
  description: string;
  mode: "execute";
  prompt: string;
  sourcePath: string;
}

export type SlashCommandDefinition = BuiltinSlashCommandDefinition | CustomSlashCommandDefinition;
export type ExecutableSlashCommandDefinition = Exclude<SlashCommandDefinition, { mode: "insert" }>;

const BUILTIN_SLASH_COMMANDS: readonly BuiltinSlashCommandDefinition[] =
  BUILTIN_CHAT_SLASH_COMMANDS.map((command) => {
    const definition: BuiltinSlashCommandDefinition = {
      source: "builtin",
      id: command.id,
      label: `/${command.id}`,
      description: command.description,
      mode: command.mode,
    };
    if (command.keybindingCommand) {
      definition.keybindingCommand = command.keybindingCommand;
    }
    if (command.aliases) {
      definition.aliases = command.aliases;
    }
    if (command.searchTerms) {
      definition.searchTerms = command.searchTerms;
    }
    return definition;
  });

function normalizeQuery(value: string): string {
  return value.trim().toLowerCase();
}

function commandNames(command: SlashCommandDefinition): readonly string[] {
  return command.source === "custom" ? [command.name] : slashCommandNames(command);
}

function commandTokens(command: SlashCommandDefinition): readonly string[] {
  if (command.source === "custom") {
    return [command.name, command.description.toLowerCase()];
  }
  return [
    command.label.slice(1),
    ...(command.aliases ?? []),
    ...(command.searchTerms ?? []),
    command.description.toLowerCase(),
  ];
}

function toCustomSlashCommandDefinition(
  command: ServerCustomSlashCommand,
): CustomSlashCommandDefinition {
  return {
    source: "custom",
    id: `custom:${command.command}`,
    name: command.command,
    label: `/${command.command}`,
    description: command.description,
    mode: "execute",
    prompt: command.prompt,
    sourcePath: command.sourcePath,
  };
}

export function getSlashCommandDefinitions(
  customCommands: readonly ServerCustomSlashCommand[] = [],
): readonly SlashCommandDefinition[] {
  if (customCommands.length === 0) {
    return BUILTIN_SLASH_COMMANDS;
  }
  return [...BUILTIN_SLASH_COMMANDS, ...customCommands.map(toCustomSlashCommandDefinition)];
}

export function matchesSlashCommandQuery(command: SlashCommandDefinition, query: string): boolean {
  const normalizedQuery = normalizeQuery(query);
  if (!normalizedQuery) {
    return true;
  }

  return commandTokens(command).some((token) => token.includes(normalizedQuery));
}

export function hasSlashCommandPrefix(
  query: string,
  customCommands: readonly ServerCustomSlashCommand[] = [],
): boolean {
  const normalizedQuery = normalizeQuery(query);
  if (!normalizedQuery) {
    return true;
  }

  return getSlashCommandDefinitions(customCommands).some((command) =>
    commandNames(command).some((name) => name.startsWith(normalizedQuery)),
  );
}

export function findMatchingSlashCommands(
  query: string,
  customCommands: readonly ServerCustomSlashCommand[] = [],
): readonly SlashCommandDefinition[] {
  return getSlashCommandDefinitions(customCommands).filter((command) =>
    matchesSlashCommandQuery(command, query),
  );
}

export function parseStandaloneSlashCommand(
  text: string,
  customCommands: readonly ServerCustomSlashCommand[] = [],
): ExecutableSlashCommandDefinition | null {
  const match = /^\/([a-z0-9-]+)\s*$/i.exec(text.trim());
  if (!match?.[1]) {
    return null;
  }

  const normalizedName = match[1].toLowerCase();
  const command = getSlashCommandDefinitions(customCommands).find((candidate) => {
    if (candidate.source === "custom") {
      return candidate.name === normalizedName;
    }
    return commandNames(candidate).includes(normalizedName);
  });
  if (!command || command.mode !== "execute") {
    return null;
  }
  return command;
}

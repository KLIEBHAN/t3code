import type { KeybindingCommand, ServerCustomSlashCommand } from "@t3tools/contracts";
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
  keybindingCommand?: KeybindingCommand;
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

const SUPPORTED_BUILTIN_SLASH_COMMAND_IDS = new Set<BuiltinChatSlashCommand>([
  "model",
  "plan",
  "default",
]);

function toBuiltinSlashCommandDefinition(
  command: BuiltinSlashCommandSpec,
): BuiltinSlashCommandDefinition {
  return {
    source: "builtin",
    id: command.id,
    label: `/${command.id}`,
    description: command.description,
    mode: command.mode,
    ...(command.keybindingCommand ? { keybindingCommand: command.keybindingCommand } : {}),
    ...(command.aliases ? { aliases: command.aliases } : {}),
    ...(command.searchTerms ? { searchTerms: command.searchTerms } : {}),
  };
}

const BUILTIN_SLASH_COMMANDS: readonly BuiltinSlashCommandDefinition[] =
  BUILTIN_CHAT_SLASH_COMMANDS.filter((command) =>
    SUPPORTED_BUILTIN_SLASH_COMMAND_IDS.has(command.id),
  ).map(toBuiltinSlashCommandDefinition);

function normalizeQuery(value: string): string {
  return value.trim().toLowerCase();
}

function commandName(command: SlashCommandDefinition): string {
  return command.source === "custom" ? command.name : command.label.slice(1);
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
    commandName(command).startsWith(normalizedQuery),
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
    return slashCommandNames(candidate).includes(normalizedName);
  });
  if (!command || command.mode !== "execute") {
    return null;
  }
  return command;
}

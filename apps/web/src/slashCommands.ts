import type { KeybindingCommand, ServerCustomSlashCommand } from "@t3tools/contracts";

export type BuiltinChatSlashCommand =
  | "model"
  | "review"
  | "compact"
  | "plan"
  | "default"
  | "new"
  | "new-local"
  | "terminal"
  | "diff"
  | "editor"
  | "init";

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
export type ExecutableSlashCommandDefinition = Exclude<
  SlashCommandDefinition,
  { mode: "insert" }
>;

const BUILTIN_SLASH_COMMANDS: readonly BuiltinSlashCommandDefinition[] = [
  {
    source: "builtin",
    id: "model",
    label: "/model",
    description: "Switch response model for this thread",
    mode: "insert",
    searchTerms: ["models"],
  },
  {
    source: "builtin",
    id: "review",
    label: "/review",
    description: "Start a structured code review turn for the current thread",
    mode: "execute",
    searchTerms: ["audit", "bugs", "risks"],
  },
  {
    source: "builtin",
    id: "compact",
    label: "/compact",
    description: "Generate a compact handoff summary for the current thread",
    mode: "execute",
    searchTerms: ["summary", "handoff", "context"],
  },
  {
    source: "builtin",
    id: "plan",
    label: "/plan",
    description: "Switch this thread into plan mode",
    mode: "execute",
    searchTerms: ["planning"],
  },
  {
    source: "builtin",
    id: "default",
    label: "/default",
    description: "Switch this thread back to normal chat mode",
    mode: "execute",
    aliases: ["chat"],
  },
  {
    source: "builtin",
    id: "new",
    label: "/new",
    description: "Create a new thread in the current project",
    mode: "execute",
    keybindingCommand: "chat.new",
    aliases: ["new-chat"],
    searchTerms: ["thread", "chat"],
  },
  {
    source: "builtin",
    id: "new-local",
    label: "/new-local",
    description: "Create a new local thread without worktree context",
    mode: "execute",
    keybindingCommand: "chat.newLocal",
    aliases: ["newlocal", "local"],
    searchTerms: ["thread", "chat", "worktree"],
  },
  {
    source: "builtin",
    id: "terminal",
    label: "/terminal",
    description: "Toggle the thread terminal",
    mode: "execute",
    keybindingCommand: "terminal.toggle",
    aliases: ["term"],
    searchTerms: ["shell"],
  },
  {
    source: "builtin",
    id: "diff",
    label: "/diff",
    description: "Toggle the latest changes diff",
    mode: "execute",
    keybindingCommand: "diff.toggle",
    searchTerms: ["changes", "patch"],
  },
  {
    source: "builtin",
    id: "editor",
    label: "/editor",
    description: "Open the current workspace in your favorite editor",
    mode: "execute",
    keybindingCommand: "editor.openFavorite",
    aliases: ["open"],
    searchTerms: ["vscode", "cursor", "zed"],
  },
  {
    source: "builtin",
    id: "init",
    label: "/init",
    description: "Initialize Git in the current project",
    mode: "execute",
    searchTerms: ["git", "repository"],
  },
];

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

export function matchesSlashCommandQuery(
  command: SlashCommandDefinition,
  query: string,
): boolean {
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
    return [candidate.label.slice(1), ...(candidate.aliases ?? [])].includes(normalizedName);
  });
  if (!command || command.mode !== "execute") {
    return null;
  }
  return command;
}

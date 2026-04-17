import type { KeybindingCommand } from "@t3tools/contracts";

export type ChatSlashCommand =
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
type ExecutableChatSlashCommand = Exclude<ChatSlashCommand, "model">;

export interface SlashCommandDefinition {
  id: ChatSlashCommand;
  label: `/${string}`;
  description: string;
  mode: "insert" | "execute";
  keybindingCommand?: KeybindingCommand;
  aliases?: readonly string[];
  searchTerms?: readonly string[];
}

const SLASH_COMMANDS: readonly SlashCommandDefinition[] = [
  {
    id: "model",
    label: "/model",
    description: "Switch response model for this thread",
    mode: "insert",
    searchTerms: ["models"],
  },
  {
    id: "review",
    label: "/review",
    description: "Start a structured code review turn for the current thread",
    mode: "execute",
    searchTerms: ["audit", "bugs", "risks"],
  },
  {
    id: "compact",
    label: "/compact",
    description: "Generate a compact handoff summary for the current thread",
    mode: "execute",
    searchTerms: ["summary", "handoff", "context"],
  },
  {
    id: "plan",
    label: "/plan",
    description: "Switch this thread into plan mode",
    mode: "execute",
    searchTerms: ["planning"],
  },
  {
    id: "default",
    label: "/default",
    description: "Switch this thread back to normal chat mode",
    mode: "execute",
    aliases: ["chat"],
  },
  {
    id: "new",
    label: "/new",
    description: "Create a new thread in the current project",
    mode: "execute",
    keybindingCommand: "chat.new",
    aliases: ["new-chat"],
    searchTerms: ["thread", "chat"],
  },
  {
    id: "new-local",
    label: "/new-local",
    description: "Create a new local thread without worktree context",
    mode: "execute",
    keybindingCommand: "chat.newLocal",
    aliases: ["newlocal", "local"],
    searchTerms: ["thread", "chat", "worktree"],
  },
  {
    id: "terminal",
    label: "/terminal",
    description: "Toggle the thread terminal",
    mode: "execute",
    keybindingCommand: "terminal.toggle",
    aliases: ["term"],
    searchTerms: ["shell"],
  },
  {
    id: "diff",
    label: "/diff",
    description: "Toggle the latest changes diff",
    mode: "execute",
    keybindingCommand: "diff.toggle",
    searchTerms: ["changes", "patch"],
  },
  {
    id: "editor",
    label: "/editor",
    description: "Open the current workspace in your favorite editor",
    mode: "execute",
    keybindingCommand: "editor.openFavorite",
    aliases: ["open"],
    searchTerms: ["vscode", "cursor", "zed"],
  },
  {
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

function commandTokens(command: SlashCommandDefinition): readonly string[] {
  return [
    command.label.slice(1),
    ...(command.aliases ?? []),
    ...(command.searchTerms ?? []),
  ];
}

export function getSlashCommandDefinitions(): readonly SlashCommandDefinition[] {
  return SLASH_COMMANDS;
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

export function hasSlashCommandPrefix(query: string): boolean {
  const normalizedQuery = normalizeQuery(query);
  if (!normalizedQuery) {
    return true;
  }

  return SLASH_COMMANDS.some((command) =>
    commandTokens(command).some((token) => token.startsWith(normalizedQuery)),
  );
}

export function findMatchingSlashCommands(query: string): readonly SlashCommandDefinition[] {
  return SLASH_COMMANDS.filter((command) => matchesSlashCommandQuery(command, query));
}

export function parseStandaloneSlashCommand(text: string): ExecutableChatSlashCommand | null {
  const match = /^\/([a-z0-9-]+)\s*$/i.exec(text.trim());
  if (!match?.[1]) {
    return null;
  }

  const normalizedName = match[1].toLowerCase();
  const command = SLASH_COMMANDS.find((candidate) =>
    [candidate.label.slice(1), ...(candidate.aliases ?? [])].includes(normalizedName),
  );
  if (!command || command.mode !== "execute") {
    return null;
  }
  return command.id as ExecutableChatSlashCommand;
}

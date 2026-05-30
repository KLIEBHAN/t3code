import type { KeybindingCommand } from "@t3tools/contracts";

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

export interface BuiltinSlashCommandSpec {
  readonly id: BuiltinChatSlashCommand;
  readonly description: string;
  readonly mode: "insert" | "execute";
  readonly keybindingCommand?: KeybindingCommand;
  readonly aliases?: readonly string[];
  readonly searchTerms?: readonly string[];
}

export const BUILTIN_CHAT_SLASH_COMMANDS: readonly BuiltinSlashCommandSpec[] = [
  {
    id: "model",
    description: "Switch response model for this thread",
    mode: "insert",
    searchTerms: ["models"],
  },
  {
    id: "review",
    description: "Start a structured code review turn for the current thread",
    mode: "execute",
    searchTerms: ["audit", "bugs", "risks"],
  },
  {
    id: "compact",
    description: "Generate a compact handoff summary for the current thread",
    mode: "execute",
    searchTerms: ["summary", "handoff", "context"],
  },
  {
    id: "plan",
    description: "Switch this thread into plan mode",
    mode: "execute",
    searchTerms: ["planning"],
  },
  {
    id: "default",
    description: "Switch this thread back to normal chat mode",
    mode: "execute",
    aliases: ["chat"],
  },
  {
    id: "new",
    description: "Create a new thread in the current project",
    mode: "execute",
    keybindingCommand: "chat.new",
    aliases: ["new-chat"],
    searchTerms: ["thread", "chat"],
  },
  {
    id: "new-local",
    description: "Create a new local thread without worktree context",
    mode: "execute",
    keybindingCommand: "chat.newLocal",
    aliases: ["newlocal", "local"],
    searchTerms: ["thread", "chat", "worktree"],
  },
  {
    id: "terminal",
    description: "Toggle the thread terminal",
    mode: "execute",
    keybindingCommand: "terminal.toggle",
    aliases: ["term"],
    searchTerms: ["shell"],
  },
  {
    id: "diff",
    description: "Toggle the latest changes diff",
    mode: "execute",
    keybindingCommand: "diff.toggle",
    searchTerms: ["changes", "patch"],
  },
  {
    id: "editor",
    description: "Open the current workspace in your favorite editor",
    mode: "execute",
    keybindingCommand: "editor.openFavorite",
    aliases: ["open"],
    searchTerms: ["vscode", "cursor", "zed"],
  },
  {
    id: "init",
    description: "Initialize Git in the current project",
    mode: "execute",
    searchTerms: ["git", "repository"],
  },
] as const;

export function slashCommandNames(
  command: Pick<BuiltinSlashCommandSpec, "id" | "aliases">,
): readonly string[] {
  return [command.id, ...(command.aliases ?? [])];
}

export const RESERVED_SLASH_COMMAND_NAMES = new Set(
  BUILTIN_CHAT_SLASH_COMMANDS.flatMap((command) => slashCommandNames(command)),
);

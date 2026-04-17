import type { ServerCustomSlashCommand } from "@t3tools/contracts";

import { findMatchingSlashCommands, type SlashCommandDefinition } from "./slashCommands";

export interface ComposerSlashCommandMenuItem {
  readonly id: string;
  readonly type: "slash-command";
  readonly command: SlashCommandDefinition;
  readonly label: string;
  readonly description: string;
}

export function buildComposerSlashCommandItems(
  query: string,
  customCommands: readonly ServerCustomSlashCommand[] = [],
): ComposerSlashCommandMenuItem[] {
  return findMatchingSlashCommands(query, customCommands).map((command) => ({
    id: `slash:${command.id}`,
    type: "slash-command",
    command,
    label: command.label,
    description: command.description,
  }));
}
